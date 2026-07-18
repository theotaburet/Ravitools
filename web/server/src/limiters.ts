import rateLimit from "express-rate-limit";
import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "./config.js";

export const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests. Please wait before querying again.",
  },
});

/** Separate rate limiter for enrichment endpoints (more generous) */
export const enrichLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.ENRICH_RATE_LIMIT ?? 300), // 5 req/s average — proxying to our own SearXNG
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many enrichment requests. Please wait.",
  },
});

/** Stricter limiter for the expensive Playwright scraper endpoints (AUDIT S8). */
export const scraperLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.SCRAPER_RATE_LIMIT ?? 20),
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many scraper requests. Please wait.",
  },
});
