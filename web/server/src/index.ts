import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import NodeCache from "node-cache";
import pino from "pino";
import { chromium, type Browser } from "playwright";
import { closeBrowserContext } from "./browser-context.js";
import {
  parseGoogleMapsHoursRow,
  normalizeDay,
  normalizeTimeString,
  extractGoogleMapsRating,
  extractGoogleMapsReviewCount,
  cleanGoogleMapsHours,
  extractPriceLevelFromText,
  GOOGLE_MAPS_PROXY_URL,
} from "./scrapers/google-maps.js";
import {
  buildYandexMapsUrl,
  parseYandexMapsHoursRow,
  normalizeYandexDay,
  normalizeYandexTimeString,
  extractYandexMapsRating,
  extractYandexMapsReviewCount,
  cleanYandexMapsHours,
  YANDEX_MAPS_PROXY_URL,
} from "./scrapers/yandex-maps.js";
import { mountAllScrapers } from "./scrapers/registry.js";
import { lookup } from "node:dns/promises";
import {
  initDb,
  isDbAvailable,
  getPoi,
  getPoisBatch,
  upsertPoi,
  type OsmType,
  type PoiKey,
} from "./db.js";

// ---------------------------------------------------------------------------
// SSRF guard — block requests to private/internal IPs
// ---------------------------------------------------------------------------
const PRIVATE_IP_RANGES = [
  /^127\./,                          // loopback
  /^10\./,                           // RFC 1918
  /^172\.(1[6-9]|2\d|3[01])\./,     // RFC 1918
  /^192\.168\./,                     // RFC 1918
  /^169\.254\./,                     // link-local
  /^0\./,                            // "this" network
  /^::1$/,                           // IPv6 loopback
  /^fe80:/i,                         // IPv6 link-local
  /^fc00:/i,                         // IPv6 ULA
  /^fd/i,                            // IPv6 ULA
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((re) => re.test(ip));
}

async function assertPublicHostname(hostname: string): Promise<void> {
  // Resolve to IP first to prevent DNS rebinding
  const { address } = await lookup(hostname);
  if (isPrivateIp(address)) {
    throw new Error(`Blocked request to private IP ${address} (hostname: ${hostname})`);
  }
}

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

type WebsiteStructuredData = {
  description: string | null;
  telephone: string | null;
  priceRange: string | null;
  openingHours: string[];
  rating: number | null;
  reviewCount: number | null;
};

let browserPromise: Promise<Browser> | null = null;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(minMs: number, maxMs: number): number {
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

function parseJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const matches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of matches) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return blocks;
}

function flattenJsonLd(node: unknown): Record<string, unknown>[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(flattenJsonLd);

  const record = node as Record<string, unknown>;
  const nested = [
    ...(Array.isArray(record["@graph"]) ? flattenJsonLd(record["@graph"]) : []),
    ...(Array.isArray(record.mainEntity) ? flattenJsonLd(record.mainEntity) : flattenJsonLd(record.mainEntity)),
  ];
  return [record, ...nested];
}

function firstString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.replace(/\s+/g, " ").trim();
    return trimmed || null;
  }
  return null;
}

function firstNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeOpeningHours(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(firstString).filter((item): item is string => Boolean(item));
  }
  const single = firstString(value);
  return single ? [single] : [];
}

function extractStructuredDataFromHtml(html: string): WebsiteStructuredData | null {
  const nodes = parseJsonLdBlocks(html).flatMap(flattenJsonLd);
  const aggregateRatings = nodes
    .map((node) => (node.aggregateRating && typeof node.aggregateRating === "object" ? node.aggregateRating as Record<string, unknown> : null))
    .filter((item): item is Record<string, unknown> => Boolean(item));

  const description = nodes.map((node) => firstString(node.description)).find(Boolean) ?? null;
  const telephone = nodes.map((node) => firstString(node.telephone)).find(Boolean) ?? null;
  const priceRange = nodes.map((node) => firstString(node.priceRange)).find(Boolean) ?? null;
  const openingHours = nodes.flatMap((node) => normalizeOpeningHours(node.openingHours));
  const rating = aggregateRatings.map((item) => firstNumber(item.ratingValue)).find((item) => item != null) ?? null;
  const reviewCount = aggregateRatings
    .map((item) => firstNumber(item.reviewCount) ?? firstNumber(item.ratingCount))
    .find((item) => item != null) ?? null;

  if (!description && !telephone && !priceRange && openingHours.length === 0 && rating == null && reviewCount == null) {
    return null;
  }

  return {
    description,
    telephone,
    priceRange,
    openingHours: [...new Set(openingHours)],
    rating,
    reviewCount,
  };
}


async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const launchOptions: Parameters<typeof chromium.launch>[0] = { headless: true };
    if (GOOGLE_MAPS_PROXY_URL) {
      launchOptions.proxy = { server: GOOGLE_MAPS_PROXY_URL };
      log.info({ proxy: GOOGLE_MAPS_PROXY_URL }, "Google Maps browser: using proxy");
    }
    browserPromise = chromium.launch(launchOptions);
  }
  return browserPromise;
}

// All map-preview scraping (Google Maps, Yandex Maps) now lives in the
// generic scraper plugin system mounted via mountAllScrapers().
// See web/server/src/scrapers/registry.ts and job-system.ts.

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

// Scraper plugin systems (Google Maps, Yandex Maps, ...) — see
// web/server/src/scrapers/registry.ts for the full list. Each plugin gets
// its own NodeCache + persistent jobs file + retry queue + 5 endpoints
// mounted at both `/scrape/{name}` (canonical) and a legacy alias path.
// Mounted further down once the rate limiter is configured.

app.use(helmet());
app.use(compression());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
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
  max: Number(process.env.ENRICH_RATE_LIMIT ?? 300), // 5 req/s average — proxying to our own SearXNG
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many enrichment requests. Please wait.",
  },
});

// ---------------------------------------------------------------------------
// Mount all map scraper plugins (Google Maps, Yandex Maps, ...)
// Each plugin gets endpoints at both `/scrape/{name}` (canonical) and a
// legacy alias path (e.g. `/google-maps-preview`) for backward compatibility.
// See web/server/src/scrapers/registry.ts for the plugin list.
// ---------------------------------------------------------------------------
const scraperRegistry = mountAllScrapers({
  app,
  deps: { log, sleep, randomDelay, getBrowser },
  limiter: enrichLimiter,
  log,
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
// SearXNG UI redirect — lets the user solve a CAPTCHA in the same browser
// session/IP as the enrichment requests (opened via /api/searxng-ui)
// ---------------------------------------------------------------------------
app.get("/searxng-ui", (_req, res) => {
  res.redirect(302, `${SEARXNG_URL}/`);
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

/** Flush the search cache — useful after engine configuration changes */
app.delete("/cache/search", (req, res) => {
  const adminKey = process.env.ADMIN_API_KEY;
  if (adminKey && req.headers["x-admin-key"] !== adminKey) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const count = searchCache.keys().length;
  searchCache.flushAll();
  log.info({ flushed: count }, "Search cache flushed");
  res.json({ flushed: count });
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
    const { query, language, engines } = req.body as { query?: string; language?: string; engines?: string };

    if (!query || typeof query !== "string") {
      res.status(400).json({ error: "Missing 'query' in request body" });
      return;
    }

    if (query.length > 500) {
      res.status(413).json({ error: "Search query too long (max 500 chars)" });
      return;
    }

    // Cache key includes engines to avoid returning cached results from different engine sets
    const crypto = await import("crypto");
    const cacheInput = engines ? `${query}|engines=${engines}` : query;
    const cacheKey = `search:${crypto.createHash("md5").update(cacheInput).digest("hex")}`;

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

    // Forward engine selection to SearXNG if specified
    if (engines && typeof engines === "string") {
      params.set("engines", engines);
    }

    log.info({ query: query.slice(0, 80), engines: engines || "default" }, "Searching SearXNG");

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

    // Log unresponsive engines for observability
    try {
      const parsed = JSON.parse(data);
      if (parsed.unresponsive_engines?.length > 0) {
        log.warn({
          query: (req.body as { query?: string }).query?.slice(0, 60),
          unresponsive: parsed.unresponsive_engines,
        }, "SearXNG unresponsive engines");
      }
    } catch { /* non-critical parse failure */ }

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

    // SSRF guard — block private/internal IPs
    try {
      await assertPublicHostname(parsedUrl.hostname);
    } catch (err) {
      log.warn({ url, err }, "SSRF blocked: private IP detected");
      res.status(403).json({ error: "URL points to a private/internal address" });
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
    const structuredData = extractStructuredDataFromHtml(html);

    res.json({
      url: parsedUrl.toString(),
      finalUrl: pageRes.url,
      contentType,
      title: titleMatch?.[1]?.replace(/\s+/g, " ").trim() || null,
      description: descriptionMatch?.[1]?.replace(/\s+/g, " ").trim() || structuredData?.description || null,
      excerpt: bodyText.slice(0, 1200) || null,
      structuredData,
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

// Map scraper endpoints (/google-maps-preview*, /yandex-maps-preview*,
// /scrape/{name}*) are mounted via mountAllScrapers() above.


// ---------------------------------------------------------------------------
// POI enrichment cache (Postgres + PostGIS)
// Anonymous public read/write. Returns 503 if DB is not configured.
// ---------------------------------------------------------------------------

const VALID_OSM_TYPES = new Set<OsmType>(["node", "way", "relation"]);

function parseOsmType(raw: unknown): OsmType | null {
  if (typeof raw !== "string") return null;
  return VALID_OSM_TYPES.has(raw as OsmType) ? (raw as OsmType) : null;
}

function parseOsmId(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return String(Math.trunc(raw));
  }
  if (typeof raw === "string" && /^\d{1,19}$/.test(raw)) {
    return raw;
  }
  return null;
}

function parseLatLon(lat: unknown, lon: unknown): { lat: number; lon: number } | null {
  const la = typeof lat === "number" ? lat : Number(lat);
  const lo = typeof lon === "number" ? lon : Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  return { lat: la, lon: lo };
}

const MAX_BATCH_KEYS = 200;
const MAX_AGE_DAYS_DEFAULT = 90;
const MAX_AGE_DAYS_MAX = 365;

/** GET /poi/:osm_type/:osm_id — single lookup */
app.get("/poi/:osm_type/:osm_id", enrichLimiter, async (req, res) => {
  const osm_type = parseOsmType(req.params.osm_type);
  const osm_id = parseOsmId(req.params.osm_id);
  if (!osm_type || !osm_id) {
    res.status(400).json({ error: "Invalid osm_type or osm_id" });
    return;
  }
  if (!isDbAvailable()) {
    res.status(503).json({ error: "POI cache disabled" });
    return;
  }
  const maxAgeDaysRaw = Number(req.query.max_age_days ?? MAX_AGE_DAYS_DEFAULT);
  const maxAgeDays = Number.isFinite(maxAgeDaysRaw)
    ? Math.min(Math.max(1, maxAgeDaysRaw), MAX_AGE_DAYS_MAX)
    : MAX_AGE_DAYS_DEFAULT;
  const row = await getPoi(osm_type, osm_id, maxAgeDays);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

/** POST /poi/search — batch lookup body: { keys: [{osm_type, osm_id}], max_age_days? } */
app.post("/poi/search", enrichLimiter, async (req, res) => {
  const body = req.body as { keys?: unknown; max_age_days?: unknown };
  if (!Array.isArray(body?.keys)) {
    res.status(400).json({ error: "Body must include `keys` array" });
    return;
  }
  if (body.keys.length > MAX_BATCH_KEYS) {
    res.status(400).json({ error: `Too many keys (max ${MAX_BATCH_KEYS})` });
    return;
  }
  if (!isDbAvailable()) {
    res.status(503).json({ error: "POI cache disabled" });
    return;
  }
  const parsed: PoiKey[] = [];
  for (const k of body.keys) {
    if (!k || typeof k !== "object") continue;
    const t = parseOsmType((k as { osm_type?: unknown }).osm_type);
    const id = parseOsmId((k as { osm_id?: unknown }).osm_id);
    if (t && id) parsed.push({ osm_type: t, osm_id: id });
  }
  const maxAgeDaysRaw = Number(body.max_age_days ?? MAX_AGE_DAYS_DEFAULT);
  const maxAgeDays = Number.isFinite(maxAgeDaysRaw)
    ? Math.min(Math.max(1, maxAgeDaysRaw), MAX_AGE_DAYS_MAX)
    : MAX_AGE_DAYS_DEFAULT;
  const found = await getPoisBatch(parsed, maxAgeDays);
  res.json({
    requested: parsed.length,
    hits: found.size,
    misses: parsed.length - found.size,
    results: Array.from(found.values()),
  });
});

/** PUT /poi/:osm_type/:osm_id — upsert enrichment */
app.put("/poi/:osm_type/:osm_id", enrichLimiter, async (req, res) => {
  const osm_type = parseOsmType(req.params.osm_type);
  const osm_id = parseOsmId(req.params.osm_id);
  if (!osm_type || !osm_id) {
    res.status(400).json({ error: "Invalid osm_type or osm_id" });
    return;
  }
  const body = req.body as {
    category?: unknown;
    lat?: unknown;
    lon?: unknown;
    name?: unknown;
    enrichment?: unknown;
  };
  if (typeof body?.category !== "string" || body.category.length === 0 || body.category.length > 100) {
    res.status(400).json({ error: "Invalid category" });
    return;
  }
  const coords = parseLatLon(body.lat, body.lon);
  if (!coords) {
    res.status(400).json({ error: "Invalid lat/lon" });
    return;
  }
  if (body.enrichment === null || typeof body.enrichment !== "object") {
    res.status(400).json({ error: "Invalid enrichment payload" });
    return;
  }
  // Soft size guard — JSON.stringify is O(n) but bounded by express.json 1mb limit anyway
  const serialized = JSON.stringify(body.enrichment);
  if (serialized.length > 200_000) {
    res.status(413).json({ error: "Enrichment payload too large" });
    return;
  }
  if (!isDbAvailable()) {
    res.status(503).json({ error: "POI cache disabled" });
    return;
  }
  const name = typeof body.name === "string" ? body.name.slice(0, 500) : null;
  const ok = await upsertPoi({
    osm_type,
    osm_id,
    category: body.category.slice(0, 100),
    lat: coords.lat,
    lon: coords.lon,
    name,
    enrichment: body.enrichment,
  });
  if (!ok) {
    res.status(500).json({ error: "Upsert failed" });
    return;
  }
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Start (only when run directly, not when imported for testing)
// ---------------------------------------------------------------------------
if (process.env.NODE_ENV !== "test") {
  // Fire-and-forget DB init (graceful degradation if unavailable)
  initDb().catch((err) => log.error({ err: err?.message }, "DB init unexpected error"));

  app.listen(PORT, () => {
    log.info({ port: PORT, overpass: OVERPASS_URL }, "Ravitools proxy started");
  });

  // Graceful shutdown — close Playwright browser to avoid orphaned Chromium processes
  const shutdown = async () => {
    log.info("Shutting down...");
    try {
      // Flush + close shared context first (saves cookies to disk)
      await closeBrowserContext();
    } catch { /* ignore */ }
    if (browserPromise) {
      try {
        const browser = await browserPromise;
        await browser.close();
        log.info("Playwright browser closed");
      } catch { /* already closed */ }
    }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

export default app;

// ---------------------------------------------------------------------------
// Test-only exports (used by server unit tests)
// Not part of the public API.
// ---------------------------------------------------------------------------
// Convenience accessors so tests don't have to dig into the registry map.
const googleMapsSystem = scraperRegistry.systems.get("google-maps")!;
const yandexMapsSystem = scraperRegistry.systems.get("yandex-maps")!;

export const _testExports = {
  // Pure helpers (Google)
  parseGoogleMapsHoursRow,
  normalizeDay,
  normalizeTimeString,
  extractGoogleMapsRating,
  extractGoogleMapsReviewCount,
  cleanGoogleMapsHours,
  extractPriceLevelFromText,
  GOOGLE_MAPS_PROXY_URL,
  // Google scraper system (back-compat shape for legacy tests)
  googleMapsJobCache: googleMapsSystem.jobCache,
  persistGoogleMapsJobs: googleMapsSystem.persist,
  loadPersistedGoogleMapsJobs: googleMapsSystem.load,
  GOOGLE_MAPS_JOBS_FILE: googleMapsSystem.jobsFile,
  GOOGLE_MAPS_FAILURES_FILE: googleMapsSystem.failuresFile,
  appendGoogleMapsFailure: (record: { url: string; poiName: string | null; attempts: number; lastError: string; failedAt: string }) =>
    googleMapsSystem.appendFailure({ source: "google-maps", ...record }),
  // Pure helpers (Yandex)
  buildYandexMapsUrl,
  parseYandexMapsHoursRow,
  normalizeYandexDay,
  normalizeYandexTimeString,
  extractYandexMapsRating,
  extractYandexMapsReviewCount,
  cleanYandexMapsHours,
  YANDEX_MAPS_PROXY_URL,
  // Yandex scraper system
  yandexMapsJobCache: yandexMapsSystem.jobCache,
  persistYandexMapsJobs: yandexMapsSystem.persist,
  loadPersistedYandexMapsJobs: yandexMapsSystem.load,
  YANDEX_MAPS_JOBS_FILE: yandexMapsSystem.jobsFile,
  YANDEX_MAPS_FAILURES_FILE: yandexMapsSystem.failuresFile,
  appendYandexMapsFailure: (record: { url: string; poiName: string | null; attempts: number; lastError: string; failedAt: string }) =>
    yandexMapsSystem.appendFailure({ source: "yandex-maps", ...record }),
  // Generic registry access (for new plugin-aware tests)
  getScraperSystem: (name: string) => scraperRegistry.systems.get(name),
};
