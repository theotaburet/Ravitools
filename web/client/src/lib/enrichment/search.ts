// ---------------------------------------------------------------------------
// SearXNG search adapter, Google Maps link builder, Nominatim reverse geocode
// ---------------------------------------------------------------------------

import type { POI, SearchSnippet, EnrichmentPlatform, WebsitePreview, PoiCategory, GeoContext, GoogleMapsPreview, GoogleMapsPreviewJob, GoogleFallbackJobStats } from "../../types";
import { dlog } from "../debug-log";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/** Max snippets to keep per POI search */
const MAX_SNIPPETS = 8;

/** Timeout for search/geocode requests (ms) */
const REQUEST_TIMEOUT = 15_000;

/**
 * Known-good SearXNG engines for POI enrichment.
 * Keep this explicit so we don't silently fall back to noisy/broken defaults.
 *
 * Engines removed:
 *   - yandex: constantly CAPTCHA'd, returns Russian/German noise
 *   - mojeek: access denied in a loop, English-biased, no French local content
 */
const SEARXNG_ENGINES = "presearch,bing,aol";

const ENGINE_COOLDOWN_MS = 30 * 60 * 1000;
const ENGINE_FAILURE_THRESHOLD = 2;
const ENGINE_FAILURE_PATTERNS = /(access denied|captcha|too many requests|http protocol error|timed out|network|forbidden)/i;
const BAD_RESULT_PATTERNS = [
  /my unicredit banking/i,
  /internet banking/i,
  /login/i,
  /sign in/i,
];

const engineFailureState = new Map<string, { failures: number; suspendedUntil: number; lastReason: string }>();

function getHealthyEngineList(): string {
  const now = Date.now();
  const healthy = SEARXNG_ENGINES
    .split(",")
    .map((engine) => engine.trim())
    .filter(Boolean)
    .filter((engine) => (engineFailureState.get(engine)?.suspendedUntil ?? 0) <= now);
  return healthy.join(",") || SEARXNG_ENGINES;
}

function noteEngineFailures(unresponsiveEngines: [string, string][]): void {
  const now = Date.now();
  for (const [engine, reason] of unresponsiveEngines) {
    if (!ENGINE_FAILURE_PATTERNS.test(reason)) continue;
    const prev = engineFailureState.get(engine) ?? { failures: 0, suspendedUntil: 0, lastReason: reason };
    const failures = prev.failures + 1;
    const suspendedUntil = failures >= ENGINE_FAILURE_THRESHOLD ? now + ENGINE_COOLDOWN_MS : prev.suspendedUntil;
    engineFailureState.set(engine, { failures, suspendedUntil, lastReason: reason });
  }
}

function noteSuccessfulEngines(snippets: SearchSnippet[]): void {
  for (const engine of new Set(snippets.map((snippet) => snippet.engine))) {
    const prev = engineFailureState.get(engine);
    if (!prev) continue;
    engineFailureState.set(engine, { failures: 0, suspendedUntil: 0, lastReason: prev.lastReason });
  }
}

/**
 * Reset engine failure state entirely.
 * Call on resetEnrichment() so new sessions start with a clean slate
 * even if the previous session suspended engines.
 */
export function resetEngineFailureState(): void {
  engineFailureState.clear();
}

/**
 * Regex covering non-latin scripts: CJK, Cyrillic, Arabic, Hebrew, Hangul, Hiragana/Katakana, Devanagari.
 * A snippet whose title or content is dominated by these characters is likely returned by a
 * wrong-locale engine (e.g. Yandex/Baidu) and should be rejected.
 */
const NON_LATIN_SCRIPT_RE = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\u0400-\u04ff\u0600-\u06ff\u0590-\u05ff\u0900-\u097f]/;

function isObviousNoiseSnippet(snippet: SearchSnippet, poi: POI, locality: string | null): boolean {
  const title = snippet.title.toLowerCase();
  const content = snippet.content.toLowerCase();
  const url = snippet.url.toLowerCase();

  if (BAD_RESULT_PATTERNS.some((pattern) => pattern.test(title) || pattern.test(content) || pattern.test(url))) {
    return true;
  }

  // Reject snippets dominated by non-latin script (CJK, Cyrillic, Arabic, etc.)
  // A single stray character is acceptable; reject only when the title or a long content prefix is non-latin.
  const sampleText = `${snippet.title} ${snippet.content.slice(0, 200)}`;
  const nonLatinChars = (sampleText.match(NON_LATIN_SCRIPT_RE) ?? []).length;
  const nonLatinDensity = nonLatinChars / Math.max(sampleText.replace(/\s/g, "").length, 1);
  if (nonLatinDensity > 0.15) {
    dlog("search").info(`Non-latin script noise rejected: "${snippet.title}" (density ${nonLatinDensity.toFixed(2)})`, { url: snippet.url });
    return true;
  }

  return false;
}

function extractStructuredWebsiteSnippets(websitePreview: WebsitePreview | null | undefined): SearchSnippet[] {
  if (!websitePreview?.structuredData) return [];
  const snippets: SearchSnippet[] = [];
  const sourceUrl = websitePreview.finalUrl || websitePreview.url;
  const sd = websitePreview.structuredData;

  if (sd.description) {
    snippets.push({
      title: websitePreview.title ?? "Official site",
      url: sourceUrl,
      content: sd.description,
      engine: "official_website",
    });
  }

  if (sd.openingHours.length > 0) {
    snippets.push({
      title: "Official opening hours",
      url: sourceUrl,
      content: `Opening hours: ${sd.openingHours.join("; ")}`,
      engine: "official_website",
    });
  }

  if (sd.rating != null || sd.reviewCount != null || sd.priceRange) {
    const facts = [
      sd.rating != null ? `Rating ${sd.rating}/5` : null,
      sd.reviewCount != null ? `${sd.reviewCount} reviews` : null,
      sd.priceRange ? `Price ${sd.priceRange}` : null,
    ].filter(Boolean).join(". ");
    if (facts) {
      snippets.push({
        title: "Official structured data",
        url: sourceUrl,
        content: facts,
        engine: "official_website",
      });
    }
  }

  return snippets;
}

function buildQueryVariants(
  poi: POI,
  locality: string | null,
  geoContext?: GeoContext | null,
): string[] {
  const base = buildSearchQuery(poi, locality, geoContext);
  const cleanName = cleanPoiNameForSearch(poi.name);

  // Keep only 2 variants to reduce noise and request count:
  //   1. Full geo-contextual query (most precise)
  //   2. Quoted name + locality fallback (simpler, catches different title formats)
  const variants = [
    base,
    [cleanName ? `"${cleanName}"` : null, locality].filter(Boolean).join(" "),
  ].map((query) => query.trim()).filter(Boolean);

  return [...new Set(variants)];
}

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
  if (hostname.includes("airbnb.")) return "airbnb";
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
    signal.addEventListener("abort", () => controller.abort(), { once: true });
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
  /** Engines that failed to respond: [[engine_name, error_message], ...] */
  unresponsive_engines?: [string, string][];
}

// ---------------------------------------------------------------------------
// Per-category search query tuning (WS6) + Google dorks
// ---------------------------------------------------------------------------

/**
 * Category-specific search biases.
 * Each category has lightweight context keywords that improve
 * the quality of search results from SearXNG.
 * No site: dorks — SearXNG handles multi-engine discovery;
 * Google Maps, Booking, Yelp, etc. surface naturally when relevant.
 * Geographic filtering post-search handles false positives.
 * (WS6: search query quality)
 */
const CATEGORY_SEARCH_BIAS: Record<string, {
  contextKeywords: string;
}> = {
  "Restaurant or Bar": {
    contextKeywords: "avis restaurant horaires",
  },
  "Food shop": {
    contextKeywords: "horaires magasin avis",
  },
  "Sleeping place": {
    contextKeywords: "avis hébergement tarif",
  },
  "Gears": {
    contextKeywords: "avis atelier vélo réparation",
  },
};

/** Default bias for categories without specific tuning */
const DEFAULT_SEARCH_BIAS = {
  contextKeywords: "avis",
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
 * Uses site: dorks for targeted platform results + geographic context.
 * Cleans the POI name and adds locality for disambiguation.
 * (WS6: per-category query tuning + Google dorks)
 */
export function buildSearchQuery(
  poi: POI,
  locality: string | null,
  geoContext?: GeoContext | null,
): string {
  const parts: string[] = [];

  // POI name — cleaned and quoted
  const rawName = poi.name.trim();
  const cleanedName = cleanPoiNameForSearch(rawName);
  const isGeneric = !cleanedName || ["Unknown", "unnamed", ""].includes(cleanedName);

  if (!isGeneric) {
    parts.push(`"${cleanedName}"`);
  }

  // Geographic precision: locality + county/state for disambiguation
  // This is critical for filtering irrelevant results from wrong cities
  const geoTerms: string[] = [];
  if (locality) geoTerms.push(locality);
  if (geoContext?.county && geoContext.county !== locality) geoTerms.push(geoContext.county);
  if (geoContext?.state && geoContext.state !== locality && geoContext.state !== geoContext?.county) {
    geoTerms.push(geoContext.state);
  }
  if (geoTerms.length > 0) {
    parts.push(geoTerms.join(" "));
  }

  // Category hint for generic names or unnamed POIs
  if (isGeneric) {
    const tagHint = Object.entries(poi.tags)
      .filter(([k]) => ["amenity", "shop", "tourism", "leisure"].includes(k))
      .map(([, v]) => v.replace(/_/g, " "))
      .join(" ");
    if (tagHint) parts.push(tagHint);
  }

  // Per-category context keywords (lightweight, no site: dorks)
  const bias = CATEGORY_SEARCH_BIAS[poi.category] ?? DEFAULT_SEARCH_BIAS;
  parts.push(bias.contextKeywords);

  return parts.join(" ");
}

// ---------------------------------------------------------------------------
// Geographic filtering of search results
// ---------------------------------------------------------------------------

/**
 * Known city/region names that are geographically far from each other.
 * If a snippet mentions a city that is NOT the expected locality,
 * it's likely a false positive (wrong establishment, homonym).
 */

/**
 * Check if a snippet is geographically coherent with the expected location.
 * Returns false if the snippet clearly refers to a different city/region.
 *
 * Strategy:
 * - Extract city/region mentions from snippet title + content
 * - If snippet mentions a specific city that is NOT the expected locality,
 *   and does NOT mention the expected locality, it's a mismatch
 * - Conservative: only reject when confident (explicit city mention in title)
 */
export function isSnippetGeographicallyCoherent(
  snippet: { title: string; content: string; url: string },
  geoContext: GeoContext | null,
  locality: string | null,
): boolean {
  if (!geoContext && !locality) return true; // No geo data, can't filter

  const expectedLocality = locality?.toLowerCase() ?? "";
  const expectedCounty = geoContext?.county?.toLowerCase() ?? "";
  const expectedState = geoContext?.state?.toLowerCase() ?? "";
  const expectedCountry = geoContext?.country?.toLowerCase() ?? "";

  // Combine title and content for analysis (title is more authoritative)
  const titleLower = snippet.title.toLowerCase();
  const contentLower = snippet.content.toLowerCase();
  const fullText = `${titleLower} ${contentLower}`;

  // If snippet mentions the expected locality, county, state or country → keep it
  if (expectedLocality && fullText.includes(expectedLocality)) return true;
  if (expectedCounty && fullText.includes(expectedCounty)) return true;
  if (expectedState && fullText.includes(expectedState)) return true;
  if (expectedCountry && fullText.includes(expectedCountry)) return true;

  // --- Title-based city detection ---
  // Tripadvisor, Google Maps, Booking titles often have "Name, City" pattern
  // e.g. "Deni's, Torrevieja" or "Hotel du Port - Lyon"
  const titleCityPatterns = [
    /,\s*([A-Z][a-zà-ÿ]+(?:\s+[A-Z][a-zà-ÿ]+)*)\s*[-–:·]?\s*/,    // "Name, City"
    /[-–]\s*([A-Z][a-zà-ÿ]+(?:\s+[A-Z][a-zà-ÿ]+)*)\s*$/,            // "Name - City"
    /in\s+([A-Z][a-zà-ÿ]+(?:\s+[A-Z][a-zà-ÿ]+)*)/i,                 // "... in City"
  ];

  for (const pattern of titleCityPatterns) {
    const match = snippet.title.match(pattern);
    if (match) {
      const mentionedCity = match[1].trim().toLowerCase();
      // Skip very short matches (noise) or matches that ARE the expected locality/region
      if (mentionedCity.length < 3) continue;
      if (expectedLocality && mentionedCity === expectedLocality) return true;
      if (expectedCounty && mentionedCity === expectedCounty) return true;
      if (expectedCountry && mentionedCity === expectedCountry) return true;

      // The title explicitly mentions a different city → suspicious
      // But only reject if it's NOT a substring of our expected locality
      if (expectedLocality && !expectedLocality.includes(mentionedCity) && !mentionedCity.includes(expectedLocality)) {
        dlog("search").info(`Geographic mismatch: snippet "${snippet.title}" mentions "${mentionedCity}" but expected "${expectedLocality}" (${expectedCountry})`, {
          url: snippet.url,
          mentionedCity,
          expectedLocality,
          expectedCountry,
        });
        return false;
      }
    }
  }

  // --- URL-based geographic check ---
  // Tripadvisor URLs contain city: tripadvisor.com/Restaurant_Review-g187529-...
  // Booking URLs contain city: booking.com/hotel/es/...
  // Don't reject based on URL alone — too many false positives

  return true; // Default: keep the snippet (conservative)
}

/**
 * Search for POI information via the server-side SearXNG proxy.
 * Returns cleaned snippets ready for LLM synthesis.
 * Applies geographic filtering to reject results from wrong locations.
 * Retries on 429 (rate-limited) and network errors with exponential backoff.
 */
export async function searchPoi(
  poi: POI,
  locality: string | null,
  apiBase: string = "/api",
  signal?: AbortSignal,
  maxRetries: number = 3,
  geoContext?: GeoContext | null,
): Promise<{ snippets: SearchSnippet[]; query: string; unresponsiveEngines: [string, string][] }> {
  let lastError: Error | null = null;
  let lastUnresponsiveEngines: [string, string][] = [];
  const queries = buildQueryVariants(poi, locality, geoContext);
  const requestedEngines = getHealthyEngineList();
  const log = dlog("search");

  for (const query of queries) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) throw new Error("Cancelled");

      if (attempt > 0) {
        const delayMs = 2000 * Math.pow(2, attempt - 1);
        await new Promise((r) => setTimeout(r, delayMs));
      }

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

      if (signal) {
        signal.addEventListener("abort", () => controller.abort(), { once: true });
      }

      try {
        const res = await fetch(`${apiBase}/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            language: "fr",
            engines: requestedEngines,
          }),
          signal: controller.signal,
        });

        if (res.status === 429) {
          lastError = new Error("Search rate-limited (429)");
          continue;
        }

        if (res.status === 502 || res.status === 503 || res.status === 504) {
          lastError = new Error(`Search server error (${res.status})`);
          continue;
        }

        if (!res.ok) {
          throw new Error(`Search failed: ${res.status} ${res.statusText}`);
        }

        const data: SearXNGResponse = await res.json();
        lastUnresponsiveEngines = data.unresponsive_engines ?? [];
        noteEngineFailures(lastUnresponsiveEngines);

        const seen = new Set<string>();
        const rawSnippets: SearchSnippet[] = [];

        for (const result of data.results) {
          if (rawSnippets.length >= MAX_SNIPPETS * 2) break;
          if (!result.content?.trim()) continue;

          const normalizedUrl = normalizeUrlForDedup(result.url);
          if (seen.has(normalizedUrl)) continue;
          seen.add(normalizedUrl);

          rawSnippets.push({
            title: result.title || "",
            url: result.url,
            content: result.content.trim(),
            engine: result.engine || "unknown",
          });
        }

        const snippets: SearchSnippet[] = [];
        let filteredCount = 0;
        for (const s of rawSnippets) {
          if (snippets.length >= MAX_SNIPPETS) break;
          if (isObviousNoiseSnippet(s, poi, locality)) {
            filteredCount++;
            continue;
          }
          if (isSnippetGeographicallyCoherent(s, geoContext ?? null, locality)) {
            snippets.push(s);
          } else {
            filteredCount++;
          }
        }

        log.info(`SearXNG results for "${poi.name}"`, {
          query,
          requestedEngines,
          totalResults: data.results.length,
          rawKept: rawSnippets.length,
          geoFiltered: filteredCount,
          keptSnippets: snippets.length,
          unresponsiveEngines: data.unresponsive_engines?.length ?? 0,
        });
        for (const s of snippets) {
          log.debug(`  [${s.engine}] ${s.title}`, { url: s.url, content: s.content.slice(0, 120) });
        }
        if (data.unresponsive_engines && data.unresponsive_engines.length > 0) {
          log.info(`Unresponsive engines for "${poi.name}": ${data.unresponsive_engines.map(([e, r]) => `${e} (${r})`).join(", ")}`, {
            engines: data.unresponsive_engines,
          });
        }

        if (snippets.length > 0) {
          noteSuccessfulEngines(snippets);
          return { snippets, query, unresponsiveEngines: data.unresponsive_engines ?? [] };
        }

        return { snippets: [], query, unresponsiveEngines: data.unresponsive_engines ?? [] };
      } catch (err) {
        if (signal?.aborted) throw new Error("Cancelled");

        lastError = err instanceof Error ? err : new Error(String(err));

        if (/^Search failed: /i.test(lastError.message)) {
          throw lastError;
        }

        if (attempt < maxRetries && lastError.name !== "AbortError") {
          continue;
        }

        break;
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  log.warn(`No useful snippets retained for "${poi.name}" after query fallbacks`, {
    queriesTried: queries,
    requestedEngines,
    unresponsiveEngines: lastUnresponsiveEngines,
  });
  return { snippets: [], query: queries[queries.length - 1] ?? buildSearchQuery(poi, locality, geoContext), unresponsiveEngines: lastUnresponsiveEngines };
}

export function buildOfficialWebsiteSnippets(websitePreview: WebsitePreview | null | undefined): SearchSnippet[] {
  return extractStructuredWebsiteSnippets(websitePreview);
}

export async function fetchGoogleMapsPreview(
  url: string,
  apiBase: string = "/api",
  signal?: AbortSignal,
): Promise<GoogleMapsPreview | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 180_000);

  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }

  try {
    const res = await fetch(`${apiBase}/google-maps-preview`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
      signal: controller.signal,
    });

    if (!res.ok) return null;
    return await res.json() as GoogleMapsPreview;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function enqueueGoogleMapsPreview(
  url: string,
  apiBase: string = "/api",
  signal?: AbortSignal,
  poiName?: string | null,
): Promise<GoogleMapsPreviewJob | null> {
  try {
    const res = await fetch(`${apiBase}/google-maps-preview/jobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, poiName: poiName ?? undefined }),
      signal,
    });
    if (!res.ok) return null;
    return await res.json() as GoogleMapsPreviewJob;
  } catch {
    return null;
  }
}

export async function pollGoogleMapsPreviewJob(
  jobId: string,
  apiBase: string = "/api",
  signal?: AbortSignal,
): Promise<GoogleMapsPreviewJob | null> {
  try {
    const res = await fetch(`${apiBase}/google-maps-preview/jobs/${jobId}`, {
      method: "GET",
      signal,
    });
    if (!res.ok) return null;
    return await res.json() as GoogleMapsPreviewJob;
  } catch {
    return null;
  }
}

export async function fetchGoogleMapsJobStats(
  apiBase: string = "/api",
  signal?: AbortSignal,
): Promise<GoogleFallbackJobStats | null> {
  try {
    const res = await fetch(`${apiBase}/google-maps-preview/jobs`, {
      method: "GET",
      signal,
    });
    if (!res.ok) return null;
    return await res.json() as GoogleFallbackJobStats;
  } catch {
    return null;
  }
}

export function buildGoogleMapsSnippets(preview: GoogleMapsPreview | null | undefined): SearchSnippet[] {
  if (!preview) return [];
  const snippets: SearchSnippet[] = [];
  const url = preview.resolvedUrl || preview.url;

  if (preview.snippet) {
    snippets.push({
      title: preview.title ?? "Google Maps",
      url,
      content: preview.snippet,
      engine: "google_maps",
    });
  }

  // Prefer structured hours (full 7-day table) over collapsed hoursText when available
  const hoursDisplay = preview.structuredHours?.length
    ? preview.structuredHours
        .map((e) => {
          if (e.open.toLowerCase() === "closed") return `${e.day}: closed`;
          if (e.close) return `${e.day}: ${e.open}-${e.close}`;
          return `${e.day}: ${e.open}`;
        })
        .join("; ")
    : preview.hoursText;

  const facts = [
    preview.category,
    preview.rating != null ? `Rating ${preview.rating}/5` : null,
    preview.reviewCount != null ? `${preview.reviewCount} reviews` : null,
    preview.priceLevel != null ? `Price ${"$".repeat(preview.priceLevel)}` : null,
    hoursDisplay,
    preview.address,
    preview.phone,
  ].filter(Boolean).join(". ");

  if (facts) {
    snippets.push({
      title: `${preview.title ?? "Google Maps"} facts`,
      url,
      content: facts,
      engine: "google_maps",
    });
  }

  return snippets;
}

export function countSuspendedHealthyEngines(): number {
  const now = Date.now();
  return [...engineFailureState.values()].filter((item) => item.suspendedUntil > now).length;
}

/**
 * Returns true when every configured engine is currently suspended
 * (CAPTCHA, access denied, rate-limited) and the batch should pause
 * to let the user resolve the CAPTCHA manually.
 */
export function areAllEnginesSuspended(): boolean {
  const allEngines = SEARXNG_ENGINES.split(",").map((e) => e.trim()).filter(Boolean);
  if (allEngines.length === 0) return false;
  const now = Date.now();
  return allEngines.every((engine) => {
    const state = engineFailureState.get(engine);
    return state != null && state.suspendedUntil > now;
  });
}

/**
 * Build the URL to open in a browser tab for manual CAPTCHA resolution.
 * Uses the SearXNG proxy endpoint so the user clears the block on the
 * same IP/session as the enrichment requests.
 * Falls back to the raw SearXNG instance URL if the apiBase is a relative path.
 */
export function buildCaptchaResolveUrl(apiBase: string = "/api"): string {
  // Point the user at SearXNG's own search UI via the proxy base.
  // The proxy is at /api/search; SearXNG UI root is typically at the root of
  // the SearXNG instance — we expose it via a dedicated endpoint.
  if (apiBase.startsWith("http")) {
    return `${apiBase}/searxng-ui`;
  }
  // Relative path: build an absolute URL using the current origin
  return `${window.location.origin}${apiBase}/searxng-ui`;
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
 * Resolve the locality (city/town/village) and full geographic context
 * for a POI via Nominatim reverse geocode.
 * Uses the server-side proxy to respect Nominatim rate limits.
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
  apiBase: string = "/api",
  signal?: AbortSignal,
): Promise<GeoContext | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

  if (signal) {
    signal.addEventListener("abort", () => controller.abort(), { once: true });
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

    const locality =
      addr.city ||
      addr.town ||
      addr.village ||
      addr.hamlet ||
      addr.municipality ||
      addr.county ||
      null;

    return {
      locality,
      county: addr.county ?? null,
      state: addr.state ?? null,
      country: addr.country ?? null,
      countryCode: (data as { address?: { country_code?: string } }).address?.country_code?.toLowerCase() ?? null,
    };
  } catch {
    // Non-critical failure
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
