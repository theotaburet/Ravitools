import { createHash } from "node:crypto";
import { Router } from "express";
import { searchCache } from "../caches.js";
import { SEARXNG_URL, USER_AGENT } from "../config.js";
import { cachedProxy } from "../http.js";
import { enrichLimiter } from "../limiters.js";

export const searchRouter = Router();

searchRouter.post("/search", enrichLimiter, async (req, res) => {
  const { query, language, engines } = (req.body ?? {}) as {
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

  // Cache key includes engines and language so different engine
  // sets or locales never share a cached result.
  const cacheInput = `${query}|lang=${language || "auto"}${engines ? `|engines=${engines}` : ""}`;
  const cacheKey = `search:${createHash("md5").update(cacheInput).digest("hex")}`;

  const params = new URLSearchParams({
    q: query,
    format: "json",
    language: language || "auto",
    time_range: "",
    safesearch: "0",
  });

  // SearXNG merges every engine of a category into an explicit engine list when
  // both parameters are present, so the category is only a default.
  if (engines && typeof engines === "string") {
    params.set("engines", engines);
  } else {
    params.set("categories", "general");
  }

  await cachedProxy(res, "SearXNG", searchCache, cacheKey, () =>
    fetch(`${SEARXNG_URL}/search?${params.toString()}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(15_000),
    }),
  );
});
