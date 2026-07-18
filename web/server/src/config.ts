// ---------------------------------------------------------------------------
// Config — env vars parsed once at import time
// ---------------------------------------------------------------------------
export const PORT = parseInt(process.env.PORT || "3001", 10);
export const OVERPASS_URL = process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
export const OVERPASS_FALLBACK_URL =
  process.env.OVERPASS_FALLBACK_URL || "https://overpass.kumi.systems/api/interpreter";
export const SEARXNG_URL = process.env.SEARXNG_URL || "http://localhost:8888";
export const NOMINATIM_URL = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org";

// AUDIT S1: fail fast on a malformed upstream URL from env (config typo) rather than
// discovering it on the first request. (Not a public-IP check — SearXNG is intentionally local.)
for (const [name, url] of Object.entries({
  OVERPASS_URL,
  OVERPASS_FALLBACK_URL,
  SEARXNG_URL,
  NOMINATIM_URL,
})) {
  try {
    new URL(url);
  } catch {
    throw new Error(`Invalid ${name}: "${url}" is not a valid URL`);
  }
}

export const CACHE_TTL = parseInt(process.env.CACHE_TTL || "86400", 10); // 24h default
export const SEARCH_CACHE_TTL = parseInt(process.env.SEARCH_CACHE_TTL || "604800", 10); // 7 days
export const GEOCODE_CACHE_TTL = parseInt(process.env.GEOCODE_CACHE_TTL || "2592000", 10); // 30 days
export const MAX_QUERY_LENGTH = parseInt(process.env.MAX_QUERY_LENGTH || "32000", 10);
export const RATE_LIMIT_WINDOW_MS = parseInt(process.env.RATE_LIMIT_WINDOW_MS || "60000", 10);
export const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "60", 10);
