// ---------------------------------------------------------------------------
// Enricher – orchestrates POI enrichment pipeline
// For each POI: reverse geocode → search → LLM synthesis → EnrichedData
// ---------------------------------------------------------------------------

import type { POI, EnrichedData, EnrichmentStatus, TargetLanguage } from "../../types";
import { buildGoogleMapsUrl, searchPoi, reverseGeocode } from "./search";
import { synthesize, isEngineReady } from "./llm";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Callback fired after each POI is enriched */
export type EnrichmentProgressCallback = (
  poiId: string,
  enrichment: EnrichedData,
  index: number,
  total: number,
) => void;

/** Options for the enrichment batch */
export interface EnrichBatchOptions {
  /** API base path for search/geocode proxy (default: "/api") */
  apiBase?: string;
  /** AbortSignal to cancel the batch */
  signal?: AbortSignal;
  /** Delay between POI enrichments to avoid hammering the server (ms) */
  delayBetweenPois?: number;
  /** Skip POIs whose name is "Unknown" or empty */
  skipUnnamed?: boolean;
  /** Target language for LLM synthesis output (default: "en") */
  targetLanguage?: TargetLanguage;
  /** Callback after each POI completes */
  onProgress?: EnrichmentProgressCallback;
}

// ---------------------------------------------------------------------------
// Single POI enrichment
// ---------------------------------------------------------------------------

/**
 * Enrich a single POI: geocode → search → synthesize.
 * Always returns an EnrichedData, even on partial failure.
 */
export async function enrichPoi(
  poi: POI,
  options: {
    apiBase?: string;
    signal?: AbortSignal;
    targetLanguage?: TargetLanguage;
  } = {},
): Promise<EnrichedData> {
  const apiBase = options.apiBase ?? "/api";
  const targetLanguage = options.targetLanguage ?? "en";
  const googleMapsUrl = buildGoogleMapsUrl(poi);

  let status: EnrichmentStatus = "pending";
  let locality: string | null = null;

  try {
    // Step 1: Reverse geocode for locality
    status = "searching";
    locality = await reverseGeocode(poi.lat, poi.lon, apiBase, options.signal);

    // Step 2: Search for snippets
    const snippets = await searchPoi(poi, locality, apiBase, options.signal);

    if (snippets.length === 0) {
      // No search results — skip LLM, return minimal enrichment
      return {
        rating: null,
        reviewCount: null,
        hours: null,
        summary: null,
        translatedSummary: null,
        specialty: null,
        priceLevel: null,
        googleMapsUrl,
        sourceUrls: [],
        rawSnippets: [],
        enrichedAt: new Date().toISOString(),
        status: "skipped",
        locality,
      };
    }

    // Step 3: LLM synthesis (if engine ready)
    status = "synthesizing";
    const sourceUrls = snippets.map((s) => s.url);

    if (isEngineReady()) {
      const synthesis = await synthesize(poi.name, poi.category, snippets, targetLanguage);

      if (synthesis) {
        return {
          rating: synthesis.rating,
          reviewCount: synthesis.reviewCount,
          hours: synthesis.hours,
          summary: synthesis.summary,
          translatedSummary: synthesis.translatedSummary,
          specialty: synthesis.specialty,
          priceLevel: synthesis.priceLevel,
          googleMapsUrl,
          sourceUrls,
          rawSnippets: snippets,
          enrichedAt: new Date().toISOString(),
          status: "done",
          locality,
        };
      }
    }

    // No LLM or synthesis failed — return raw snippets without synthesis
    return {
      rating: null,
      reviewCount: null,
      hours: null,
      summary: null,
      translatedSummary: null,
      specialty: null,
      priceLevel: null,
      googleMapsUrl,
      sourceUrls,
      rawSnippets: snippets,
      enrichedAt: new Date().toISOString(),
      status: "done",
      locality,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      rating: null,
      reviewCount: null,
      hours: null,
      summary: null,
      translatedSummary: null,
      specialty: null,
      priceLevel: null,
      googleMapsUrl,
      sourceUrls: [],
      rawSnippets: [],
      enrichedAt: new Date().toISOString(),
      status: "error",
      error: message,
      locality,
    };
  }
}

// ---------------------------------------------------------------------------
// Batch enrichment
// ---------------------------------------------------------------------------

/**
 * Enrich a batch of POIs sequentially.
 * Sequential to respect SearXNG/Nominatim rate limits.
 * Returns a Map<poiId, EnrichedData>.
 */
export async function enrichBatch(
  pois: POI[],
  options: EnrichBatchOptions = {},
): Promise<Map<string, EnrichedData>> {
  const {
    apiBase = "/api",
    signal,
    delayBetweenPois = 1500,
    skipUnnamed = true,
    targetLanguage = "en",
    onProgress,
  } = options;

  const results = new Map<string, EnrichedData>();
  const total = pois.length;

  for (let i = 0; i < pois.length; i++) {
    if (signal?.aborted) break;

    const poi = pois[i];

    // Skip unnamed/generic POIs (they produce garbage search results)
    if (skipUnnamed && (!poi.name || poi.name === "Unknown")) {
      const skippedData: EnrichedData = {
        rating: null,
        reviewCount: null,
        hours: null,
        summary: null,
        translatedSummary: null,
        specialty: null,
        priceLevel: null,
        googleMapsUrl: buildGoogleMapsUrl(poi),
        sourceUrls: [],
        rawSnippets: [],
        enrichedAt: new Date().toISOString(),
        status: "skipped",
        locality: null,
      };
      results.set(poi.id, skippedData);
      onProgress?.(poi.id, skippedData, i, total);
      continue;
    }

    const enrichment = await enrichPoi(poi, { apiBase, signal, targetLanguage });
    results.set(poi.id, enrichment);
    onProgress?.(poi.id, enrichment, i, total);

    // Delay between POIs to avoid rate limiting
    if (i < pois.length - 1 && delayBetweenPois > 0 && !signal?.aborted) {
      await sleep(delayBetweenPois);
    }
  }

  return results;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
