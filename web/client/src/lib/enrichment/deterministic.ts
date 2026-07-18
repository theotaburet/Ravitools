// ---------------------------------------------------------------------------
// Deterministic extraction — no-LLM fallbacks built from snippets/JSON-LD
// ---------------------------------------------------------------------------

import type { EnrichedData, POI, SearchSnippet, TargetLanguage } from "../../types";

export function extractDeterministicRating(
  snippets: SearchSnippet[],
  website: EnrichedData["officialWebsite"],
): number | null {
  // R3: a JSON-LD ratingValue outside [1,5] (e.g. 9.2 on a 10-scale) used to flow
  // through untouched and crash the star renderers. Drop it, fall back to snippets.
  const structured = website?.structuredData?.rating;
  if (structured != null && Number.isFinite(structured) && structured >= 1 && structured <= 5) {
    return Math.round(structured * 10) / 10;
  }
  const matches = snippets.flatMap((snippet) => [
    ...snippet.content.matchAll(/(\d(?:[.,]\d)?)\s*(?:\/\s*5|stars?|étoiles?)/gi),
  ]);
  const values = matches
    .map((match) => Number.parseFloat(match[1].replace(",", ".")))
    .filter((value) => value >= 1 && value <= 5);
  return values.length > 0 ? Math.round(values[0] * 10) / 10 : null;
}

export function extractDeterministicReviewCount(
  snippets: SearchSnippet[],
  website: EnrichedData["officialWebsite"],
): number | null {
  if (website?.structuredData?.reviewCount != null) return website.structuredData.reviewCount;
  const matches = snippets.flatMap((snippet) => [
    ...snippet.content.matchAll(/(\d{1,5})\s+(?:reviews?|avis|opiniones)/gi),
  ]);
  const value = matches
    .map((match) => Number.parseInt(match[1], 10))
    .find((count) => Number.isFinite(count));
  return value ?? null;
}

export function extractDeterministicHours(
  snippets: SearchSnippet[],
  website: EnrichedData["officialWebsite"],
): string | null {
  if (website?.structuredData?.openingHours?.length)
    return website.structuredData.openingHours.join("; ");
  const hit = snippets
    .map(
      (snippet) =>
        snippet.content.match(
          /((?:mon|tue|wed|thu|fri|sat|sun|lun|mar|mer|jeu|ven|sam|dim)[^.;]{0,80}\d{1,2}[:h]\d{2}[^.;]{0,40})/i,
        )?.[1],
    )
    .find(Boolean);
  return hit?.trim() ?? null;
}

export function buildDeterministicShortDescription(
  poi: POI,
  targetLanguage: TargetLanguage,
): string {
  const type = (poi.tags.amenity ?? poi.tags.shop ?? poi.tags.tourism ?? poi.category).replace(
    /_/g,
    " ",
  );
  return targetLanguage === "fr"
    ? `${poi.name}, ${type}, arrêt utile près de l'itinéraire.`.slice(0, 180)
    : `${poi.name}, ${type}, useful stop near the route.`.slice(0, 180);
}

export function buildDeterministicShortReview(
  rating: number | null,
  reviewCount: number | null,
  targetLanguage: TargetLanguage,
): string | null {
  if (rating == null && reviewCount == null) return null;
  if (targetLanguage === "fr") {
    if (rating != null && reviewCount != null)
      return `Avis web: ${rating.toFixed(1)}/5 sur ${reviewCount} avis.`;
    if (rating != null) return `Avis web: ${rating.toFixed(1)}/5.`;
    return `Volume d'avis confirmé: ${reviewCount}.`;
  }
  if (rating != null && reviewCount != null)
    return `Web reviews: ${rating.toFixed(1)}/5 from ${reviewCount} reviews.`;
  if (rating != null) return `Web reviews: ${rating.toFixed(1)}/5.`;
  return `Review volume confirmed: ${reviewCount}.`;
}

/**
 * Generic/descriptive POI names that won't produce useful web search results.
 * These are typically auto-generated from OSM tags rather than being actual
 * business names. Matching is case-insensitive.
 */
const GENERIC_POI_NAMES = new Set([
  // Empty / unknown
  "",
  "unknown",
  "unnamed",
  // Water & sanitation (often OSM tag names, not real names)
  "toilets",
  "toilet",
  "drinking water",
  "water",
  "restroom",
  "restrooms",
  "wc",
  "public toilet",
  "public toilets",
  // Shelter / picnic
  "shelter",
  "picnic",
  "picnic site",
  "picnic table",
  "picnic area",
  // Generic amenity descriptions
  "bench",
  "waste basket",
  "recycling",
  "parking",
  "bicycle parking",
  "bicycle repair station",
  // Generic French equivalents
  "toilettes",
  "eau potable",
  "fontaine",
  "point d'eau",
  "abri",
  "aire de pique-nique",
  "banc",
  // Generic Spanish/Basque equivalents
  "fuente",
  "aseos",
  "servicios",
]);

/**
 * Returns true if the POI name is empty, missing, or a generic/descriptive
 * name that won't produce useful web search results.
 */
export function isGenericPoiName(name: string | undefined | null): boolean {
  if (!name) return true;
  const normalized = name.trim().toLowerCase();
  if (normalized.length === 0) return true;
  return GENERIC_POI_NAMES.has(normalized);
}
