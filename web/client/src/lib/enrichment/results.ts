// --- EnrichedData assembly: pure builders for the pipeline's terminal states ---

import type {
  EnrichedData,
  GeoContext,
  GoogleMapsPreview,
  OpeningHoursEntry,
  POI,
  SearchSnippet,
  TargetLanguage,
} from "../../types";
import { computeConfidence, extractEngines } from "./confidence";
import {
  buildDeterministicShortDescription,
  buildDeterministicShortReview,
  extractDeterministicBooking,
  extractDeterministicHours,
  extractDeterministicPriceNote,
  extractDeterministicRating,
  extractDeterministicReviewCount,
  extractDeterministicSeason,
} from "./deterministic";
import { buildGoogleMapsFields } from "./google-fallback";
import { buildGoogleMapsUrl } from "./google-maps";
import { flattenHours, isEngineReady, type LlmSynthesis } from "./llm";
import {
  buildStructuredContent,
  extractPriceLevel,
  extractStructuredHoursFromSnippets,
} from "./structured";

/** Intermediate result from geocode+search stage */
export interface SearchStageResult {
  poi: POI;
  locality: string | null;
  geoContext: GeoContext | null;
  searchQuery: string | null;
  snippets: SearchSnippet[];
  googleMapsUrl: string;
  officialWebsite: EnrichedData["officialWebsite"];
  /** Engines that were unresponsive during search */
  unresponsiveEngines: [string, string][];
  /** Structured hours from Google Maps fallback (7-day table), if available */
  googleMapsStructuredHours?: OpeningHoursEntry[] | null;
  /** Raw Google Maps preview (for field-level provenance) */
  googleMapsPreview?: GoogleMapsPreview | null;
}

/** An EnrichedData with nothing found: every terminal state starts from it */
export function emptyEnrichment(
  poi: POI,
  fields: Pick<EnrichedData, "status"> & Partial<EnrichedData>,
): EnrichedData {
  return {
    rating: null,
    reviewCount: null,
    hours: null,
    openingHours: null,
    description: null,
    review: null,
    priceLevel: null,
    googleMapsUrl: buildGoogleMapsUrl(poi),
    sourceUrls: [],
    rawSnippets: [],
    enrichedAt: new Date().toISOString(),
    locality: null,
    sourceCount: 0,
    sourceEngines: [],
    confidence: 0,
    officialWebsite: null,
    structured: {
      sourceRollup: [],
      cautions: [],
      divergences: [],
      sourceConfirmation: "none",
    },
    synthesisSource: undefined,
    synthesisReason: null,
    ...fields,
  };
}

/** A "done" result: what the search stage found plus the extracted `fields`, then scored */
function doneResult(
  item: SearchStageResult,
  fields: Partial<EnrichedData>,
  lang: TargetLanguage,
): EnrichedData {
  const { poi, snippets, officialWebsite } = item;
  const result = emptyEnrichment(poi, {
    status: "done",
    googleMapsUrl: item.googleMapsUrl,
    sourceUrls: snippets.map((s) => s.url),
    rawSnippets: snippets,
    locality: item.locality,
    geoContext: item.geoContext,
    searchQuery: item.searchQuery,
    sourceCount: snippets.length,
    sourceEngines: extractEngines(snippets),
    officialWebsite,
    unresponsiveEngines: item.unresponsiveEngines,
    googleMapsFields: buildGoogleMapsFields(item.googleMapsPreview),
    ...fields,
  });
  result.structured = buildStructuredContent(poi, result, snippets, officialWebsite, lang);
  result.confidence = computeConfidence(result);
  return result;
}

/** Build the final EnrichedData from a successful LLM synthesis. */
export function buildSynthesizedResult(
  item: SearchStageResult,
  synthesis: LlmSynthesis,
  targetLanguage: TargetLanguage,
): EnrichedData {
  const { poi, snippets } = item;
  return doneResult(
    item,
    {
      rating: synthesis.rating,
      reviewCount: synthesis.reviewCount,
      hours: synthesis.hoursFlat,
      openingHours: synthesis.hours ?? item.googleMapsStructuredHours ?? null,
      description: synthesis.description,
      review: synthesis.review,
      // LLM first, snippet extraction as the fallback
      priceLevel: synthesis.priceLevel ?? extractPriceLevel(snippets, poi.category),
      season: synthesis.season ?? extractDeterministicSeason(snippets),
      priceNote: synthesis.priceNote ?? extractDeterministicPriceNote(snippets),
      booking: synthesis.booking ?? extractDeterministicBooking(snippets),
      synthesisSource: synthesis.repaired ? "llm-repaired" : "llm",
      synthesisReason: synthesis.repairReason ?? null,
    },
    targetLanguage,
  );
}

/** Build the final EnrichedData when no LLM is available (deterministic extraction). */
export function buildDeterministicResult(
  item: SearchStageResult,
  targetLanguage: TargetLanguage,
): EnrichedData {
  const { poi, snippets, officialWebsite } = item;
  const detHours = extractDeterministicHours(snippets, officialWebsite);
  const detRating = extractDeterministicRating(snippets, officialWebsite);
  const detReviewCount = extractDeterministicReviewCount(snippets, officialWebsite);
  const detStructuredHours =
    item.googleMapsStructuredHours ?? extractStructuredHoursFromSnippets(snippets);
  return doneResult(
    item,
    {
      rating: detRating,
      reviewCount: detReviewCount,
      hours: detHours ?? (detStructuredHours?.length ? flattenHours(detStructuredHours) : null),
      openingHours: detStructuredHours ?? null,
      description: buildDeterministicShortDescription(poi, targetLanguage),
      review: buildDeterministicShortReview(detRating, detReviewCount, targetLanguage),
      priceLevel: extractPriceLevel(snippets, poi.category),
      season: extractDeterministicSeason(snippets),
      priceNote: extractDeterministicPriceNote(snippets),
      booking: extractDeterministicBooking(snippets),
      synthesisSource: "deterministic",
      synthesisReason: isEngineReady() ? "llm-rejected-or-empty" : "no-llm",
    },
    targetLanguage,
  );
}
