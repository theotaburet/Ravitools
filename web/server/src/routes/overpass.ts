import { createHash } from "node:crypto";
import { Router } from "express";
import { cache } from "../caches.js";
import { MAX_QUERY_LENGTH, OVERPASS_FALLBACK_URL, OVERPASS_URL } from "../config.js";
import { isTimeoutError, sendProxyJson } from "../http.js";
import { limiter } from "../limiters.js";
import { log } from "../logger.js";
import { safeSet } from "../safe-set.js";

export const overpassRouter = Router();

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

    // One shared 180s deadline across both Overpass instances (AUDIT R25).
    const timeoutSignal = AbortSignal.timeout(180_000);

    const overpassUrls = [OVERPASS_URL, OVERPASS_FALLBACK_URL];

    let overpassRes: Response | undefined;
    let usedUrl = "";
    for (const url of overpassUrls) {
      try {
        usedUrl = url;
        overpassRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(query)}`,
          signal: timeoutSignal,
        });
        if (overpassRes.ok) break;
      } catch (err) {
        // A timeout must surface as 504, not be swallowed into a 502 (AUDIT T+1).
        if (isTimeoutError(err)) throw err;
        log.warn({ url }, "Overpass fetch failed, trying next");
      }
    }

    if (!overpassRes?.ok) {
      const body = overpassRes ? await overpassRes.text() : "All Overpass instances failed";
      log.warn({ status: overpassRes?.status, usedUrl }, "Overpass returned non-OK status");
      res.status(overpassRes?.status || 502).json({
        error: "Overpass API error",
        status: overpassRes?.status,
        detail: body.slice(0, 500),
      });
      return;
    }

    const data = await overpassRes.text();

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
