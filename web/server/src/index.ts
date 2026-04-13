import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import NodeCache from "node-cache";
import pino from "pino";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || "3001", 10);
const OVERPASS_URL =
  process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const OVERPASS_FALLBACK_URL =
  process.env.OVERPASS_FALLBACK_URL || "https://overpass.kumi.systems/api/interpreter";
const SEARXNG_URL =
  process.env.SEARXNG_URL || "http://localhost:8888";
const NOMINATIM_URL =
  process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org";
const CACHE_TTL = parseInt(process.env.CACHE_TTL || "86400", 10); // 24h default
const SEARCH_CACHE_TTL = parseInt(process.env.SEARCH_CACHE_TTL || "604800", 10); // 7 days
const GEOCODE_CACHE_TTL = parseInt(process.env.GEOCODE_CACHE_TTL || "2592000", 10); // 30 days
const MAX_QUERY_LENGTH = parseInt(
  process.env.MAX_QUERY_LENGTH || "32000",
  10,
);
const RATE_LIMIT_WINDOW_MS = parseInt(
  process.env.RATE_LIMIT_WINDOW_MS || "60000",
  10,
);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "60", 10);

const log = pino({
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty" }
      : undefined,
});

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------
const cache = new NodeCache({
  stdTTL: CACHE_TTL,
  checkperiod: 600,
  maxKeys: 500,
});

/** Search cache – longer TTL, more keys (POI reviews don't change often) */
const searchCache = new NodeCache({
  stdTTL: SEARCH_CACHE_TTL,
  checkperiod: 3600,
  maxKeys: 5000,
});

/** Geocode cache – very long TTL (coordinates don't move) */
const geocodeCache = new NodeCache({
  stdTTL: GEOCODE_CACHE_TTL,
  checkperiod: 3600,
  maxKeys: 5000,
});

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();

app.use(helmet());
app.use(compression());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "*",
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.text({ limit: "1mb", type: "application/x-www-form-urlencoded" }));

// ---------------------------------------------------------------------------
// Rate limiters
// ---------------------------------------------------------------------------
const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests. Please wait before querying again.",
  },
});

/** Separate rate limiter for enrichment endpoints (more generous) */
const enrichLimiter = rateLimit({
  windowMs: 60_000,
  max: 60, // 1 req/s average, enough for batch enrichment
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many enrichment requests. Please wait.",
  },
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/health", async (_req, res) => {
  const services: Record<string, "ok" | "error"> = {};

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    await fetch(`${SEARXNG_URL}/health`, { signal: controller.signal });
    services.searxng = "ok";
  } catch {
    services.searxng = "error";
  } finally {
    clearTimeout(timeout);
  }

  res.json({
    status: "ok",
    cache_keys: cache.keys().length,
    uptime: process.uptime(),
    services,
  });
});

// ---------------------------------------------------------------------------
// Cache stats
// ---------------------------------------------------------------------------
app.get("/cache/stats", (_req, res) => {
  const overpassStats = cache.getStats();
  const searchStats = searchCache.getStats();
  const geocodeStats = geocodeCache.getStats();
  res.json({
    overpass: {
      keys: cache.keys().length,
      hits: overpassStats.hits,
      misses: overpassStats.misses,
    },
    search: {
      keys: searchCache.keys().length,
      hits: searchStats.hits,
      misses: searchStats.misses,
    },
    geocode: {
      keys: geocodeCache.keys().length,
      hits: geocodeStats.hits,
      misses: geocodeStats.misses,
    },
  });
});

// ---------------------------------------------------------------------------
// Overpass proxy endpoint
// ---------------------------------------------------------------------------
app.post("/overpass", limiter, async (req, res) => {
  try {
    // Accept query from JSON body or form-encoded body
    const query: string =
      typeof req.body === "string"
        ? req.body
        : req.body?.data ?? req.body?.query;

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
    const crypto = await import("crypto");
    const cacheKey = crypto.createHash("md5").update(query).digest("hex");

    // Check cache
    const cached = cache.get<string>(cacheKey);
    if (cached) {
      log.info({ cacheKey }, "Cache hit");
      res.setHeader("X-Cache", "HIT");
      res.setHeader("Content-Type", "application/json");
      res.send(cached);
      return;
    }

    // Forward to Overpass
    log.info({ queryLength: query.length }, "Forwarding to Overpass");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);

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
          signal: controller.signal,
        });
        if (overpassRes.ok) break;
      } catch {
        log.warn({ url }, "Overpass fetch failed, trying next");
      }
    }

    clearTimeout(timeout);

    if (!overpassRes || !overpassRes.ok) {
      const body = overpassRes ? await overpassRes.text() : "All Overpass instances failed";
      log.warn(
        { status: overpassRes?.status, usedUrl },
        "Overpass returned non-OK status",
      );
      res.status(overpassRes?.status || 502).json({
        error: "Overpass API error",
        status: overpassRes?.status,
        detail: body.slice(0, 500),
      });
      return;
    }

    const data = await overpassRes.text();

    // Cache the response
    cache.set(cacheKey, data);
    log.info({ cacheKey, bytes: data.length }, "Cached Overpass response");

    res.setHeader("X-Cache", "MISS");
    res.setHeader("Content-Type", "application/json");
    res.send(data);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      log.error("Overpass request timed out");
      res.status(504).json({ error: "Overpass request timed out" });
      return;
    }
    log.error({ err }, "Overpass proxy error");
    res.status(502).json({ error: "Failed to reach Overpass API" });
  }
});

// ---------------------------------------------------------------------------
// SearXNG search proxy endpoint
// ---------------------------------------------------------------------------
app.post("/search", enrichLimiter, async (req, res) => {
  try {
    const { query, language } = req.body as { query?: string; language?: string };

    if (!query || typeof query !== "string") {
      res.status(400).json({ error: "Missing 'query' in request body" });
      return;
    }

    if (query.length > 500) {
      res.status(413).json({ error: "Search query too long (max 500 chars)" });
      return;
    }

    // Cache key
    const crypto = await import("crypto");
    const cacheKey = `search:${crypto.createHash("md5").update(query).digest("hex")}`;

    const cached = searchCache.get<string>(cacheKey);
    if (cached) {
      log.info({ cacheKey }, "Search cache hit");
      res.setHeader("X-Cache", "HIT");
      res.setHeader("Content-Type", "application/json");
      res.send(cached);
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

    log.info({ query: query.slice(0, 80) }, "Searching SearXNG");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    let searchRes: Response;
    try {
      searchRes = await fetch(`${SEARXNG_URL}/search?${params.toString()}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "Ravitools/1.0 (cycling POI enrichment)",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

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

    // Cache the response
    searchCache.set(cacheKey, data);
    log.info({ cacheKey, bytes: data.length }, "Cached search response");

    res.setHeader("X-Cache", "MISS");
    res.setHeader("Content-Type", "application/json");
    res.send(data);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      log.error("SearXNG request timed out");
      res.status(504).json({ error: "Search request timed out" });
      return;
    }
    log.error({ err }, "Search proxy error");
    res.status(502).json({ error: "Failed to reach search service" });
  }
});

// ---------------------------------------------------------------------------
// Nominatim reverse geocode proxy endpoint
// ---------------------------------------------------------------------------
app.post("/geocode", enrichLimiter, async (req, res) => {
  try {
    const { lat, lon } = req.body as { lat?: number; lon?: number };

    if (typeof lat !== "number" || typeof lon !== "number") {
      res.status(400).json({ error: "Missing 'lat' and 'lon' in request body" });
      return;
    }

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      res.status(400).json({ error: "Invalid coordinates" });
      return;
    }

    // Cache key — round to ~111m precision for cache efficiency
    const roundedLat = Math.round(lat * 1000) / 1000;
    const roundedLon = Math.round(lon * 1000) / 1000;
    const cacheKey = `geo:${roundedLat},${roundedLon}`;

    const cached = geocodeCache.get<string>(cacheKey);
    if (cached) {
      log.info({ cacheKey }, "Geocode cache hit");
      res.setHeader("X-Cache", "HIT");
      res.setHeader("Content-Type", "application/json");
      res.send(cached);
      return;
    }

    // Nominatim reverse geocode
    const params = new URLSearchParams({
      lat: lat.toString(),
      lon: lon.toString(),
      format: "json",
      zoom: "14", // city/town level
      addressdetails: "1",
    });

    log.info({ lat: roundedLat, lon: roundedLon }, "Reverse geocoding via Nominatim");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    let geoRes: Response;
    try {
      geoRes = await fetch(`${NOMINATIM_URL}/reverse?${params.toString()}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "Ravitools/1.0 (cycling POI enrichment)",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!geoRes.ok) {
      const body = await geoRes.text();
      log.warn({ status: geoRes.status }, "Nominatim returned non-OK status");
      res.status(geoRes.status).json({
        error: "Nominatim geocode error",
        status: geoRes.status,
        detail: body.slice(0, 500),
      });
      return;
    }

    const data = await geoRes.text();

    // Cache the response
    geocodeCache.set(cacheKey, data);
    log.info({ cacheKey }, "Cached geocode response");

    res.setHeader("X-Cache", "MISS");
    res.setHeader("Content-Type", "application/json");
    res.send(data);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      log.error("Nominatim request timed out");
      res.status(504).json({ error: "Geocode request timed out" });
      return;
    }
    log.error({ err }, "Geocode proxy error");
    res.status(502).json({ error: "Failed to reach geocode service" });
  }
});

// ---------------------------------------------------------------------------
// Website preview proxy endpoint
// ---------------------------------------------------------------------------
app.post("/fetch-page", enrichLimiter, async (req, res) => {
  try {
    const { url } = req.body as { url?: string };

    if (!url || typeof url !== "string") {
      res.status(400).json({ error: "Missing 'url' in request body" });
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      res.status(400).json({ error: "Invalid URL" });
      return;
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      res.status(400).json({ error: "Only http/https URLs are supported" });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    let pageRes: Response;
    try {
      pageRes = await fetch(parsedUrl.toString(), {
        method: "GET",
        redirect: "follow",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "Ravitools/1.0 (cycling POI enrichment)",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!pageRes.ok) {
      res.status(pageRes.status).json({
        error: "Website fetch error",
        status: pageRes.status,
      });
      return;
    }

    const contentType = pageRes.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      res.status(415).json({
        error: "Unsupported content type",
        contentType,
      });
      return;
    }

    const html = await pageRes.text();
    const normalized = html.replace(/\s+/g, " ").trim();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const descriptionMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["'][^>]*>/i)
      ?? html.match(/<meta\s+content=["']([\s\S]*?)["']\s+name=["']description["'][^>]*>/i);
    const bodyText = normalized
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    res.json({
      url: parsedUrl.toString(),
      finalUrl: pageRes.url,
      contentType,
      title: titleMatch?.[1]?.replace(/\s+/g, " ").trim() || null,
      description: descriptionMatch?.[1]?.replace(/\s+/g, " ").trim() || null,
      excerpt: bodyText.slice(0, 1200) || null,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      res.status(504).json({ error: "Website fetch timed out" });
      return;
    }
    log.error({ err }, "Website fetch proxy error");
    res.status(502).json({ error: "Failed to fetch website" });
  }
});

// ---------------------------------------------------------------------------
// Start (only when run directly, not when imported for testing)
// ---------------------------------------------------------------------------
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    log.info({ port: PORT, overpass: OVERPASS_URL }, "Ravitools proxy started");
  });
}

export default app;
