import compression from "compression";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import { getBrowser, randomDelay, sleep } from "./browser.js";
import { cache, geocodeCache, searchCache } from "./caches.js";
import { SEARXNG_URL } from "./config.js";
import { timingSafeEqualStr } from "./http.js";
import { scraperLimiter } from "./limiters.js";
import { log } from "./logger.js";
import { fetchPageRouter } from "./routes/fetch-page.js";
import { geocodeRouter } from "./routes/geocode.js";
import { overpassRouter } from "./routes/overpass.js";
import { poiRouter } from "./routes/poi.js";
import { searchRouter } from "./routes/search.js";
import { mountScraperEndpoints } from "./scrapers/endpoints.js";
import { googleMapsPlugin } from "./scrapers/google-maps.js";
import { createScraperJobSystem } from "./scrapers/job-system.js";

export const app = express();

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
// Google Maps scraper — one job system, mounted on the path the client calls.
// AUDIT R28/R29: the registry + dual-mounted `/scrape/{name}` alias routes
// served a single plugin with zero canonical-path callers; both are gone.
// ---------------------------------------------------------------------------
export const googleMapsSystem = createScraperJobSystem(googleMapsPlugin, {
  log,
  sleep,
  randomDelay,
  getBrowser,
});
googleMapsSystem.load(); // restore persisted jobs from disk (if any)
mountScraperEndpoints(app, googleMapsPlugin, googleMapsSystem, {
  basePath: "/google-maps-preview",
  limiter: scraperLimiter,
  log,
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/health", async (_req, res) => {
  const services: Record<string, "ok" | "error"> = {};

  try {
    await fetch(`${SEARXNG_URL}/health`, { signal: AbortSignal.timeout(3000) });
    services.searxng = "ok";
  } catch {
    services.searxng = "error";
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
// Cache stats + admin flush
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
  // AUDIT R7: fail closed — no configured key means no admin route, not open admin.
  if (!adminKey) {
    res.status(503).json({ error: "Admin API not configured (set ADMIN_API_KEY)" });
    return;
  }
  const provided = req.headers["x-admin-key"];
  if (!(typeof provided === "string" && timingSafeEqualStr(provided, adminKey))) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const count = searchCache.keys().length;
  searchCache.flushAll();
  log.info({ flushed: count }, "Search cache flushed");
  res.json({ flushed: count });
});

// ---------------------------------------------------------------------------
// Proxy routes
// ---------------------------------------------------------------------------
app.use(overpassRouter);
app.use(searchRouter);
app.use(geocodeRouter);
app.use(fetchPageRouter);
app.use(poiRouter);
