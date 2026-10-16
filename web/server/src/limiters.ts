import rateLimit from "express-rate-limit";
import { RATE_LIMIT_MAX, RATE_LIMIT_WINDOW_MS } from "./config.js";

/** Per-IP limit over a window, answering 429 with a JSON `error` */
function perIp(windowMs: number, limit: number, error: string) {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error },
  });
}

export const limiter = perIp(
  RATE_LIMIT_WINDOW_MS,
  RATE_LIMIT_MAX,
  "Too many requests. Please wait before querying again.",
);

/** Enrichment endpoints, more generous: 5 req/s average, proxying to our own SearXNG */
export const enrichLimiter = perIp(
  60_000,
  Number(process.env.ENRICH_RATE_LIMIT ?? 300),
  "Too many enrichment requests. Please wait.",
);

/** Stricter, for the expensive Playwright scraper endpoints */
export const scraperLimiter = perIp(
  60_000,
  Number(process.env.SCRAPER_RATE_LIMIT ?? 20),
  "Too many scraper requests. Please wait.",
);
