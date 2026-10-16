import compression from "compression";
import express from "express";
import helmet from "helmet";
import { getBrowser, randomDelay, sleep } from "./browser.js";
import { cache } from "./caches.js";
import { SEARXNG_URL } from "./config.js";
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

// nginx on the same host forwards the client IP (deployment.md): rate limits key
// on it. A forwarded header from anyone else is ignored.
app.set("trust proxy", "loopback");

app.use(helmet());
app.use(compression());
app.use(express.json({ limit: "1mb" }));
app.use(express.text({ limit: "1mb", type: "application/x-www-form-urlencoded" }));

// --- Google Maps scraper: one job system, mounted on the path the client calls. ---
export const googleMapsSystem = createScraperJobSystem(googleMapsPlugin, {
  log,
  sleep,
  randomDelay,
  getBrowser,
});
googleMapsSystem.load(); // restore persisted jobs from disk (if any)
mountScraperEndpoints(app, googleMapsSystem, {
  basePath: "/google-maps-preview",
  limiter: scraperLimiter,
  log,
});

// --- Health check ---
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
    cache_keys: cache.size,
    uptime: process.uptime(),
    services,
  });
});

// SearXNG UI redirect: lets the user solve a CAPTCHA in the same browser
// session/IP as the enrichment requests (opened via /api/searxng-ui)
app.get("/searxng-ui", (_req, res) => {
  res.redirect(302, `${SEARXNG_URL}/`);
});

// --- Proxy routes ---
app.use(overpassRouter);
app.use(searchRouter);
app.use(geocodeRouter);
app.use(fetchPageRouter);
app.use(poiRouter);
