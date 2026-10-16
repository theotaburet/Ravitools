// Website/source handling: official-site detection, platform
// classification, URL dedup, official-site preview snippets

import type { EnrichmentPlatform, POI, SearchSnippet, WebsitePreview } from "../../types";
import { buildEvidenceSnippets, focusOnName, pickHopLinks } from "./evidence";
import { API_BASE, fetchJson, REQUEST_TIMEOUT, timeoutSignal } from "./proxy-api";

/** Official-site snippets per POI: the search results need room in the 8-snippet budget. */
const MAX_OFFICIAL_SNIPPETS = 5;

const OFFICIAL_SITE_TAGS = ["website", "contact:website", "url", "contact:web"] as const;

/**
 * The review and discovery platforms, in source-rollup order (official site
 * first, social last). `host` is looked for in the hostname; `reputation`: the
 * platform carries ratings and reviews, not just a presence.
 */
export const PLATFORMS: Record<
  EnrichmentPlatform,
  { label: string; host?: string; reputation: boolean }
> = {
  official_website: { label: "Official site", reputation: false },
  google_maps: { label: "Google Maps", host: "google.", reputation: true },
  tripadvisor: { label: "Tripadvisor", host: "tripadvisor.", reputation: true },
  yelp: { label: "Yelp", host: "yelp.", reputation: true },
  booking: { label: "Booking", host: "booking.", reputation: true },
  airbnb: { label: "Airbnb", host: "airbnb.", reputation: true },
  hotels_com: { label: "Hotels.com", host: "hotels.", reputation: true },
  facebook: { label: "Facebook", host: "facebook.", reputation: false },
  instagram: { label: "Instagram", host: "instagram.", reputation: false },
  other: { label: "Web", reputation: false },
};

/**
 * Domains that are never an official website: social profiles, aggregators,
 * review platforms (multi-TLD ones below, in REJECTED_DOMAIN_PREFIXES).
 */
const REJECTED_OFFICIAL_DOMAINS = new Set([
  "facebook.com",
  "instagram.com",
  "twitter.com",
  "x.com",
  "google.com",
  "hotels.com",
  "foursquare.com",
  "pagesjaunes.fr",
  "komoot.com",
  "linkedin.com",
  "youtube.com",
  "tiktok.com",
]);

/** Base names of multi-TLD platforms: tripadvisor.*, airbnb.*, etc. without enumerating the TLDs */
const REJECTED_DOMAIN_PREFIXES = ["tripadvisor", "airbnb", "expedia", "yelp", "booking"];

/**
 * Pick the best official website URL from OSM tags when present.
 * Rejects social profiles, aggregators, and review platform URLs.
 *
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

    // Reject known non-official domains
    if (isRejectedOfficialDomain(url)) continue;

    return url;
  }
  return null;
}

/**
 * Check if a URL points to a known non-official domain (social, aggregator, review).
 * Exported for testing.
 *
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
    // Multi-TLD platforms, subdomains included (tripadvisor.fr, fr.tripadvisor.com)
    for (const prefix of REJECTED_DOMAIN_PREFIXES) {
      if (hostname.startsWith(`${prefix}.`) || hostname.includes(`.${prefix}.`)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** The known platform of a source URL (see PLATFORMS), else "other". */
export function classifySourcePlatform(url: string): EnrichmentPlatform {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return "other";
  }
  const ids = Object.keys(PLATFORMS) as EnrichmentPlatform[];
  return ids.find((id) => hostname.includes(PLATFORMS[id].host ?? "\0")) ?? "other";
}

/**
 * Normalize a URL for deduplication.
 * Strips tracking params, mobile prefixes, locale variants, trailing slashes.
 *
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
  signal?: AbortSignal,
): Promise<WebsitePreview | null> {
  return fetchJson<WebsitePreview>(`${API_BASE}/fetch-page`, {
    body: { url },
    signal: timeoutSignal(REQUEST_TIMEOUT, signal),
  });
}

/**
 * The official site, generically: the homepage rarely answers, its menu says
 * where to look. Read it, follow up to two links that promise prices, hours,
 * booking, menu or contact, and turn JSON-LD plus evidence windows into
 * snippets. The returned preview is the homepage without text or links:
 * sessions live in localStorage.
 */
export async function fetchOfficialSite(
  url: string,
  signal?: AbortSignal,
): Promise<{ preview: WebsitePreview | null; snippets: SearchSnippet[] }> {
  const home = await fetchWebsitePreview(url, signal);
  if (!home) return { preview: null, snippets: [] };
  const hops = pickHopLinks(home.links ?? [], home.finalUrl || home.url);
  const hopPages = (
    await Promise.all(hops.map((href) => fetchWebsitePreview(href, signal)))
  ).filter((page): page is WebsitePreview => page !== null);
  const pages = [home, ...hopPages];
  const snippets = [
    ...pages.flatMap(buildOfficialWebsiteSnippets),
    ...buildEvidenceSnippets(
      pages.map((page) => ({ title: page.title, url: page.finalUrl || page.url, text: page.text })),
    ),
  ].slice(0, MAX_OFFICIAL_SNIPPETS);
  const { links: _links, text: _text, ...preview } = home;
  return { preview, snippets };
}

/** Pages worth reading behind search results: not the official site, not a rejected platform, not a file, one per host. */
function hostOf(url: string | null): string | null {
  try {
    return url ? new URL(url).host : null;
  } catch {
    return null;
  }
}

/**
 * Read one or two pages behind the best search results: a 160-character
 * snippet never holds a price or a season. Only the text around mentions of
 * the place counts (a directory page lists other places too); the evidence
 * windows come back as `page` snippets carrying the page URL.
 */
export async function readSearchPages(
  poi: POI,
  snippets: SearchSnippet[],
  officialUrl: string | null,
  signal?: AbortSignal,
  max = 2,
): Promise<SearchSnippet[]> {
  const officialHost = hostOf(officialUrl);
  const hosts = new Set<string>();
  const urls: string[] = [];
  for (const snippet of snippets) {
    if (urls.length >= max) break;
    if (["official_website", "google_maps", "page"].includes(snippet.engine)) continue;
    const host = hostOf(snippet.url);
    if (!host || host === officialHost || hosts.has(host)) continue;
    if (isRejectedOfficialDomain(snippet.url) || /(^|\.)google\./.test(host)) continue;
    if (/\.(pdf|jpe?g|png|gif|webp|zip)(\?|$)/i.test(snippet.url)) continue;
    hosts.add(host);
    urls.push(snippet.url);
  }
  const pages = (await Promise.all(urls.map((url) => fetchWebsitePreview(url, signal)))).filter(
    (page): page is WebsitePreview => page !== null,
  );
  return buildEvidenceSnippets(
    pages.map((page) => ({
      title: page.title,
      url: page.finalUrl || page.url,
      text: focusOnName(page.text ?? "", poi.name),
    })),
    3,
    "page",
  );
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
