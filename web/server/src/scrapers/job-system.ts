/**
 * Job queue for the Google Maps scraper: `createScraperJobSystem(plugin, deps)`
 * gives the source a private:
 *
 * - in-memory job cache
 * - serialized in-flight queue (`with(...)`)
 * - retry loop with exponential-ish backoff
 * - background job runner (`queueJob`)
 * - synchronous fetch helper (`fetchSync`)
 * - JSON file persistence (atomic write + crash recovery)
 * - JSONL failure log (append-only, useful for debugging)
 * - stale-job pruning by TTL
 *
 * Page-level extraction lives in `plugin.fetchOnce()` (google-maps.ts).
 */

import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { TtlCache } from "../caches.js";
import type {
  MapPreview,
  MapScraperPlugin,
  ScraperDeps,
  ScraperFailureRecord,
  ScraperJob,
} from "./types.js";

export interface ScraperJobSystem {
  /** Plugin associated with this system (mostly for introspection / tests) */
  readonly plugin: MapScraperPlugin;

  /** Job-by-id cache */
  readonly jobCache: TtlCache<ScraperJob>;

  /** Absolute path to the persisted jobs JSON file */
  readonly jobsFile: string;

  /** Absolute path to the JSONL failure log */
  readonly failuresFile: string;

  /** Synchronous (in-request) extraction with retry: blocks until done/null */
  fetchSync(
    url: string,
    onAttemptUpdate?: (
      attempt: number,
      nextRetryAt: string | null,
      lastError: string | null,
    ) => void,
  ): Promise<MapPreview | null>;

  /** Background extraction; returns immediately with a queued job */
  queueJob(url: string, poiName?: string | null): Promise<ScraperJob>;

  /** Persist current jobs map atomically to disk (called automatically) */
  persist(): void;

  /** Restore jobs from disk (call once at boot) */
  load(): void;

  /** Drop terminal jobs older than `plugin.jobsTtlMs` */
  pruneStale(): void;

  /** Append a failure record to the JSONL failure log */
  appendFailure(record: ScraperFailureRecord): void;
}

export function createScraperJobSystem(
  plugin: MapScraperPlugin,
  deps: ScraperDeps,
): ScraperJobSystem {
  const jobCache = new TtlCache<ScraperJob>(60 * 60 * 24, 5000);

  const jobsFile = join(process.cwd(), ".cache", `${plugin.name}-jobs.json`);
  const failuresFile = join(process.cwd(), ".cache", `${plugin.name}-failures.jsonl`);

  let queue: Promise<unknown> = Promise.resolve();

  function withQueue<R>(task: () => Promise<R>): Promise<R> {
    const run = queue.then(task, task);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  function pruneStale(): void {
    const cutoff = Date.now() - plugin.jobsTtlMs;
    for (const job of jobCache.values()) {
      const age = new Date(job.updatedAt).getTime();
      if ((job.status === "done" || job.status === "error") && age < cutoff) {
        jobCache.delete(job.jobId);
        deps.log.debug(
          { jobId: job.jobId, age: Date.now() - age, source: plugin.name },
          `${plugin.displayName}: pruned stale job`,
        );
      }
    }
  }

  function persist(): void {
    pruneStale();
    mkdirSync(dirname(jobsFile), { recursive: true });
    const entries = jobCache.values();
    const tmpFile = `${jobsFile}.tmp`;
    try {
      writeFileSync(tmpFile, JSON.stringify(entries, null, 2), {
        encoding: "utf8",
        flag: "w",
      });
      renameSync(tmpFile, jobsFile);
    } catch (err) {
      deps.log.warn(
        { err, source: plugin.name },
        `${plugin.displayName}: failed to persist jobs (atomic write failed)`,
      );
      try {
        unlinkSync(tmpFile);
      } catch {
        /* ignore */
      }
    }
  }

  function load(): void {
    if (!existsSync(jobsFile)) return;
    try {
      const raw = readFileSync(jobsFile, "utf8");
      const jobs = JSON.parse(raw) as ScraperJob[];
      const cutoff = Date.now() - plugin.jobsTtlMs;
      let recovered = 0;
      let skipped = 0;
      for (const job of jobs) {
        if (
          (job.status === "done" || job.status === "error") &&
          new Date(job.updatedAt).getTime() < cutoff
        ) {
          skipped++;
          continue;
        }
        const recoveredStatus = job.status === "running" ? "error" : job.status;
        const recoveredError =
          job.status === "running" ? "Job interrupted by server restart" : job.error;
        jobCache.set(job.jobId, {
          ...job,
          source: plugin.name, // re-stamp in case file is from older schema
          status: recoveredStatus,
          error: recoveredError,
          lastError: job.status === "running" ? "Job interrupted by server restart" : job.lastError,
          updatedAt: job.status === "running" ? new Date().toISOString() : job.updatedAt,
        });
        recovered++;
      }
      deps.log.info(
        { recovered, skipped, source: plugin.name },
        `${plugin.displayName}: restored jobs from disk`,
      );
    } catch (err) {
      deps.log.warn(
        { err, source: plugin.name },
        `Failed to restore ${plugin.displayName} jobs from disk`,
      );
    }
  }

  function appendFailure(record: ScraperFailureRecord): void {
    try {
      mkdirSync(dirname(failuresFile), { recursive: true });
      appendFileSync(failuresFile, `${JSON.stringify(record)}\n`, { encoding: "utf8" });
      deps.log.debug(
        {
          url: record.url,
          attempts: record.attempts,
          lastError: record.lastError,
          source: plugin.name,
        },
        `${plugin.displayName}: failure record appended`,
      );
    } catch (err) {
      deps.log.warn(
        { err, source: plugin.name },
        `${plugin.displayName}: failed to append failure record`,
      );
    }
  }

  async function fetchSync(
    url: string,
    onAttemptUpdate?: (
      attempt: number,
      nextRetryAt: string | null,
      lastError: string | null,
    ) => void,
  ): Promise<MapPreview | null> {
    return withQueue(async () => {
      for (let attempt = 1; attempt <= plugin.retries; attempt++) {
        const initialDelay = deps.randomDelay(plugin.minDelayMs, plugin.maxDelayMs);
        deps.log.info(
          { url, attempt, initialDelay, source: plugin.name },
          `${plugin.displayName} preview: waiting before attempt`,
        );
        onAttemptUpdate?.(attempt, null, null);
        await deps.sleep(initialDelay);

        let lastError: string | null = null;
        const result = await plugin.fetchOnce(url, attempt, deps).catch((err) => {
          lastError = err instanceof Error ? err.message : String(err);
          deps.log.warn(
            { err, url, attempt, source: plugin.name },
            `${plugin.displayName} preview attempt failed`,
          );
          return null;
        });

        if (result) return result;

        if (attempt < plugin.retries) {
          const retryDelay = deps.randomDelay(8_000 * attempt, 20_000 * attempt);
          const nextRetryAt = new Date(Date.now() + retryDelay).toISOString();
          deps.log.warn(
            { url, attempt, retryDelay, nextRetryAt, source: plugin.name },
            `${plugin.displayName} preview: backing off before retry`,
          );
          onAttemptUpdate?.(attempt, nextRetryAt, lastError);
          await deps.sleep(retryDelay);
        } else {
          onAttemptUpdate?.(attempt, null, lastError);
        }
      }
      return null;
    });
  }

  async function queueJob(url: string, poiName?: string | null): Promise<ScraperJob> {
    const jobId = crypto.randomUUID(); // global webcrypto (Node 19+)
    const createdAt = new Date().toISOString();
    const job: ScraperJob = {
      jobId,
      status: "queued",
      source: plugin.name,
      url,
      poiName: poiName ?? null,
      preview: null,
      error: null,
      createdAt,
      updatedAt: createdAt,
      startedAt: null,
      attempt: 0,
      nextRetryAt: null,
      lastError: null,
    };
    jobCache.set(jobId, job);
    persist();

    void (async () => {
      const startedAt = new Date().toISOString();
      const runningJob: ScraperJob = {
        ...job,
        status: "running",
        startedAt,
        attempt: 1,
        updatedAt: startedAt,
      };
      const onAttemptUpdate = (
        attempt: number,
        nextRetryAt: string | null,
        lastError: string | null,
      ) => {
        const current = jobCache.get(jobId);
        if (!current) return;
        jobCache.set(jobId, {
          ...current,
          attempt,
          nextRetryAt,
          lastError: lastError ?? current.lastError,
          updatedAt: new Date().toISOString(),
        });
        persist();
      };

      try {
        // Initial running-state write inside try so a persist() throw can't escape
        // the IIFE unhandled.
        jobCache.set(jobId, runningJob);
        persist();
        const preview = await fetchSync(url, onAttemptUpdate);
        // A job evicted mid-run (full cache) stays gone:
        // never resurrect it with a terminal status.
        const current = jobCache.get(jobId);
        if (current?.status !== "running") return;
        if (!preview) {
          appendFailure({
            source: plugin.name,
            url,
            poiName: poiName ?? null,
            attempts: current.attempt,
            lastError: current.lastError ?? "no data returned",
            failedAt: new Date().toISOString(),
          });
        }
        jobCache.set(jobId, {
          ...current,
          status: preview ? "done" : "error",
          preview,
          error: preview ? null : `${plugin.displayName} preview returned no data`,
          nextRetryAt: null,
          updatedAt: new Date().toISOString(),
        });
        persist();
      } catch (err) {
        const current = jobCache.get(jobId);
        if (current?.status !== "running") return; // evicted mid-run
        const message = err instanceof Error ? err.message : `Unknown ${plugin.displayName} error`;
        appendFailure({
          source: plugin.name,
          url,
          poiName: poiName ?? null,
          attempts: current.attempt,
          lastError: message,
          failedAt: new Date().toISOString(),
        });
        jobCache.set(jobId, {
          ...current,
          status: "error",
          preview: null,
          error: message,
          lastError: message,
          nextRetryAt: null,
          updatedAt: new Date().toISOString(),
        });
        persist();
      }
    })();

    return job;
  }

  return {
    plugin,
    jobCache,
    jobsFile,
    failuresFile,
    fetchSync,
    queueJob,
    persist,
    load,
    pruneStale,
    appendFailure,
  };
}
