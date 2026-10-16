import type {
  EnrichedData,
  EnrichmentPlatform,
  EnrichmentSourceDigest,
  EnrichmentStructuredContent,
  POI,
  PoiCategory,
  SearchSnippet,
  TargetLanguage,
  WebsitePreview,
} from "../../types";
import { t } from "../i18n";
import { getEnrichabilityPolicy, getEnrichmentContract } from "../poi-config";
import { snippetRatings } from "./deterministic";
import { classifySourcePlatform, PLATFORMS } from "./websites";

/** Source-rollup order: the key order of PLATFORMS */
const PLATFORM_ORDER = Object.keys(PLATFORMS);

// --- Helpers ---

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function shorten(text: string, max: number): string {
  const value = compact(text);
  return value.length <= max ? value : `${value.slice(0, max - 1).trim()}…`;
}

function representativeSnippet(snippets: SearchSnippet[]): SearchSnippet | null {
  return [...snippets].sort((a, b) => b.content.length - a.content.length)[0] ?? null;
}

// --- Price level extraction from snippets (deterministic, no LLM needed) ---

/**
 * Currency symbol patterns used for price extraction.
 * Covers Euro, Dollar, Pound, Yen/Yuan.
 */
const CURRENCY_SYMBOLS = /[€$£¥]/;

/**
 * Detect repeated-symbol price indicators like €€, $$$, ££££.
 * These are common on Google Maps, Tripadvisor, Yelp, etc.
 * Requires at least 2 consecutive symbols (single € in "15€" is a numeric price, not a level indicator).
 */
const REPEATED_SYMBOL_RE = /([€$£¥])\s*\1{1,3}/g;

/**
 * Detect textual price-level labels (English & French).
 * Google Maps uses: "Inexpensive", "Moderate", "Expensive", "Very Expensive"
 * French: "bon marché", "modéré", "cher", "très cher"
 *
 * Note: JS \b doesn't work with Unicode chars like é/è, so we use
 * lookaround with whitespace/punctuation/boundary instead.
 */
const WB = String.raw`(?:^|[\s,;:!?.(])`; // word-start boundary (Unicode-safe)
const WE = String.raw`(?=$|[\s,;:!?.)])`; // word-end boundary (Unicode-safe)

const TEXTUAL_PRICE_LEVEL: Array<{ re: RegExp; level: number }> = [
  { re: new RegExp(`${WB}(very\\s+expensive|très\\s+cher)${WE}`, "i"), level: 4 },
  { re: new RegExp(`${WB}(expensive|cher(?!\\s*ch[eé])(?!ch))${WE}`, "i"), level: 3 },
  {
    re: new RegExp(`${WB}(moderate|moderately\\s+priced|modéré|prix\\s+moyens?)${WE}`, "i"),
    level: 2,
  },
  {
    re: new RegExp(`${WB}(inexpensive|cheap|bon\\s+marché|pas\\s+cher|économique)${WE}`, "i"),
    level: 1,
  },
];

/**
 * Detect numeric price values with currency symbols.
 * Matches patterns like: 15€, €15, $12.50, 25,90€, £8, ¥1200
 * Also matches ranges: 15€-25€, $10-$20
 */
const NUMERIC_PRICE_RE = /(?:([€$£¥])\s*(\d+(?:[.,]\d{1,2})?))|((\d+(?:[.,]\d{1,2})?)\s*([€$£¥]))/g;

/**
 * Extract a price level (1-4) from search snippets using deterministic heuristics.
 *
 * Strategy (in priority order):
 * 1. Repeated currency symbols (€€€ = 3): most reliable, used by review platforms
 * 2. Textual price labels ("Moderate" = 2): used by Google Maps
 * 3. Numeric price values: infer bracket from median price
 *
 * Returns null if no price signal is found.
 * Exported for direct testing.
 */
export function extractPriceLevel(
  snippets: SearchSnippet[],
  category?: PoiCategory,
): number | null {
  if (snippets.length === 0) return null;

  const allContent = snippets.map((s) => s.content).join(" ");

  // Quick bail: no currency symbol at all → no price signal
  if (!CURRENCY_SYMBOLS.test(allContent)) {
    // Still check for textual labels (Google Maps sometimes uses words only)
    for (const { re, level } of TEXTUAL_PRICE_LEVEL) {
      if (re.test(allContent)) return level;
    }
    return null;
  }

  // --- Strategy 1: Repeated currency symbols (€€, $$$, etc.) ---
  const symbolCounts: number[] = [];
  for (const snippet of snippets) {
    for (const match of snippet.content.matchAll(REPEATED_SYMBOL_RE)) {
      const full = match[0].replace(/\s/g, "");
      const count = full.length;
      if (count >= 2 && count <= 4) {
        symbolCounts.push(count);
      }
    }
  }
  if (symbolCounts.length > 0) {
    // Take the median of all repeated-symbol signals
    symbolCounts.sort((a, b) => a - b);
    const median = symbolCounts[Math.floor(symbolCounts.length / 2)];
    return Math.min(Math.max(median, 1), 4);
  }

  // --- Strategy 2: Textual price labels ---
  for (const { re, level } of TEXTUAL_PRICE_LEVEL) {
    if (re.test(allContent)) return level;
  }

  // --- Strategy 3: Numeric prices → infer bracket ---
  const prices: number[] = [];
  for (const snippet of snippets) {
    for (const match of snippet.content.matchAll(NUMERIC_PRICE_RE)) {
      // Pattern: €15 or $12.50
      const prefixValue = match[2];
      // Pattern: 15€ or 25,90€
      const suffixValue = match[4];
      const raw = prefixValue ?? suffixValue;
      if (raw) {
        const normalized = parseFloat(raw.replace(",", "."));
        if (!Number.isNaN(normalized) && normalized > 0 && normalized < 10000) {
          prices.push(normalized);
        }
      }
    }
  }

  if (prices.length > 0) {
    prices.sort((a, b) => a - b);
    const median = prices[Math.floor(prices.length / 2)];

    // Bracket thresholds depend on category
    const isAccommodation = category === "Sleeping place";
    if (isAccommodation) {
      // Hotel/accommodation: different price brackets
      if (median <= 30) return 1; // budget hostel/camping
      if (median <= 70) return 2; // mid-range
      if (median <= 150) return 3; // upper mid
      return 4; // luxury
    } else {
      // Restaurant/food/general: meal-level brackets
      if (median <= 8) return 1; // street food / cheap eats
      if (median <= 20) return 2; // casual dining
      if (median <= 45) return 3; // upscale casual
      return 4; // fine dining
    }
  }

  return null;
}

// --- Source rollup builder ---

function buildSourceRollup(
  snippets: SearchSnippet[],
  websitePreview?: WebsitePreview | null,
): EnrichmentSourceDigest[] {
  const groups = new Map<EnrichmentPlatform, SearchSnippet[]>();
  for (const snippet of snippets) {
    const platform = classifySourcePlatform(snippet.url);
    groups.set(platform, [...(groups.get(platform) ?? []), snippet]);
  }

  const digests: EnrichmentSourceDigest[] = [];
  for (const [platform, grouped] of groups) {
    const rep = representativeSnippet(grouped);
    if (!rep) continue;
    digests.push({
      platform,
      brief: `${PLATFORMS[platform].label}: ${shorten(rep.content, 180)}`,
      url: rep.url,
    });
  }

  if (
    websitePreview &&
    (websitePreview.description || websitePreview.excerpt || websitePreview.title)
  ) {
    // Only add official_website digest if it wasn't already picked up via snippets
    if (!groups.has("official_website")) {
      digests.push({
        platform: "official_website",
        brief: `Official site: ${shorten(websitePreview.description ?? websitePreview.excerpt ?? websitePreview.title ?? "", 180)}`,
        url: websitePreview.finalUrl,
      });
    }
  }

  // Sort by platform priority
  digests.sort((a, b) => PLATFORM_ORDER.indexOf(a.platform) - PLATFORM_ORDER.indexOf(b.platform));

  return digests;
}

// --- Cautions builder ---

function buildCautions(
  enrichment: Pick<EnrichedData, "hours" | "rating" | "reviewCount">,
  sourceRollup: EnrichmentSourceDigest[],
  category: PoiCategory,
  lang: TargetLanguage,
): string[] {
  const cautions: string[] = [];
  const isFullEnrichment = getEnrichabilityPolicy(category) === "full";

  if (sourceRollup.length === 0) {
    // A full category has its own wording (ENRICHMENT_CONTRACTS lists them)
    cautions.push(
      t(
        getEnrichmentContract(category) ? `caution.weakSource.${category}` : "caution.noPlatform",
        lang,
      ),
    );
  }
  if (isFullEnrichment && enrichment.rating == null) cautions.push(t("caution.noRating", lang));
  if (isFullEnrichment && enrichment.hours == null) cautions.push(t("caution.noHours", lang));
  if (isFullEnrichment && enrichment.reviewCount == null && enrichment.rating != null)
    cautions.push(t("caution.noReviewCount", lang));

  // Check source quality: only social platforms, no reputation sources
  const hasReputation = sourceRollup.some((d) => PLATFORMS[d.platform].reputation);
  if (sourceRollup.length > 0 && !hasReputation) cautions.push(t("caution.socialOnly", lang));

  return cautions.slice(0, 4);
}

// --- Divergence detection ---

/**
 * Detect divergences/contradictions across source snippets.
 * Currently pattern-based heuristics: can be extended with LLM-assisted detection.
 * Exported for direct testing.
 */
export function buildDivergences(snippets: SearchSnippet[], lang: TargetLanguage): string[] {
  const divergences: string[] = [];

  // Detect hours contradictions: look for different hour patterns across snippets
  const hourPatterns: { engine: string; hours: string }[] = [];
  const hoursRegex = /(\d{1,2}[h:]\d{2}\s*[-–]\s*\d{1,2}[h:]\d{2})/gi;

  for (const snippet of snippets) {
    const matches = snippet.content.match(hoursRegex);
    if (matches) {
      for (const match of matches) {
        hourPatterns.push({ engine: snippet.engine, hours: match.trim() });
      }
    }
  }

  if (hourPatterns.length >= 2) {
    const uniqueHours = new Set(hourPatterns.map((h) => h.hours.toLowerCase()));
    if (uniqueHours.size > 1) {
      divergences.push(t("divergence.hours", lang));
    }
  }

  // Detect rating contradictions: look for different explicit ratings
  const foundRatings = snippetRatings(snippets);

  if (foundRatings.length >= 2) {
    const minRating = Math.min(...foundRatings);
    const maxRating = Math.max(...foundRatings);
    if (maxRating - minRating >= 1.0) {
      divergences.push(
        t("divergence.rating", lang, { min: minRating.toFixed(1), max: maxRating.toFixed(1) }),
      );
    }
  }

  // Detect closure signals: "fermé" / "closed" / "permanently closed" mixed with positive reviews
  const closureTerms =
    /\b(ferm[eé]\s+d[eé]finitivement|permanently\s+closed|temporairement\s+ferm[eé]|temporarily\s+closed)\b/i;
  const hasClosureSignal = snippets.some((s) => closureTerms.test(s.content));
  const hasPositiveSignal = snippets.some((s) =>
    /\b(open|ouvert|excellent|great|recomm)/i.test(s.content),
  );

  if (hasClosureSignal && hasPositiveSignal) {
    divergences.push(t("divergence.closedMixed", lang));
  } else if (hasClosureSignal) {
    divergences.push(t("divergence.closed", lang));
  }

  return divergences.slice(0, 3);
}

// --- Source confirmation ---

/** Exported for direct testing. */
export function determineSourceConfirmation(
  sourceRollup: EnrichmentSourceDigest[],
): EnrichmentStructuredContent["sourceConfirmation"] {
  const hasOfficial = sourceRollup.some((d) => d.platform === "official_website");
  const hasReviews = sourceRollup.some((d) => PLATFORMS[d.platform].reputation);

  if (hasOfficial && hasReviews) return "both";
  if (hasOfficial) return "official";
  if (hasReviews) return "reviews-only";
  return "none";
}

// --- Main structured content builder ---

export function buildStructuredContent(
  poi: POI,
  enrichment: Pick<EnrichedData, "rating" | "reviewCount" | "hours">,
  snippets: SearchSnippet[],
  websitePreview: WebsitePreview | null | undefined,
  lang: TargetLanguage,
): EnrichmentStructuredContent {
  const sourceRollup = buildSourceRollup(snippets, websitePreview);
  return {
    sourceRollup,
    cautions: buildCautions(enrichment, sourceRollup, poi.category, lang),
    divergences: buildDivergences(snippets, lang),
    sourceConfirmation: determineSourceConfirmation(sourceRollup),
  };
}

// --- Source-quality scoring: rank snippets by domain reliability before LLM ---

/**
 * Domain quality below the reputation platforms (those score 3):
 * 2 = secondary directory, local tourism site, regional press
 * 0 = noise (banking, login, spam patterns)
 * Anything else, social profiles included, scores 1.
 */
const DOMAIN_QUALITY_SCORES: Array<{ pattern: RegExp; score: number }> = [
  // Good secondary sources
  { pattern: /campingfrance\.com/, score: 2 },
  { pattern: /campingsauvage\.net/, score: 2 },
  { pattern: /refuges\.info/, score: 2 },
  { pattern: /komoot\.(com|de|fr)/, score: 2 },
  { pattern: /mairie-|commune-|ville-/, score: 2 },
  { pattern: /office-de-tourisme|tourism|tourisme/, score: 2 },
  { pattern: /viamichelin\.(com|fr)/, score: 2 },
  { pattern: /lafourchette\.com|thefork\.com/, score: 2 },
  { pattern: /pages-jaunes\.fr|pagesjaunes\.fr/, score: 2 },
  { pattern: /cylex\.(fr|com)/, score: 2 },
  { pattern: /restaurantguru\.com/, score: 2 },
  { pattern: /foursquare\.com/, score: 2 },
  // Noise
  { pattern: /twitter\.com|x\.com/, score: 0 },
  { pattern: /linkedin\.com/, score: 0 },
  { pattern: /banking|unicredit|bpce|bnpparibas/, score: 0 },
];

/**
 * Score a single snippet URL on a 0–3 quality scale.
 * Used to rank snippets before passing them to the LLM.
 */
function scoreSnippetDomain(url: string): number {
  if (PLATFORMS[classifySourcePlatform(url)].reputation) return 3;
  const lower = url.toLowerCase();
  return DOMAIN_QUALITY_SCORES.find(({ pattern }) => pattern.test(lower))?.score ?? 1;
}

/**
 * Sort snippets by domain quality score (highest first), then by content length.
 * Ensures the LLM sees the most reliable sources first when the prompt is trimmed.
 * Zero-score snippets (noise) are removed entirely.
 *
 * Exported for testing.
 */
export function rankSnippetsByQuality(snippets: SearchSnippet[]): SearchSnippet[] {
  return snippets
    .map((s) => ({ snippet: s, score: scoreSnippetDomain(s.url) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score || b.snippet.content.length - a.snippet.content.length)
    .map(({ snippet }) => snippet);
}

// --- Deterministic hours extraction from snippets (multi-platform) ---

/** Normalize "8h30" or "08h30" or "8:30" to "08:30" */
function normalizeTimeStr(raw: string): string {
  const cleaned = raw.replace(/[hH]/, ":").replace(/\s/g, "");
  const [h, m = "00"] = cleaned.split(":");
  return `${h.padStart(2, "0")}:${m.padStart(2, "00").slice(0, 2)}`;
}

const DAY_MAP: Record<string, string> = {
  monday: "Mon",
  lundi: "Mon",
  lun: "Mon",
  mo: "Mon",
  mon: "Mon",
  tuesday: "Tue",
  mardi: "Tue",
  mar: "Tue",
  tu: "Tue",
  tue: "Tue",
  wednesday: "Wed",
  mercredi: "Wed",
  mer: "Wed",
  we: "Wed",
  wed: "Wed",
  thursday: "Thu",
  jeudi: "Thu",
  jeu: "Thu",
  th: "Thu",
  thu: "Thu",
  friday: "Fri",
  vendredi: "Fri",
  ven: "Fri",
  fr: "Fri",
  fri: "Fri",
  saturday: "Sat",
  samedi: "Sat",
  sam: "Sat",
  sa: "Sat",
  sat: "Sat",
  sunday: "Sun",
  dimanche: "Sun",
  dim: "Sun",
  su: "Sun",
  sun: "Sun",
};

const HOURS_ROW_RE =
  /\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|mon|tue|wed|thu|fri|sat|sun|lun|mar|mer|jeu|ven|sam|dim)[\s.:–-]*([0-9]{1,2}[h:][0-9]{2})\s*[–\-–]\s*([0-9]{1,2}[h:][0-9]{2})|(?:fermé|closed|ferme)\s+le\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday|lundi|mardi|mercredi|jeudi|vendredi|samedi|dimanche|mon|tue|wed|thu|fri|sat|sun|lun|mar|mer|jeu|ven|sam|dim)\b/gi;

/**
 * Extract structured opening-hours rows from raw snippet text.
 * Returns null if fewer than 2 distinct days found (not enough signal).
 *
 * Exported for testing.
 */
export function extractStructuredHoursFromSnippets(
  snippets: SearchSnippet[],
): import("../../types").OpeningHoursEntry[] | null {
  const seen = new Map<string, import("../../types").OpeningHoursEntry>();

  for (const snippet of snippets) {
    const text = `${snippet.title} ${snippet.content}`;
    HOURS_ROW_RE.lastIndex = 0;
    for (const match of text.matchAll(HOURS_ROW_RE)) {
      const dayRaw = (match[1] ?? match[4] ?? "").toLowerCase().trim();
      const dayNorm = DAY_MAP[dayRaw];
      if (!dayNorm) continue;

      if (match[4]) {
        // Closed day
        if (!seen.has(dayNorm)) seen.set(dayNorm, { day: dayNorm, open: "closed", close: null });
      } else if (match[2] && match[3]) {
        const open = normalizeTimeStr(match[2]);
        const close = normalizeTimeStr(match[3]);
        if (!seen.has(dayNorm)) seen.set(dayNorm, { day: dayNorm, open, close });
      }
    }
  }

  if (seen.size < 2) return null;

  const ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return [...seen.values()].sort((a, b) => ORDER.indexOf(a.day) - ORDER.indexOf(b.day));
}
