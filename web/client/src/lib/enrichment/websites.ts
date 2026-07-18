// ---------------------------------------------------------------------------
// Website/source handling: official-site detection (WS5), platform
// classification (WS7), URL dedup, official-site preview snippets
// ---------------------------------------------------------------------------

import type { EnrichmentPlatform, POI, SearchSnippet, WebsitePreview } from "../../types";
import { fetchJson, REQUEST_TIMEOUT, timeoutSignal } from "./proxy-api";

const OFFICIAL_SITE_TAGS = ["website", "contact:website", "url", "contact:web"] as const;

/**
 * Domains that should NOT be treated as official websites.
 * Social profiles, aggregators, and review platforms are not official sites.
 * Includes exact domains and base-name prefixes for multi-TLD platforms.
 * (WS5: harden official website detection)
 */
const REJECTED_OFFICIAL_DOMAINS = new Set([
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "google.com",
  "yelp.com",
  "yelp.fr",
  "tripadvisor.com",
  "tripadvisor.fr",
  "tripadvisor.de",
  "tripadvisor.es",
  "tripadvisor.it",
  "tripadvisor.co.uk",
  "booking.com",
  "hotels.com",
  "airbnb.com",
  "airbnb.fr",
  "expedia.com",
  "expedia.fr",
  "foursquare.com",
  "pagesjaunes.fr",
  "komoot.com",
  "linkedin.com",
  "youtube.com",
  "tiktok.com",
]);

/**
 * Base names of multi-TLD platforms.
 * A hostname starting with one of these followed by a dot is rejected.
 * Catches tripadvisor.*, airbnb.*, etc. without enumerating all TLDs.
 */
const REJECTED_DOMAIN_PREFIXES = ["tripadvisor", "airbnb", "expedia", "yelp", "booking"];

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
    const hostname = new URL(url).hostname
      .toLowerCase()
      .replace(/^www\./, "")
      .replace(/^m\./, "");
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
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_content",
      "utm_term",
      "fbclid",
      "gclid",
      "ref",
      "source",
      "srsltid",
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

/** Fetch a small preview of an official website through the server proxy. */
export async function fetchWebsitePreview(
  url: string,
  apiBase: string = "/api",
  signal?: AbortSignal,
): Promise<WebsitePreview | null> {
  return fetchJson<WebsitePreview>(`${apiBase}/fetch-page`, {
    body: { url },
    signal: timeoutSignal(REQUEST_TIMEOUT, signal),
  });
}

/** Turn an official-site preview's JSON-LD structured data into search snippets. */
export function buildOfficialWebsiteSnippets(
  websitePreview: WebsitePreview | null | undefined,
): SearchSnippet[] {
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
    ]
      .filter(Boolean)
      .join(". ");
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
