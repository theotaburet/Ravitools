// ---------------------------------------------------------------------------
// SearXNG search adapter, Google Maps link builder, Nominatim reverse geocode
// ---------------------------------------------------------------------------

import type { POI, SearchSnippet, EnrichmentPlatform, WebsitePreview } from "../../types";
import { dlog } from "../debug-log";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Max snippets to keep per POI search */
const MAX_SNIPPETS = 8;

/** Timeout for search/geocode requests (ms) */
const REQUEST_TIMEOUT = 15_000;

const OFFICIAL_SITE_TAGS = ["website", "contact:website", "url", "contact:web"] as const;

// ---------------------------------------------------------------------------
// Google Maps link builder (no API key needed)
// ---------------------------------------------------------------------------

/**
 * Build a Google Maps search URL from POI name + coordinates.
 * Works universally: opens in browser or Google Maps app.
 */
export function buildGoogleMapsUrl(poi: POI): string {
  const query = encodeURIComponent(poi.name);
  return `https://www.google.com/maps/search/${query}/@${poi.lat},${poi.lon},17z`;
}

/**
 * Build a Google Maps directions URL (from current location to POI).
 */
export function buildGoogleMapsDirectionsUrl(poi: POI): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${poi.lat},${poi.lon}`;
}

/** Pick the best official website URL from OSM tags when present. */
export function getOfficialWebsiteUrl(poi: POI): string | null {
  for (const key of OFFICIAL_SITE_TAGS) {
    const value = poi.tags[key];
    if (!value?.trim()) continue;

    const trimmed = value.trim();
    if (/^https?:\/\//i.test(trimmed)) return trimmed;
    if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) return `https://${trimmed}`;
  }
  return null;
}

/** Classify a source URL into a small set of known review/discovery platforms. */
export function classifySourcePlatform(url: string): EnrichmentPlatform {
  let hostname = "";
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return "other";
  }

  if (hostname.includes("google.")) return "google_maps";
  if (hostname.includes("yelp.")) return "yelp";
  if (hostname.includes("tripadvisor.")) return "tripadvisor";
  if (hostname.includes("facebook.")) return "facebook";
  if (hostname.includes("instagram.")) return "instagram";
  if (hostname.includes("booking.")) return "booking";
  if (hostname.includes("hotels.")) return "hotels_com";
  return "other";
}

/** Fetch a small preview of an official website through the server proxy. */
export async function fetchWebsitePreview(
  url: string,
  apiBase: string = "/api",
  signal?: AbortSignal,
): Promise<WebsitePreview | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  if (signal) {
    signal.addEventListener("abort", () => controller.abort());
  }

  try {
    const res = await fetch(`${apiBase}/fetch-page`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });

    if (!res.ok) return null;
    return await res.json() as WebsitePreview;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

// ---------------------------------------------------------------------------
// SearXNG search adapter
// ---------------------------------------------------------------------------

/** Raw SearXNG result from the JSON API */
interface SearXNGResult {
  title: string;
  url: string;
  content?: string;
  engine: string;
  score?: number;
}

/** SearXNG JSON API response */
interface SearXNGResponse {
  results: SearXNGResult[];
  query: string;
  number_of_results?: number;
}

/**
 * Build an effective search query for a POI.
 * Includes the POI name and locality for better precision.
 * Adds category context for generic-named POIs.
 */
export function buildSearchQuery(
  poi: POI,
  locality: string | null,
): string {
  const parts: string[] = [];

  // POI name
  const name = poi.name.trim();
  if (name && name !== "Unknown") {
    parts.push(`"${name}"`);
  }

  // Locality for geographic precision
  if (locality) {
    parts.push(locality);
  }

  // Category hint for generic names or unnamed POIs
  const genericNames = ["Unknown", "unnamed", ""];
  if (genericNames.includes(name)) {
    // Use OSM tags for context
    const tagHint = Object.entries(poi.tags)
      .filter(([k]) => ["amenity", "shop", "tourism", "leisure"].includes(k))
      .map(([, v]) => v.replace(/_/g, " "))
      .join(" ");
    if (tagHint) parts.push(tagHint);
  }

  // Add "avis" / "review" to bias towards review content
  parts.push("avis OR review OR horaires");

  // Bias towards the source families we want to compile.
  parts.push("\"google maps\" OR yelp OR tripadvisor OR facebook OR instagram");

  if (poi.category === "Sleeping place") {
    parts.push("booking OR \"hotels.com\"");
  }

  return parts.join(" ");
}

/**
 * Search for POI information via the server-side SearXNG proxy.
 * Returns cleaned snippets ready for LLM synthesis.
 * Retries on 429 (rate-limited) and network errors with exponential backoff.
 */
export async function searchPoi(
  poi: POI,
  locality: string | null,
  apiBase: string = "/api",
  signal?: AbortSignal,
  maxRetries: number = 3,
): Promise<SearchSnippet[]> {
  const query = buildSearchQuery(poi, locality);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (signal?.aborted) throw new Error("Cancelled");

    if (attempt > 0) {
      // Exponential backoff: 2s, 4s, 8s
      const delayMs = 2000 * Math.pow(2, attempt - 1);
      await new Promise((r) => setTimeout(r, delayMs));
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    // Combine external signal with our timeout
    if (signal) {
      signal.addEventListener("abort", () => controller.abort());
    }

    try {
      const res = await fetch(`${apiBase}/search`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, language: "auto" }),
        signal: controller.signal,
      });

      if (res.status === 429) {
        lastError = new Error(`Search rate-limited (429)`);
        continue; // retry with backoff
      }

      if (res.status === 502 || res.status === 503 || res.status === 504) {
        lastError = new Error(`Search server error (${res.status})`);
        continue; // retry on transient server errors
      }

      if (!res.ok) {
        throw new Error(`Search failed: ${res.status} ${res.statusText}`);
      }

      const data: SearXNGResponse = await res.json();
      const log = dlog("search");

      // Convert to our snippet format, deduplicate, limit
      const seen = new Set<string>();
      const snippets: SearchSnippet[] = [];

      for (const result of data.results) {
        if (snippets.length >= MAX_SNIPPETS) break;
        if (!result.content?.trim()) continue;

        // Deduplicate by URL
        if (seen.has(result.url)) continue;
        seen.add(result.url);

        snippets.push({
          title: result.title || "",
          url: result.url,
          content: result.content.trim(),
          engine: result.engine || "unknown",
        });
      }

      // Debug: log raw search results for visibility
      log.info(`SearXNG results for "${poi.name}"`, {
        query,
        totalResults: data.results.length,
        keptSnippets: snippets.length,
      });
      for (const s of snippets) {
        log.debug(`  [${s.engine}] ${s.title}`, { url: s.url, content: s.content.slice(0, 120) });
      }

      return snippets;
    } catch (err) {
      clearTimeout(timeout);
      if (signal?.aborted) throw new Error("Cancelled");

      lastError = err instanceof Error ? err : new Error(String(err));

      // Retry on network errors (ECONNREFUSED, fetch failed, etc.)
      if (attempt < maxRetries && lastError.name !== "AbortError") {
        continue;
      }
      throw lastError;
    } finally {
      clearTimeout(timeout);
    }
  }

  throw lastError ?? new Error("Search failed after retries");
}

// ---------------------------------------------------------------------------
// Nominatim reverse geocode adapter
// ---------------------------------------------------------------------------

/** Nominatim reverse geocode response (simplified) */
interface NominatimReverseResponse {
  address?: {
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    municipality?: string;
    county?: string;
    state?: string;
    country?: string;
  };
  display_name?: string;
}

/**
 * Resolve the locality (city/town/village) for a POI via Nominatim reverse geocode.
 * Uses the server-side proxy to respect Nominatim rate limits.
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
  apiBase: string = "/api",
  signal?: AbortSignal,
): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  if (signal) {
    signal.addEventListener("abort", () => controller.abort());
  }

  try {
    const res = await fetch(`${apiBase}/geocode`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lat, lon }),
      signal: controller.signal,
    });

    if (!res.ok) {
      // Non-critical: return null, enrichment continues without locality
      return null;
    }

    const data: NominatimReverseResponse = await res.json();

    // Pick the most specific locality available
    const addr = data.address;
    if (!addr) return null;

    return (
      addr.city ||
      addr.town ||
      addr.village ||
      addr.hamlet ||
      addr.municipality ||
      addr.county ||
      null
    );
  } catch {
    // Non-critical failure
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
