import type {
  POI,
  EnrichedData,
  SearchSnippet,
  EnrichmentSourceDigest,
  WebsitePreview,
  EnrichmentPlatform,
  TargetLanguage,
  EnrichmentStructuredContent,
  PoiCategory,
} from "../../types";
import { classifySourcePlatform } from "./search";
import { getEnrichmentContract } from "../poi-config";

// ---------------------------------------------------------------------------
// Platform labels and priority (WS4: source strategy)
// ---------------------------------------------------------------------------

const PLATFORM_LABELS: Record<EnrichmentPlatform, string> = {
  google_maps: "Google Maps",
  yelp: "Yelp",
  tripadvisor: "Tripadvisor",
  facebook: "Facebook",
  instagram: "Instagram",
  booking: "Booking",
  hotels_com: "Hotels.com",
  official_website: "Official site",
  other: "Web",
};

/**
 * Platform priority order for source rollup display.
 * Official site first, then review platforms by reliability, social last.
 * (WS4: source strategy & ranking)
 */
const PLATFORM_PRIORITY: Record<EnrichmentPlatform, number> = {
  official_website: 0,
  google_maps: 1,
  tripadvisor: 2,
  yelp: 3,
  booking: 4,
  hotels_com: 5,
  facebook: 6,
  instagram: 7,
  other: 8,
};

/**
 * Platforms that provide reputation signals (ratings, reviews).
 * Social platforms (Facebook, Instagram) provide presence, not reliable reputation.
 */
const REPUTATION_PLATFORMS: Set<EnrichmentPlatform> = new Set([
  "google_maps", "tripadvisor", "yelp", "booking", "hotels_com",
]);

/**
 * Platforms that provide operational facts (hours, contact, menus).
 */
const OPERATIONAL_PLATFORMS: Set<EnrichmentPlatform> = new Set([
  "official_website", "google_maps",
]);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function compact(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function shorten(text: string, max: number): string {
  const value = compact(text);
  return value.length <= max ? value : `${value.slice(0, max - 1).trim()}…`;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))];
}

function representativeSnippet(snippets: SearchSnippet[]): SearchSnippet | null {
  return [...snippets].sort((a, b) => b.content.length - a.content.length)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Category-aware lead inference (WS9: better deterministic fallback)
// ---------------------------------------------------------------------------

function inferCategoryLead(poi: POI): string {
  // Use OSM tags for richer fallback when no LLM summary
  const tagType = poi.tags.amenity ?? poi.tags.shop ?? poi.tags.tourism ?? null;
  const typePart = tagType ? ` (${tagType.replace(/_/g, " ")})` : "";

  switch (poi.category) {
    case "Restaurant or Bar":
      return `${poi.name}${typePart} — food stop near the route.`;
    case "Food shop":
      return `${poi.name}${typePart} — food resupply option near the route.`;
    case "Sleeping place":
      return `${poi.name}${typePart} — sleep option near the route.`;
    case "Gears":
      return `${poi.name}${typePart} — bike gear or repair stop near the route.`;
    default:
      return `${poi.name} — ${poi.category.toLowerCase()} near the route.`;
  }
}

// ---------------------------------------------------------------------------
// Practicalities builder (WS9: richer deterministic output)
// ---------------------------------------------------------------------------

function buildPracticalities(
  enrichment: Pick<EnrichedData, "rating" | "reviewCount" | "hours" | "specialty" | "priceLevel" | "locality">,
  targetLanguage: TargetLanguage,
  poi: POI,
): string[] {
  const facts: string[] = [];
  if (enrichment.specialty) facts.push(`Type: ${enrichment.specialty}`);

  // Fallback: use OSM tag as specialty when LLM didn't extract one
  if (!enrichment.specialty) {
    const osmType = poi.tags.cuisine ?? poi.tags.amenity ?? poi.tags.shop ?? poi.tags.tourism ?? null;
    if (osmType && osmType !== poi.name.toLowerCase()) {
      facts.push(`Type (OSM): ${osmType.replace(/_/g, " ")}`);
    }
  }

  if (enrichment.rating != null) {
    facts.push(
      enrichment.reviewCount != null
        ? `Reported rating: ${enrichment.rating.toFixed(1)}/5 (${enrichment.reviewCount} reviews)`
        : `Reported rating: ${enrichment.rating.toFixed(1)}/5`,
    );
  }
  if (enrichment.hours) facts.push(`Hours: ${enrichment.hours}`);
  if (enrichment.priceLevel != null) facts.push(`Price level: ${"$".repeat(enrichment.priceLevel)}`);

  // OSM-sourced extras useful for cyclists
  if (poi.tags.phone || poi.tags["contact:phone"]) {
    facts.push(`Phone: ${poi.tags.phone ?? poi.tags["contact:phone"]}`);
  }

  if (enrichment.locality) {
    facts.push(targetLanguage === "fr" ? `Localité: ${enrichment.locality}` : `Locality: ${enrichment.locality}`);
  }
  return uniqueStrings(facts).slice(0, 6);
}

// ---------------------------------------------------------------------------
// Source rollup builder (WS4: platform priority ordering)
// ---------------------------------------------------------------------------

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
      brief: `${PLATFORM_LABELS[platform]}: ${shorten(rep.content, 180)}`,
      url: rep.url,
    });
  }

  if (websitePreview && (websitePreview.description || websitePreview.excerpt || websitePreview.title)) {
    digests.push({
      platform: "official_website",
      brief: `Official site: ${shorten(websitePreview.description ?? websitePreview.excerpt ?? websitePreview.title ?? "", 180)}`,
      url: websitePreview.finalUrl,
    });
  }

  // Sort by platform priority (WS4)
  digests.sort((a, b) => (PLATFORM_PRIORITY[a.platform] ?? 99) - (PLATFORM_PRIORITY[b.platform] ?? 99));

  return digests;
}

// ---------------------------------------------------------------------------
// Cautions builder
// ---------------------------------------------------------------------------

function buildCautions(
  enrichment: Pick<EnrichedData, "hours" | "rating" | "reviewCount">,
  sourceRollup: EnrichmentSourceDigest[],
  category: PoiCategory,
): string[] {
  const cautions: string[] = [];
  const contract = getEnrichmentContract(category);

  if (sourceRollup.length === 0) {
    // Use contract-specific weak source formulation if available
    if (contract && contract.weakSourceFormulations.length > 0) {
      cautions.push(contract.weakSourceFormulations[0]);
    } else {
      cautions.push("No identifiable review or discovery platform found.");
    }
  }
  if (enrichment.rating == null) cautions.push("No explicit rating found in the collected sources.");
  if (enrichment.hours == null) cautions.push("Opening hours were not confirmed from the collected sources.");
  if (enrichment.reviewCount == null && enrichment.rating != null) cautions.push("Rating found, but review volume was not confirmed.");

  // Check source quality — only social platforms, no reputation sources
  const hasReputation = sourceRollup.some((d) => REPUTATION_PLATFORMS.has(d.platform));
  if (sourceRollup.length > 0 && !hasReputation) {
    cautions.push("Sources are limited to social profiles or generic directories — reliability uncertain.");
  }

  return cautions.slice(0, 4);
}

// ---------------------------------------------------------------------------
// Unknowns builder
// ---------------------------------------------------------------------------

function buildUnknowns(
  enrichment: Pick<EnrichedData, "hours" | "rating" | "reviewCount" | "specialty">,
  sourceRollup: EnrichmentSourceDigest[],
): string[] {
  const unknowns: string[] = [];
  if (enrichment.specialty == null && sourceRollup.length > 0) {
    unknowns.push("Exact type or specialty could not be determined from sources.");
  }
  return unknowns.slice(0, 2);
}

// ---------------------------------------------------------------------------
// Divergence detection (WS11: contradiction handling)
// ---------------------------------------------------------------------------

/**
 * Detect divergences/contradictions across source snippets.
 * Currently pattern-based heuristics — can be extended with LLM-assisted detection.
 * Exported for direct testing (WS16).
 */
export function buildDivergences(
  snippets: SearchSnippet[],
  enrichment: Pick<EnrichedData, "hours" | "rating">,
): string[] {
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
      divergences.push("Sources report different opening hours — verify locally.");
    }
  }

  // Detect rating contradictions: look for different explicit ratings
  const ratingRegex = /(\d(?:\.\d)?)\s*(?:\/\s*5|stars?|étoiles?)/gi;
  const foundRatings: number[] = [];
  for (const snippet of snippets) {
    const matches = [...snippet.content.matchAll(ratingRegex)];
    for (const match of matches) {
      const r = parseFloat(match[1]);
      if (r >= 1 && r <= 5) foundRatings.push(r);
    }
  }

  if (foundRatings.length >= 2) {
    const minRating = Math.min(...foundRatings);
    const maxRating = Math.max(...foundRatings);
    if (maxRating - minRating >= 1.0) {
      divergences.push(`Rating varies across sources (${minRating.toFixed(1)} to ${maxRating.toFixed(1)}/5).`);
    }
  }

  // Detect closure signals: "fermé" / "closed" / "permanently closed" mixed with positive reviews
  const closureTerms = /\b(ferm[eé]\s+d[eé]finitivement|permanently\s+closed|temporairement\s+ferm[eé]|temporarily\s+closed)\b/i;
  const hasClosureSignal = snippets.some((s) => closureTerms.test(s.content));
  const hasPositiveSignal = snippets.some((s) => /\b(open|ouvert|excellent|great|recomm)/i.test(s.content));

  if (hasClosureSignal && hasPositiveSignal) {
    divergences.push("Some sources suggest this place may be closed — verify before counting on it.");
  } else if (hasClosureSignal) {
    divergences.push("Closure signals detected in sources — may be permanently or temporarily closed.");
  }

  return divergences.slice(0, 3);
}

// ---------------------------------------------------------------------------
// Source confirmation (WS2: official site vs reviews distinction)
// ---------------------------------------------------------------------------

/** Exported for direct testing (WS16). */
export function determineSourceConfirmation(
  sourceRollup: EnrichmentSourceDigest[],
): EnrichmentStructuredContent["sourceConfirmation"] {
  const hasOfficial = sourceRollup.some((d) => d.platform === "official_website");
  const hasReviews = sourceRollup.some((d) => REPUTATION_PLATFORMS.has(d.platform));

  if (hasOfficial && hasReviews) return "both";
  if (hasOfficial) return "official";
  if (hasReviews) return "reviews-only";
  return "none";
}

// ---------------------------------------------------------------------------
// Main structured content builder
// ---------------------------------------------------------------------------

export function buildStructuredContent(
  poi: POI,
  enrichment: Pick<EnrichedData, "rating" | "reviewCount" | "hours" | "specialty" | "summary" | "translatedSummary" | "priceLevel" | "locality">,
  snippets: SearchSnippet[],
  websitePreview: WebsitePreview | null | undefined,
  targetLanguage: TargetLanguage,
): EnrichmentStructuredContent {
  const sourceRollup = buildSourceRollup(snippets, websitePreview);
  const lead = enrichment.translatedSummary ?? enrichment.summary ?? inferCategoryLead(poi);
  const practicalities = buildPracticalities(enrichment, targetLanguage, poi);
  const cautions = buildCautions(enrichment, sourceRollup, poi.category);
  const unknowns = buildUnknowns(enrichment, sourceRollup);
  const divergences = buildDivergences(snippets, enrichment);
  const sourceConfirmation = determineSourceConfirmation(sourceRollup);

  const operationalSummaryParts = [
    enrichment.specialty ? `Best read as ${enrichment.specialty}.` : null,
    enrichment.hours ? `Hours available.` : `Hours unclear.`,
    enrichment.rating != null ? `Reputation signals present.` : `Reputation signals limited.`,
    sourceRollup.length > 0 ? `Coverage: ${sourceRollup.map((item) => PLATFORM_LABELS[item.platform]).join(", ")}.` : null,
  ];

  // Add divergence warning to operational summary if present
  if (divergences.length > 0) {
    operationalSummaryParts.push("Some source disagreements detected.");
  }

  return {
    headline: shorten(lead, 320) || null,
    operationalSummary: shorten(uniqueStrings(operationalSummaryParts).join(" "), 240) || null,
    practicalities,
    sourceRollup,
    cautions,
    unknowns,
    divergences,
    sourceConfirmation,
  };
}

// ---------------------------------------------------------------------------
// Essentials text builder (WS9: derived field from structured)
// ---------------------------------------------------------------------------

export function buildEssentialsText(structured: EnrichmentStructuredContent): string | null {
  const parts = [
    structured.headline,
    structured.operationalSummary,
    structured.practicalities.length > 0 ? `Key facts: ${structured.practicalities.join("; ")}.` : null,
    structured.divergences.length > 0 ? `Divergences: ${structured.divergences.join(" ")}` : null,
    structured.cautions.length > 0 ? `Cautions: ${structured.cautions.join(" ")}` : null,
    structured.unknowns.length > 0 ? `Unknown: ${structured.unknowns.join(" ")}` : null,
  ];
  const joined = uniqueStrings(parts).join(" ");
  return joined ? shorten(joined, 700) : null;
}

export function buildSourceDigests(
  snippets: SearchSnippet[],
  websitePreview?: WebsitePreview | null,
): EnrichmentSourceDigest[] {
  return buildSourceRollup(snippets, websitePreview);
}
