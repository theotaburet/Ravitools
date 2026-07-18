// ---------------------------------------------------------------------------
// EnrichedData assembly — pure builders for the pipeline's terminal states
// ---------------------------------------------------------------------------

import type {
  EnrichabilityPolicy,
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
  extractDeterministicHours,
  extractDeterministicRating,
  extractDeterministicReviewCount,
} from "./deterministic";
import { buildGoogleMapsFields } from "./google-fallback";
import { flattenHours, isEngineReady, type LlmSynthesis } from "./llm";
import { buildGoogleMapsUrl } from "./search";
import {
  buildSourceDigests,
  buildStructuredContent,
  extractPriceLevel,
  extractStructuredHoursFromSnippets,
} from "./structured";

/** Intermediate result from geocode+search stage */
export interface SearchStageResult {
  poi: POI;
  index: number;
  locality: string | null;
  geoContext: GeoContext | null;
  searchQuery: string | null;
  snippets: SearchSnippet[];
  googleMapsUrl: string;
  officialWebsite: EnrichedData["officialWebsite"];
  policy: EnrichabilityPolicy;
  /** Engines that were unresponsive during search */
  unresponsiveEngines: [string, string][];
  /** Structured hours from Google Maps fallback (7-day table), if available */
  googleMapsStructuredHours?: OpeningHoursEntry[] | null;
  /** Raw Google Maps preview (for field-level provenance) */
  googleMapsPreview?: GoogleMapsPreview | null;
  /** If already resolved (skip/minimal/no-results/error), the final enrichment */
  earlyResult?: EnrichedData;
}

export function createBaseEnrichment(
  poi: POI,
): Omit<
  EnrichedData,
  "enrichedAt" | "status" | "locality" | "sourceCount" | "sourceEngines" | "confidence"
> {
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
    sourceDigests: [],
    officialWebsite: null,
    structured: {
      headline: null,
      operationalSummary: null,
      practicalities: [],
      sourceRollup: [],
      cautions: [],
      unknowns: [],
      divergences: [],
      sourceConfirmation: "none",
    },
    synthesisSource: undefined,
    synthesisReason: null,
  };
}

/** Build the final EnrichedData from a successful LLM synthesis. */
export function buildSynthesizedResult(
  item: SearchStageResult,
  synthesis: LlmSynthesis,
  targetLanguage: TargetLanguage,
): EnrichedData {
  const { poi, snippets, officialWebsite } = item;
  const result: EnrichedData = {
    ...createBaseEnrichment(poi),
    rating: synthesis.rating,
    reviewCount: synthesis.reviewCount,
    hours: synthesis.hoursFlat,
    openingHours: synthesis.hours ?? item.googleMapsStructuredHours ?? null,
    description: synthesis.description,
    review: synthesis.review,
    // LLM price first, fallback to snippet extraction
    priceLevel: synthesis.priceLevel ?? extractPriceLevel(snippets, poi.category),
    googleMapsUrl: item.googleMapsUrl,
    sourceUrls: snippets.map((s) => s.url),
    rawSnippets: snippets,
    enrichedAt: new Date().toISOString(),
    status: "done",
    locality: item.locality,
    geoContext: item.geoContext,
    searchQuery: item.searchQuery,
    sourceCount: snippets.length,
    sourceEngines: extractEngines(snippets),
    confidence: 0,
    sourceDigests: buildSourceDigests(snippets, officialWebsite),
    officialWebsite,
    unresponsiveEngines: item.unresponsiveEngines,
    synthesisSource: synthesis.repaired ? ("llm-repaired" as const) : ("llm" as const),
    synthesisReason: synthesis.repairReason ?? null,
    googleMapsFields: buildGoogleMapsFields(item.googleMapsPreview),
  };
  result.structured = buildStructuredContent(
    poi,
    result,
    snippets,
    officialWebsite,
    targetLanguage,
  );
  result.confidence = computeConfidence(result);
  return result;
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
  const result: EnrichedData = {
    ...createBaseEnrichment(poi),
    rating: detRating,
    reviewCount: detReviewCount,
    hours: detHours ?? (detStructuredHours?.length ? flattenHours(detStructuredHours) : null),
    openingHours: detStructuredHours ?? null,
    description: buildDeterministicShortDescription(poi, targetLanguage),
    review: buildDeterministicShortReview(detRating, detReviewCount, targetLanguage),
    priceLevel: extractPriceLevel(snippets, poi.category),
    googleMapsUrl: item.googleMapsUrl,
    sourceUrls: snippets.map((s) => s.url),
    rawSnippets: snippets,
    enrichedAt: new Date().toISOString(),
    status: "done",
    locality: item.locality,
    geoContext: item.geoContext,
    searchQuery: item.searchQuery,
    sourceCount: snippets.length,
    sourceEngines: extractEngines(snippets),
    confidence: 0,
    sourceDigests: buildSourceDigests(snippets, officialWebsite),
    officialWebsite,
    unresponsiveEngines: item.unresponsiveEngines,
    synthesisSource: "deterministic" as const,
    synthesisReason: isEngineReady() ? "llm-rejected-or-empty" : "no-llm",
    googleMapsFields: buildGoogleMapsFields(item.googleMapsPreview),
  };
  result.structured = buildStructuredContent(
    poi,
    result,
    snippets,
    officialWebsite,
    targetLanguage,
  );
  result.confidence = computeConfidence(result);
  return result;
}
