// ---------------------------------------------------------------------------
// SearXNG search adapter, Google Maps link builder, Nominatim reverse geocode
// ---------------------------------------------------------------------------

import type { POI, SearchSnippet, EnrichmentPlatform, WebsitePreview, PoiCategory } from "../../types";
import { dlog } from "../debug-log";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Max snippets to keep per POI search */
const MAX_SNIPPETS = 8;

/** Timeout for search/geocode requests (ms) */
const REQUEST_TIMEOUT = 15_000;

const OFFICIAL_SITE_TAGS = ["website", "contact:website", "url", "contact:web"] as const;

/**
 * Domains that should NOT be treated as official websites.
 * Social profiles, aggregators, and review platforms are not official sites.
 * Includes exact domains and base-name prefixes for multi-TLD platforms.
 * (WS5: harden official website detection)
 */
const REJECTED_OFFICIAL_DOMAINS = new Set([
  "facebook.com", "instagram.com", "twitter.com", "x.com",
  "google.com", "yelp.com", "yelp.fr",
  "tripadvisor.com", "tripadvisor.fr", "tripadvisor.de", "tripadvisor.es", "tripadvisor.it", "tripadvisor.co.uk",
  "booking.com",
  "hotels.com", "airbnb.com", "airbnb.fr", "expedia.com", "expedia.fr",
  "foursquare.com", "pagesjaunes.fr", "komoot.com",
  "linkedin.com", "youtube.com", "tiktok.com",
]);

/**
 * Base names of multi-TLD platforms.
 * A hostname starting with one of these followed by a dot is rejected.
 * Catches tripadvisor.*, airbnb.*, etc. without enumerating all TLDs.
 */
const REJECTED_DOMAIN_PREFIXES = [
  "tripadvisor", "airbnb", "expedia", "yelp", "booking",
];

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

// ---------------------------------------------------------------------------
// Official website detection (WS5: hardened)
// ---------------------------------------------------------------------------

/**
 * Pick the best official website URL from OSM tags when present.
 * Rejects social profiles, aggregators, and review platform URLs.
 * (WS5: harden official website detection)
 */
export function getOfficialWebsiteUrl(poi: POI): string | null {
  for (const key of OFFICIAL_SITE_TAGS) {
    const value = poi.tags[key];
    if (!value?.trim()) continue;

    const trimmed = value.trim();
    let url: string;
    if (/^https?:\/\//i.test(trimmed)) {
      url = trimmed;
    } else if (/^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(trimmed)) {
      url = `https://${trimmed}`;
    } else {
      continue;
    }

    // WS5: reject known non-official domains
    if (isRejectedOfficialDomain(url)) continue;

    return url;
  }
  return null;
}

/**
 * Check if a URL points to a known non-official domain (social, aggregator, review).
 * Exported for testing.
 * (WS5)
 */
export function isRejectedOfficialDomain(url: string): boolean {
  try {
    const hostname = new URL(url).hostname.toLowerCase().replace(/^www\./, "").replace(/^m\./, "");
    // Exact match or subdomain match against known domains
    for (const rejected of REJECTED_OFFICIAL_DOMAINS) {
      if (hostname === rejected || hostname.endsWith(`.${rejected}`)) return true;
    }
    // Prefix match for multi-TLD platforms (e.g. tripadvisor.fr, airbnb.it)
    for (const prefix of REJECTED_DOMAIN_PREFIXES) {
      if (hostname === prefix || hostname.startsWith(`${prefix}.`)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Detect if a snippet URL matches the official website domain.
 * Useful for identifying which snippets come from the official source.
 * (WS5: snippet domain matching)
 */
export function isOfficialDomainSnippet(snippetUrl: string, officialUrl: string | null): boolean {
  if (!officialUrl) return false;
  try {
    const officialHost = new URL(officialUrl).hostname.toLowerCase().replace(/^www\./, "");
    const snippetHost = new URL(snippetUrl).hostname.toLowerCase().replace(/^www\./, "");
    return snippetHost === officialHost || snippetHost.endsWith(`.${officialHost}`);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Source platform classification (WS7: better matching)
// ---------------------------------------------------------------------------

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

/**
 * Normalize a URL for deduplication.
 * Strips tracking params, mobile prefixes, locale variants, trailing slashes.
 * (WS7: URL normalization & dedup)
 */
export function normalizeUrlForDedup(url: string): string {
  try {
    const parsed = new URL(url);
    // Strip common tracking parameters
    const trackingParams = [
      "utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term",
      "fbclid", "gclid", "ref", "source", "srsltid",
    ];
    for (const param of trackingParams) {
      parsed.searchParams.delete(param);
    }

    // Normalize hostname: strip www. and m. prefixes
    let host = parsed.hostname.toLowerCase();
    host = host.replace(/^(www|m)\./, "");
    parsed.hostname = host;

    // Strip trailing slash from pathname
    if (parsed.pathname.endsWith("/") && parsed.pathname.length > 1) {
      parsed.pathname = parsed.pathname.slice(0, -1);
    }

    return parsed.toString();
  } catch {
    return url;
  }
}

// ---------------------------------------------------------------------------
// Official website preview fetcher
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Per-category search query tuning (WS6)
// ---------------------------------------------------------------------------

/**
 * Category-specific search biases.
 * Each category has platform hints and context keywords that improve
 * the quality of search results from SearXNG.
 * (WS6: search query quality)
 */
const CATEGORY_SEARCH_BIAS: Record<string, {
  platformHints: string;
  contextKeywords: string;
}> = {
  "Restaurant or Bar": {
    platformHints: '"google maps" OR yelp OR tripadvisor',
    contextKeywords: "avis OR review OR horaires OR menu",
  },
  "Food shop": {
    platformHints: '"google maps" OR yelp',
    contextKeywords: "horaires OR ouverture OR avis OR review",
  },
  "Sleeping place": {
    platformHints: '"google maps" OR tripadvisor OR booking OR "hotels.com"',
    contextKeywords: "avis OR review OR tarif OR reservation",
  },
  "Gears": {
    platformHints: '"google maps" OR yelp',
    contextKeywords: "avis OR review OR réparation OR atelier OR repair",
  },
};

/** Default bias for categories without specific tuning */
const DEFAULT_SEARCH_BIAS = {
  platformHints: '"google maps" OR yelp OR tripadvisor OR facebook OR instagram',
  contextKeywords: "avis OR review OR horaires",
};

/**
 * Clean a POI name before using it in a search query.
 * Removes noise like parenthetical annotations, extra whitespace, etc.
 * (WS6: POI name cleanup)
 */
export function cleanPoiNameForSearch(name: string): string {
  if (!name) return "";
  let cleaned = name.trim();
  // Remove parenthetical annotations often found in OSM (e.g. "Le Zinc (closed)")
  cleaned = cleaned.replace(/\s*\([^)]*\)\s*$/, "").trim();
  // Remove trailing dashes with annotations
  cleaned = cleaned.replace(/\s*[-–]\s*(fermé|closed|temporairement|temporarily).*$/i, "").trim();
  return cleaned;
}

/**
 * Build an effective search query for a POI.
 * Uses per-category biases for better source targeting.
 * Cleans the POI name and adds geographic + category context.
 * (WS6: per-category query tuning)
 */
export function buildSearchQuery(
  poi: POI,
  locality: string | null,
): string {
  const parts: string[] = [];

  // POI name — cleaned and quoted
  const rawName = poi.name.trim();
  const cleanedName = cleanPoiNameForSearch(rawName);
  const isGeneric = !cleanedName || ["Unknown", "unnamed", ""].includes(cleanedName);

  if (!isGeneric) {
    parts.push(`"${cleanedName}"`);
  }

  // Locality for geographic precision
  if (locality) {
    parts.push(locality);
  }

  // Category hint for generic names or unnamed POIs
  if (isGeneric) {
    const tagHint = Object.entries(poi.tags)
      .filter(([k]) => ["amenity", "shop", "tourism", "leisure"].includes(k))
      .map(([, v]) => v.replace(/_/g, " "))
      .join(" ");
    if (tagHint) parts.push(tagHint);
  }

  // Per-category bias (WS6)
  const bias = CATEGORY_SEARCH_BIAS[poi.category] ?? DEFAULT_SEARCH_BIAS;
  parts.push(bias.contextKeywords);
  parts.push(bias.platformHints);

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

      // Convert to our snippet format, deduplicate (WS7: normalized URLs), limit
      const seen = new Set<string>();
      const snippets: SearchSnippet[] = [];

      for (const result of data.results) {
        if (snippets.length >= MAX_SNIPPETS) break;
        if (!result.content?.trim()) continue;

        // WS7: deduplicate by normalized URL (strips tracking params, www/m prefix, trailing /)
        const normalizedUrl = normalizeUrlForDedup(result.url);
        if (seen.has(normalizedUrl)) continue;
        seen.add(normalizedUrl);

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
