/**
 * Express endpoints of a scraper job system, under `basePath`:
 *
 *   POST   {base}/jobs            queue background job (202 + job), body { url, poiName? }
 *   GET    {base}/jobs/:jobId     poll job status
 *   GET    {base}/jobs            list recent jobs + counts
 */

import type { Express, RequestHandler } from "express";
import type { Logger } from "pino";
import type { ScraperJobSystem } from "./job-system.js";
import type { MapScraperPlugin } from "./types.js";
import { isBlockedError } from "./types.js";

export interface MountOptions {
  basePath: string;
  /** Express middleware (e.g. rate limiter) on the routes that launch a scrape; status reads stay free (polled every few seconds) */
  limiter?: RequestHandler;
  log: Logger;
}

type ParsedInput = { url: string; poiName: string | null } | { error: string };

function parseInput(body: unknown, plugin: MapScraperPlugin): ParsedInput {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  if (typeof b.url !== "string" || !b.url) return { error: "Missing 'url' in request body" };
  try {
    new URL(b.url);
  } catch {
    return { error: "Invalid URL" };
  }
  const validated = plugin.validateUrl(b.url);
  if (!validated) return { error: `Only ${plugin.displayName} URLs are supported` };
  return { url: validated, poiName: typeof b.poiName === "string" ? b.poiName : null };
}

/** Max queued+running jobs per source before POST /jobs returns 429. */
const MAX_PENDING_JOBS = 50;

export function mountScraperEndpoints(
  app: Express,
  system: ScraperJobSystem,
  options: MountOptions,
): void {
  const { plugin } = system;
  const base = options.basePath;
  const middlewares: RequestHandler[] = options.limiter ? [options.limiter] : [];
  const log = options.log;

  // POST {base}/jobs: queue background job
  app.post(`${base}/jobs`, ...middlewares, async (req, res) => {
    try {
      const parsed = parseInput(req.body, plugin);
      if ("error" in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      // The queue is floodable: refuse new jobs once too many are
      // pending for this source. O(n) scan over ≤5000 keys per POST.
      const pending = system.jobCache
        .values()
        .filter((j) => j.status === "queued" || j.status === "running").length;
      if (pending >= MAX_PENDING_JOBS) {
        res.status(429).json({
          error: `Too many pending ${plugin.displayName} jobs: retry later`,
        });
        return;
      }
      const job = await system.queueJob(parsed.url, parsed.poiName);
      res.status(202).json(job);
    } catch (err: unknown) {
      log.error({ err, source: plugin.name }, `${plugin.displayName} preview job queue error`);
      res.status(502).json({ error: `Failed to queue ${plugin.displayName} preview` });
    }
  });

  // GET {base}/jobs/:jobId
  app.get(`${base}/jobs/:jobId`, (req, res) => {
    const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
    const job = system.jobCache.get(jobId);
    if (!job) {
      res.status(404).json({ error: `${plugin.displayName} preview job not found` });
      return;
    }
    res.json(job);
  });

  // GET {base}/jobs: list recent + counts
  app.get(`${base}/jobs`, (_req, res) => {
    const jobs = system.jobCache.values();
    const counts = {
      queued: jobs.filter((j) => j.status === "queued").length,
      running: jobs.filter((j) => j.status === "running").length,
      done: jobs.filter((j) => j.status === "done").length,
      error: jobs.filter((j) => j.status === "error").length,
      // Blocked is a subset signal (CAPTCHA/anti-bot), counted across any status
      // whose lastError carries the BLOCKED_ sentinel: surfaced as a UI hint.
      blocked: jobs.filter((j) => isBlockedError(j.lastError)).length,
      // Source layout drift (a section on the page did not parse): surfaced as a UI hint.
      layoutIssues: jobs.filter((j) => (j.preview?.layoutWarnings?.length ?? 0) > 0).length,
    };
    res.json({ counts, jobs: jobs.slice(-20).reverse() });
  });
}
