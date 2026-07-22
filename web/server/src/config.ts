// ---------------------------------------------------------------------------
// Config — env vars parsed once at import time
// ---------------------------------------------------------------------------
export const PORT = parseInt(process.env.PORT || "3001", 10);
// Mirror pool, tried in order. Public instances flap (429/406/slowness),
// so robustness comes from the pool, not from any single URL.
export const OVERPASS_URLS = (
  process.env.OVERPASS_URLS ||
  [
    process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
    "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
  ].join(",")
)
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);
export const SEARXNG_URL = process.env.SEARXNG_URL || "http://localhost:8888";
export const NOMINATIM_URL = process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org";

// AUDIT S1: fail fast on a malformed upstream URL from env (config typo) rather than
// discovering it on the first request. (Not a public-IP check — SearXNG is intentionally local.)
for (const [name, url] of Object.entries({
  ...Object.fromEntries(OVERPASS_URLS.map((u, i) => [`OVERPASS_URLS[${i}]`, u])),
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
