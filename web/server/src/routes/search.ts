import { createHash } from "node:crypto";
import { Router } from "express";
import { searchCache } from "../caches.js";
import { SEARXNG_URL } from "../config.js";
import { isTimeoutError, sendProxyJson } from "../http.js";
import { enrichLimiter } from "../limiters.js";
import { log } from "../logger.js";
import { safeSet } from "../safe-set.js";

export const searchRouter = Router();

searchRouter.post("/search", enrichLimiter, async (req, res) => {
  try {
    const { query, language, engines } = req.body as {
      query?: string;
      language?: string;
      engines?: string;
    };

    if (!query || typeof query !== "string") {
      res.status(400).json({ error: "Missing 'query' in request body" });
      return;
    }

    if (query.length > 500) {
      res.status(413).json({ error: "Search query too long (max 500 chars)" });
      return;
    }

    // Cache key includes engines and language (AUDIT R14) so different engine
    // sets or locales never share a cached result.
    const cacheInput = `${query}|lang=${language || "auto"}${engines ? `|engines=${engines}` : ""}`;
    const cacheKey = `search:${createHash("md5").update(cacheInput).digest("hex")}`;

    const cached = searchCache.get<string>(cacheKey);
    if (cached) {
      log.info({ cacheKey }, "Search cache hit");
      sendProxyJson(res, cached, "HIT");
      return;
    }

    // Build SearXNG query URL
    const params = new URLSearchParams({
      q: query,
      format: "json",
      categories: "general",
      language: language || "auto",
      time_range: "",
      safesearch: "0",
    });

    // Forward engine selection to SearXNG if specified
    if (engines && typeof engines === "string") {
      params.set("engines", engines);
    }

    log.info({ query: query.slice(0, 80), engines: engines || "default" }, "Searching SearXNG");

    const searchRes = await fetch(`${SEARXNG_URL}/search?${params.toString()}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "Ravitools/1.0 (cycling POI enrichment)",
      },
      signal: AbortSignal.timeout(15_000),
    });

    if (!searchRes.ok) {
      const body = await searchRes.text();
      log.warn({ status: searchRes.status }, "SearXNG returned non-OK status");
      res.status(searchRes.status).json({
        error: "SearXNG search error",
        status: searchRes.status,
        detail: body.slice(0, 500),
      });
      return;
    }

    const data = await searchRes.text();

    // Log unresponsive engines for observability
    try {
      const parsed = JSON.parse(data);
      if (parsed.unresponsive_engines?.length > 0) {
        log.warn(
          { query: query.slice(0, 60), unresponsive: parsed.unresponsive_engines },
          "SearXNG unresponsive engines",
        );
      }
    } catch {
      /* non-critical parse failure */
    }

    // Cache the response
    safeSet(searchCache, cacheKey, data);
    log.info({ cacheKey, bytes: data.length }, "Cached search response");

    sendProxyJson(res, data, "MISS");
  } catch (err: unknown) {
    if (isTimeoutError(err)) {
      log.error("SearXNG request timed out");
      res.status(504).json({ error: "Search request timed out" });
      return;
    }
    log.error({ err }, "Search proxy error");
    res.status(502).json({ error: "Failed to reach search service" });
  }
});
