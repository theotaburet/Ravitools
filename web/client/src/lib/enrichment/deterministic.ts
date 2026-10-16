// --- Deterministic extraction: no-LLM fallbacks built from snippets/JSON-LD ---

import type { BookingStatus, EnrichedData, POI, SearchSnippet, TargetLanguage } from "../../types";
import { t } from "../i18n";
import { findDateRange, MONEY_RE } from "./evidence";
import { osmFacts } from "./osm-facts";
import { BOOKING_PATTERNS } from "./vocabulary";

export function extractDeterministicRating(
  snippets: SearchSnippet[],
  website: EnrichedData["officialWebsite"],
): number | null {
  // A JSON-LD ratingValue outside [1,5] (e.g. 9.2 on a 10-scale) used to flow
  // through untouched and crash the star renderers. Drop it, fall back to snippets.
  const structured = website?.structuredData?.rating;
  if (structured != null && Number.isFinite(structured) && structured >= 1 && structured <= 5) {
    return Math.round(structured * 10) / 10;
  }
  const values = snippetRatings(snippets);
  return values.length > 0 ? Math.round(values[0] * 10) / 10 : null;
}

/** Every 1–5 rating the snippets state ("4.5/5", "4,2 étoiles", "3 stars"), in order */
export function snippetRatings(snippets: SearchSnippet[]): number[] {
  return snippets
    .flatMap((snippet) => [
      ...snippet.content.matchAll(/(\d(?:[.,]\d)?)\s*(?:\/\s*5|stars?|étoiles?)/gi),
    ])
    .map((match) => Number.parseFloat(match[1].replace(",", ".")))
    .filter((value) => value >= 1 && value <= 5);
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
  // The map data already says a lot: state it rather than a filler sentence.
  const facts = osmFacts(poi.tags, targetLanguage)
    .slice(0, 3)
    .map((fact) => fact.charAt(0).toLowerCase() + fact.slice(1));
  if (facts.length > 0) return `${poi.name}, ${type}, ${facts.join(", ")}.`.slice(0, 180);
  return t("deterministic.description", targetLanguage, { name: poi.name, type }).slice(0, 180);
}

export function buildDeterministicShortReview(
  rating: number | null,
  reviewCount: number | null,
  targetLanguage: TargetLanguage,
): string | null {
  if (rating == null && reviewCount == null) return null;
  const vars = { rating: rating?.toFixed(1) ?? "", count: reviewCount ?? "" };
  const key = rating == null ? "count" : reviewCount == null ? "rating" : "ratingCount";
  return t(`deterministic.${key}`, targetLanguage, vars);
}

/** Opening period stated as a date range in any snippet ("6 juin au 28 septembre"). */
export function extractDeterministicSeason(snippets: SearchSnippet[]): string | null {
  for (const snippet of snippets) {
    const range = findDateRange(snippet.content);
    if (range) return range;
  }
  return null;
}

/** Up to three amounts with the few words naming them: "nuitée 21,00 €, demi-pension 55 €". */
export function extractDeterministicPriceNote(snippets: SearchSnippet[]): string | null {
  const notes: string[] = [];
  const seen = new Set<string>();
  for (const snippet of snippets) {
    for (const match of snippet.content.matchAll(MONEY_RE)) {
      const amount = match[0].trim();
      if (seen.has(amount)) continue;
      const before =
        snippet.content
          .slice(0, match.index)
          .split(/[(),:;.!?]/)
          .pop() ?? "";
      const context = before.trim().split(/\s+/).filter(Boolean).slice(-3).join(" ");
      seen.add(amount);
      notes.push(context ? `${context} ${amount}` : amount);
      if (notes.length === 3) return notes.join(", ").slice(0, 160);
    }
  }
  return notes.length > 0 ? notes.join(", ").slice(0, 160) : null;
}

/** Explicit booking statement in any snippet, in the seven query languages. */
export function extractDeterministicBooking(snippets: SearchSnippet[]): BookingStatus | null {
  const text = snippets.map((snippet) => snippet.content).join(" ");
  return BOOKING_PATTERNS.find(({ pattern }) => pattern.test(text))?.status ?? null;
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
