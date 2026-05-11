/**
 * Generic Express endpoint mounter for map scraper plugins.
 *
 * Given a `MapScraperPlugin<T>` and its `ScraperJobSystem<T>`, this mounts
 * the 5 standard endpoints under a base path (default `/scrape/{plugin.name}`):
 *
 *   POST   {base}                 synchronous extract (returns full preview)
 *   POST   {base}/jobs            queue background job (202 + job)
 *   GET    {base}/jobs/:jobId     poll job status
 *   DELETE {base}/jobs/:jobId     cancel/delete job (best-effort)
 *   GET    {base}/jobs            list recent jobs + counts
 *
 * Request body for POST endpoints:
 *   { url: string }                                   — direct URL
 *   { poiName: string, lat: number, lon: number, ...} — server builds URL via plugin.buildUrl
 *
 * Backward-compat aliases (e.g. `/google-maps-preview`) are mounted by
 * passing a custom `basePath` in addition to the canonical `/scrape/{name}`.
 */

import type { Express, RequestHandler } from "express";
import type { MapPreview, MapScraperPlugin, ScraperJob } from "./types.js";
import type { ScraperJobSystem } from "./job-system.js";
import type { Logger } from "pino";

export interface MountOptions {
  /** Path prefix; defaults to `/scrape/${plugin.name}` */
  basePath?: string;
  /** Express middleware (e.g. rate limiter) applied to every route */
  limiter?: RequestHandler;
  log: Logger;
}

type ParsedInput =
  | { url: string; poiName: string | null }
  | { error: string };

function parseInput<T extends MapPreview>(
  body: unknown,
  plugin: MapScraperPlugin<T>,
): ParsedInput {
  const b = (body && typeof body === "object" ? body : {}) as Record<string, unknown>;
  const rawUrl = typeof b.url === "string" ? b.url : null;
  const poiName = typeof b.poiName === "string" ? b.poiName : null;

  if (rawUrl) {
    // First reject malformed URL syntax (back-compat with legacy endpoints)
    try {
      // eslint-disable-next-line no-new
      new URL(rawUrl);
    } catch {
      return { error: "Invalid URL" };
    }
    const validated = plugin.validateUrl(rawUrl);
    if (!validated) {
      return { error: `Only ${plugin.displayName} URLs are supported` };
    }
    return { url: validated, poiName };
  }

  // Fallback: build from name + coords if plugin supports it
  if (!plugin.buildUrl) {
    return { error: "Missing 'url' in request body" };
  }
  const lat = typeof b.lat === "number" ? b.lat : Number(b.lat);
  const lon = typeof b.lon === "number" ? b.lon : Number(b.lon);
  if (!poiName || !Number.isFinite(lat) || !Number.isFinite(lon)) {
    return { error: "Provide either 'url' or { poiName, lat, lon }" };
  }
  // Pass any extra fields through (e.g. category hints for future plugins)
  const extra: Record<string, unknown> = { ...b };
  delete extra.url;
  delete extra.poiName;
  delete extra.lat;
  delete extra.lon;
  const built = plugin.buildUrl(poiName, lat, lon, extra);
  if (!built) {
    return { error: `Failed to build ${plugin.displayName} URL (check name/coords)` };
  }
  return { url: built, poiName };
}

export function mountScraperEndpoints<T extends MapPreview>(
  app: Express,
  plugin: MapScraperPlugin<T>,
  system: ScraperJobSystem<T>,
  options: MountOptions,
): void {
  const base = options.basePath ?? `/scrape/${plugin.name}`;
  const middlewares: RequestHandler[] = options.limiter ? [options.limiter] : [];
  const log = options.log;

  // POST {base} — synchronous fetch
  app.post(base, ...middlewares, async (req, res) => {
    try {
      const parsed = parseInput(req.body, plugin);
      if ("error" in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }

      const cacheKey = `${plugin.name}:${parsed.url}`;
      const cached = system.previewCache.get<T>(cacheKey);
      if (cached) {
        res.setHeader("X-Cache", "HIT");
        res.json(cached);
        return;
      }

      const preview = await system.fetchSync(parsed.url);
      if (!preview) {
        res.status(502).json({ error: `Failed to extract ${plugin.displayName} preview` });
        return;
      }

      system.previewCache.set(cacheKey, preview);
      res.setHeader("X-Cache", "MISS");
      res.json(preview);
    } catch (err: unknown) {
      log.error({ err, source: plugin.name }, `${plugin.displayName} preview error`);
      res.status(502).json({ error: `Failed to fetch ${plugin.displayName} preview` });
    }
  });

  // POST {base}/jobs — queue background job
  app.post(`${base}/jobs`, ...middlewares, async (req, res) => {
    try {
      const parsed = parseInput(req.body, plugin);
      if ("error" in parsed) {
        res.status(400).json({ error: parsed.error });
        return;
      }
      const job = await system.queueJob(parsed.url, parsed.poiName);
      res.status(202).json(job);
    } catch (err: unknown) {
      log.error({ err, source: plugin.name }, `${plugin.displayName} preview job queue error`);
      res.status(502).json({ error: `Failed to queue ${plugin.displayName} preview` });
    }
  });

  // DELETE {base}/jobs/:jobId
  app.delete(`${base}/jobs/:jobId`, ...middlewares, (req, res) => {
    const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
    const job = system.jobCache.get<ScraperJob<T>>(jobId);
    if (!job) {
      res.status(404).json({ error: `${plugin.displayName} preview job not found` });
      return;
    }
    if (job.status === "running") {
      // Cannot abort in-flight Playwright; mark as cancelled
      system.jobCache.set(jobId, {
        ...job,
        status: "error",
        error: "Cancelled by user",
        lastError: "Cancelled by user",
        nextRetryAt: null,
        updatedAt: new Date().toISOString(),
      });
    } else {
      system.jobCache.del(jobId);
    }
    system.persist();
    log.info({ jobId, previousStatus: job.status, source: plugin.name }, `${plugin.displayName} preview job cancelled`);
    res.status(204).send();
  });

  // GET {base}/jobs/:jobId — must come BEFORE GET {base}/jobs in Express? No, distinct paths.
  app.get(`${base}/jobs/:jobId`, ...middlewares, (req, res) => {
    const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
    const job = system.jobCache.get<ScraperJob<T>>(jobId);
    if (!job) {
      res.status(404).json({ error: `${plugin.displayName} preview job not found` });
      return;
    }
    res.json(job);
  });

  // GET {base}/jobs — list recent + counts
  app.get(`${base}/jobs`, ...middlewares, (_req, res) => {
    const jobs = system.jobCache
      .keys()
      .map((key) => system.jobCache.get<ScraperJob<T>>(key))
      .filter((job): job is ScraperJob<T> => Boolean(job));
    const counts = {
      queued: jobs.filter((j) => j.status === "queued").length,
      running: jobs.filter((j) => j.status === "running").length,
      done: jobs.filter((j) => j.status === "done").length,
      error: jobs.filter((j) => j.status === "error").length,
    };
    res.json({ counts, jobs: jobs.slice(-20).reverse() });
  });
}
