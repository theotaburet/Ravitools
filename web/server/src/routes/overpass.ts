import { createHash } from "node:crypto";
import { Router } from "express";
import { cache } from "../caches.js";
import { MAX_QUERY_LENGTH, OVERPASS_URLS } from "../config.js";
import { isTimeoutError, sendProxyJson } from "../http.js";
import { limiter } from "../limiters.js";
import { log } from "../logger.js";
import { safeSet } from "../safe-set.js";

export const overpassRouter = Router();

// ponytail: overpass-api.de allows 2 slots/IP — serialize upstream calls so
// concurrent chunks don't 429 each other. Per-mirror queue if throughput matters.
let overpassQueue: Promise<unknown> = Promise.resolve();
function enqueueOverpass<T>(fn: () => Promise<T>): Promise<T> {
  const run = overpassQueue.then(fn, fn);
  overpassQueue = run.catch(() => undefined);
  return run;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * POST the query to each mirror in turn. A 429 gets ONE same-mirror retry after
 * the announced Retry-After (slots free in 10–45s; instant retries reset the
 * penalty). Returns the successful response, else the last non-OK one, else
 * undefined when every mirror was unreachable. Timeouts re-throw (→ 504).
 */
async function fetchFromMirrors(
  query: string,
  signal: AbortSignal,
  deadline: number,
): Promise<{ res: Response; url: string } | undefined> {
  let last: { res: Response; url: string } | undefined;
  for (const url of OVERPASS_URLS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let overpassRes: Response;
      try {
        overpassRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(query)}`,
          signal,
        });
      } catch (err) {
        // A timeout must surface as 504, not be swallowed into a 502 (AUDIT T+1).
        if (isTimeoutError(err)) throw err;
        log.warn({ url }, "Overpass fetch failed, trying next");
        break;
      }
      if (overpassRes.ok) return { res: overpassRes, url };
      last = { res: overpassRes, url };
      log.warn({ url, status: overpassRes.status }, "Overpass mirror non-OK");
      if (overpassRes.status !== 429 || attempt > 0) break;
      const header = overpassRes.headers.get("retry-after");
      const parsed = header === null ? Number.NaN : Number(header);
      const waitS = Math.min(Math.max(Number.isFinite(parsed) ? parsed : 15, 0), 45);
      // Waiting must not eat the whole deadline — better to move to the next mirror
      if (Date.now() + waitS * 1000 > deadline - 10_000) break;
      await sleep(waitS * 1000);
    }
  }
  return last;
}

overpassRouter.post("/overpass", limiter, async (req, res) => {
  try {
    // Accept query from JSON body or form-encoded body
    const query: string =
      typeof req.body === "string" ? req.body : (req.body?.data ?? req.body?.query);

    if (!query || typeof query !== "string") {
      res.status(400).json({ error: "Missing 'query' or 'data' in request body" });
      return;
    }

    // Guard: reject overly large queries
    if (query.length > MAX_QUERY_LENGTH) {
      res.status(413).json({
        error: `Query too large (${query.length} chars, max ${MAX_QUERY_LENGTH})`,
      });
      return;
    }

    // Cache key from query hash
    const cacheKey = createHash("md5").update(query).digest("hex");

    // Check cache
    const cached = cache.get<string>(cacheKey);
    if (cached) {
      log.info({ cacheKey }, "Cache hit");
      sendProxyJson(res, cached, "HIT");
      return;
    }

    // Forward to Overpass
    log.info({ queryLength: query.length }, "Forwarding to Overpass");

    // One shared 180s deadline across all Overpass instances (AUDIT R25).
    const timeoutSignal = AbortSignal.timeout(180_000);
    const deadline = Date.now() + 180_000;

    const hit = await enqueueOverpass(() => fetchFromMirrors(query, timeoutSignal, deadline));

    if (!hit?.res.ok) {
      const body = hit ? await hit.res.text() : "All Overpass instances failed";
      log.warn({ status: hit?.res.status, usedUrl: hit?.url }, "Overpass returned non-OK status");
      res.status(hit?.res.status || 502).json({
        error: "Overpass API error",
        status: hit?.res.status,
        detail: body.slice(0, 500),
      });
      return;
    }

    const usedUrl = hit.url;
    const data = await hit.res.text();

    // Don't cache/serve a non-JSON body (e.g. an HTML error page returned with 200)
    // as application/json (AUDIT S7).
    try {
      JSON.parse(data);
    } catch {
      log.warn({ usedUrl, bytes: data.length }, "Overpass returned a non-JSON body");
      res.status(502).json({ error: "Overpass returned a non-JSON response" });
      return;
    }

    // Cache the response
    safeSet(cache, cacheKey, data);
    log.info({ cacheKey, bytes: data.length }, "Cached Overpass response");

    sendProxyJson(res, data, "MISS");
  } catch (err: unknown) {
    if (isTimeoutError(err)) {
      log.error("Overpass request timed out");
      res.status(504).json({ error: "Overpass request timed out" });
      return;
    }
    log.error({ err }, "Overpass proxy error");
    res.status(502).json({ error: "Failed to reach Overpass API" });
  }
});
