// ---------------------------------------------------------------------------
// Enricher – orchestrates POI enrichment pipeline
// For each POI: reverse geocode → search → LLM synthesis → EnrichedData
// Uses staged pipeline: geocode+search with concurrency, LLM serial.
// ---------------------------------------------------------------------------

import type { POI, EnrichedData, EnrichmentStatus, TargetLanguage, EnrichabilityPolicy, EnrichmentPhase, SearchSnippet, GeoContext } from "../../types";
import { buildGoogleMapsUrl, searchPoi, reverseGeocode, getOfficialWebsiteUrl, fetchWebsitePreview } from "./search";
import { synthesize, isEngineReady, flattenHours } from "./llm";
import { getEnrichabilityPolicy } from "../poi-config";
import { dlog } from "../debug-log";
import { buildEssentialsText, buildSourceDigests, buildStructuredContent, extractPriceLevel } from "./structured";

function createBaseEnrichment(poi: POI): Omit<EnrichedData, "enrichedAt" | "status" | "locality" | "sourceCount" | "sourceEngines" | "confidence"> {
  return {
    rating: null,
    reviewCount: null,
    hours: null,
    openingHours: null,
    description: null,
    review: null,
    summary: null,
    translatedSummary: null,
    specialty: null,
    priceLevel: null,
    googleMapsUrl: buildGoogleMapsUrl(poi),
    sourceUrls: [],
    rawSnippets: [],
    essentials: null,
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
  };
}

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

/** Callback fired when a POI starts being processed (for live animation) */
export type PoiStartCallback = (poiId: string, poiName: string) => void;

/** Callback for phase/ETA updates during enrichment */
export type PhaseProgressCallback = (phase: EnrichmentPhase, etaSeconds: number | null) => void;

/** Options for the enrichment batch */
export interface EnrichBatchOptions {
  /** API base path for search/geocode proxy (default: "/api") */
  apiBase?: string;
  /** AbortSignal to cancel the batch */
  signal?: AbortSignal;
  /** Max concurrent geocode+search requests (default: 3) */
  searchConcurrency?: number;
  /** Stagger delay between search launches in ms (default: 500) */
  searchStaggerMs?: number;
  /** Skip POIs whose name is "Unknown" or empty */
  skipUnnamed?: boolean;
  /** Target language for LLM synthesis output (default: "en") */
  targetLanguage?: TargetLanguage;
  /** Override enrichability policy: treat all POIs as "full" (default: false) */
  enrichAll?: boolean;
  /** Callback after each POI completes */
  onProgress?: EnrichmentProgressCallback;
  /** Callback when a POI starts processing (for live animation of in-flight POIs) */
  onPoiStart?: PoiStartCallback;
  /** Callback for phase/ETA updates */
  onPhaseProgress?: PhaseProgressCallback;
}

// ---------------------------------------------------------------------------
// Single POI enrichment (kept for isolated use; batch uses staged pipeline)
// ---------------------------------------------------------------------------

/**
 * Enrich a single POI: geocode → search → synthesize.
 * Always returns an EnrichedData, even on partial failure.
 * Respects enrichability policy unless overridden.
 */
export async function enrichPoi(
  poi: POI,
  options: {
    apiBase?: string;
    signal?: AbortSignal;
    targetLanguage?: TargetLanguage;
    /** Override: force "full" enrichment regardless of category policy */
    policyOverride?: EnrichabilityPolicy;
  } = {},
): Promise<EnrichedData> {
  const apiBase = options.apiBase ?? "/api";
  const targetLanguage = options.targetLanguage ?? "en";
  const googleMapsUrl = buildGoogleMapsUrl(poi);
  const officialWebsiteUrl = getOfficialWebsiteUrl(poi);
  const policy = options.policyOverride ?? getEnrichabilityPolicy(poi.category);

  // --- Policy: skip → no network calls at all ---
  if (policy === "skip") {
    return {
      ...createBaseEnrichment(poi),
      enrichedAt: new Date().toISOString(),
      status: "skipped", skipReason: "low-value-category", locality: null,
      sourceCount: 0, sourceEngines: [], confidence: 0,
    };
  }

  let status: EnrichmentStatus = "pending";
  let locality: string | null = null;
  let geoContext: GeoContext | null = null;
  let officialWebsite = null;

  try {
    // Step 1: Reverse geocode for locality
    status = "searching";
    geoContext = await reverseGeocode(poi.lat, poi.lon, apiBase, options.signal);
    locality = geoContext?.locality ?? null;

    if (options.signal?.aborted) throw new Error("Cancelled");

    // --- Policy: minimal → geocode only, no search/LLM ---
    if (policy === "minimal") {
      if (officialWebsiteUrl) {
        officialWebsite = await fetchWebsitePreview(officialWebsiteUrl, apiBase, options.signal);
      }
      return {
        ...createBaseEnrichment(poi),
        enrichedAt: new Date().toISOString(),
        status: "done", locality,
        geoContext,
        sourceCount: 0, sourceEngines: [], confidence: 0,
        officialWebsite,
      };
    }

    // --- Policy: full → geocode + search + LLM ---

    // Step 2: Search for snippets
    if (options.signal?.aborted) throw new Error("Cancelled");
    const searchResult = await searchPoi(poi, locality, apiBase, options.signal, 3, geoContext);
    const snippets = searchResult.snippets;
    const searchQuery = searchResult.query;
    const unresponsiveEngines = searchResult.unresponsiveEngines;

    if (officialWebsiteUrl) {
      officialWebsite = await fetchWebsitePreview(officialWebsiteUrl, apiBase, options.signal);
    }

    if (snippets.length === 0) {
      return {
        ...createBaseEnrichment(poi),
        enrichedAt: new Date().toISOString(),
        status: "skipped", skipReason: "no-results", locality,
        geoContext,
        searchQuery,
        sourceCount: 0, sourceEngines: [], confidence: 0,
        officialWebsite,
        unresponsiveEngines,
      };
    }

    // Step 3: LLM synthesis (if engine ready)
    status = "synthesizing";
    if (options.signal?.aborted) throw new Error("Cancelled");
    const sourceUrls = snippets.map((s) => s.url);

    if (isEngineReady()) {
      const synthesis = await synthesize(poi.name, poi.category, snippets, targetLanguage, officialWebsite);

      if (options.signal?.aborted) throw new Error("Cancelled");

      if (synthesis) {
        const sourceDigests = buildSourceDigests(snippets, officialWebsite);
        const result = {
          ...createBaseEnrichment(poi),
          rating: synthesis.rating,
          reviewCount: synthesis.reviewCount,
          hours: synthesis.hoursFlat,
          openingHours: synthesis.hours,
          description: synthesis.description,
          review: synthesis.review,
          // Legacy compat: populate summary/translatedSummary from description
          summary: synthesis.description,
          translatedSummary: synthesis.description,
          specialty: null,
          // LLM price first, fallback to snippet extraction
          priceLevel: synthesis.priceLevel ?? extractPriceLevel(snippets, poi.category),
          googleMapsUrl, sourceUrls, rawSnippets: snippets,
          enrichedAt: new Date().toISOString(),
          status: "done" as const, locality,
          geoContext,
          searchQuery,
          sourceCount: snippets.length,
          sourceEngines: extractEngines(snippets),
          confidence: 0,
          essentials: synthesis.review,
          sourceDigests,
          officialWebsite,
          unresponsiveEngines,
        };
        result.structured = buildStructuredContent(poi, result, snippets, officialWebsite, targetLanguage);
        result.essentials = result.essentials ?? buildEssentialsText(result.structured);
        result.confidence = computeConfidence(result);
        return result;
      }
    }

    // No LLM or synthesis failed — deterministic extraction from snippets
    const snippetPriceLevel = extractPriceLevel(snippets, poi.category);
    const noLlmResult = {
      ...createBaseEnrichment(poi),
      priceLevel: snippetPriceLevel,
      googleMapsUrl, sourceUrls, rawSnippets: snippets,
      enrichedAt: new Date().toISOString(),
      status: "done" as const, locality,
      geoContext,
      searchQuery,
      sourceCount: snippets.length,
      sourceEngines: extractEngines(snippets),
      confidence: 0,
      sourceDigests: buildSourceDigests(snippets, officialWebsite),
      officialWebsite,
      unresponsiveEngines,
    };
    noLlmResult.structured = buildStructuredContent(poi, noLlmResult, snippets, officialWebsite, targetLanguage);
    noLlmResult.essentials = buildEssentialsText(noLlmResult.structured);
    noLlmResult.confidence = computeConfidence(noLlmResult);
    return noLlmResult;
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return {
      ...createBaseEnrichment(poi),
      enrichedAt: new Date().toISOString(),
      status: "error", error: message, locality,
      geoContext,
      sourceCount: 0, sourceEngines: [], confidence: 0,
      officialWebsite,
    };
  }
}

// ---------------------------------------------------------------------------
// Batch enrichment — staged pipeline with concurrency
// ---------------------------------------------------------------------------

/** Intermediate result from geocode+search stage */
interface SearchStageResult {
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
  /** If already resolved (skip/minimal/no-results/error), the final enrichment */
  earlyResult?: EnrichedData;
}

/**
 * Enrich a batch of POIs using a two-stage pipeline:
 * - Stage 1 (geocode+search): concurrent with controlled concurrency + stagger
 * - Stage 2 (LLM synthesis): serial (WebLLM handles one inference at a time)
 *
 * Returns a Map<poiId, EnrichedData>.
 */
export async function enrichBatch(
  pois: POI[],
  options: EnrichBatchOptions = {},
): Promise<Map<string, EnrichedData>> {
  const {
    apiBase = "/api",
    signal,
    searchConcurrency = 3,
    searchStaggerMs = 500,
    skipUnnamed = true,
    targetLanguage = "en",
    enrichAll = false,
    onProgress,
    onPoiStart,
    onPhaseProgress,
  } = options;

  const results = new Map<string, EnrichedData>();
  const total = pois.length;
  let completedCount = 0;
  const startTime = Date.now();
  const log = dlog("enrichment");

  // Helper: compute ETA from current progress
  function computeEta(): number | null {
    if (completedCount === 0) return null;
    const elapsed = (Date.now() - startTime) / 1000;
    const avgPerPoi = elapsed / completedCount;
    const remaining = total - completedCount;
    return Math.round(avgPerPoi * remaining);
  }

  // Helper: emit a completed POI
  function emitResult(poi: POI, enrichment: EnrichedData) {
    results.set(poi.id, enrichment);
    completedCount++;
    onProgress?.(poi.id, enrichment, completedCount, total);

    // Debug log for visibility
    if (enrichment.status === "done") {
      log.info(`Enriched "${poi.name}" (${poi.category})`, {
        status: enrichment.status,
        sources: enrichment.sourceCount,
        engines: enrichment.sourceEngines.join(",") || "none",
        rating: enrichment.rating,
        confidence: enrichment.confidence,
        hasLLM: enrichment.description != null,
        progress: `${completedCount}/${total}`,
      });

      // WS20: Log divergences when detected
      if (enrichment.structured?.divergences && enrichment.structured.divergences.length > 0) {
        log.info(`Divergences detected for "${poi.name}": ${enrichment.structured.divergences.join(" | ")}`, {
          divergenceCount: enrichment.structured.divergences.length,
        });
      }

      // WS20: Log source confirmation level
      if (enrichment.structured?.sourceConfirmation && enrichment.structured.sourceConfirmation !== "none") {
        log.debug(`Source confirmation for "${poi.name}": ${enrichment.structured.sourceConfirmation}`, {
          sourceConfirmation: enrichment.structured.sourceConfirmation,
        });
      }

      // WS20: Log official website impact
      if (enrichment.officialWebsite) {
        const hasUsefulContent = enrichment.officialWebsite.description || enrichment.officialWebsite.excerpt;
        log.debug(`Official site for "${poi.name}": ${hasUsefulContent ? "useful content extracted" : "no useful content"}`, {
          officialUrl: enrichment.officialWebsite.finalUrl,
          hasContent: !!hasUsefulContent,
        });
      }
    } else if (enrichment.status === "skipped") {
      log.debug(`Skipped "${poi.name}" (${enrichment.skipReason})`, {
        status: enrichment.status,
        reason: enrichment.skipReason,
        progress: `${completedCount}/${total}`,
      });
    } else if (enrichment.status === "error") {
      log.error(`Failed "${poi.name}": ${enrichment.error}`, {
        status: enrichment.status,
        error: enrichment.error,
        progress: `${completedCount}/${total}`,
      });
    }
  }

   // -----------------------------------------------------------------------
  // Pre-filter: resolve skip/unnamed/generic POIs immediately (no network)
  // -----------------------------------------------------------------------
  const searchQueue: { poi: POI; index: number; policy: EnrichabilityPolicy }[] = [];

  for (let i = 0; i < pois.length; i++) {
    if (signal?.aborted) break;
    const poi = pois[i];

    // Skip unnamed or generic POI names that won't yield useful search results
    if (skipUnnamed && isGenericPoiName(poi.name)) {
      const skippedData: EnrichedData = {
        ...createBaseEnrichment(poi),
        enrichedAt: new Date().toISOString(),
        status: "skipped", skipReason: "generic-name", locality: null,
        sourceCount: 0, sourceEngines: [], confidence: 0,
      };
      emitResult(poi, skippedData);
      continue;
    }

    const policy = enrichAll ? "full" as EnrichabilityPolicy : getEnrichabilityPolicy(poi.category);

    // Skip categories
    if (policy === "skip") {
      const skippedData: EnrichedData = {
        ...createBaseEnrichment(poi),
        enrichedAt: new Date().toISOString(),
        status: "skipped", skipReason: "low-value-category", locality: null,
        sourceCount: 0, sourceEngines: [], confidence: 0,
      };
      emitResult(poi, skippedData);
      continue;
    }

    searchQueue.push({ poi, index: i, policy });
  }

  if (signal?.aborted || searchQueue.length === 0) return results;

  // -----------------------------------------------------------------------
  // Stage 1: Geocode + Search — concurrent with stagger
  // -----------------------------------------------------------------------
  log.info(`Stage 1: geocode+search for ${searchQueue.length} POIs (concurrency=${searchConcurrency}, stagger=${searchStaggerMs}ms)`, {
    searchQueue: searchQueue.length,
    skipped: total - searchQueue.length,
    concurrency: searchConcurrency,
  });
  onPhaseProgress?.("geocode-search", null);

  const searchResults: SearchStageResult[] = [];

  await runConcurrent(
    searchQueue,
    searchConcurrency,
    searchStaggerMs,
    signal,
    async (item) => {
      if (signal?.aborted) return;
      const { poi, index, policy } = item;
      const googleMapsUrl = buildGoogleMapsUrl(poi);
      const officialWebsiteUrl = getOfficialWebsiteUrl(poi);

      // Signal that this POI has started processing (for live animation)
      onPoiStart?.(poi.id, poi.name);

      try {
        // Geocode → returns full GeoContext
        if (signal?.aborted) return;
        const geoContext = await reverseGeocode(poi.lat, poi.lon, apiBase, signal);
        const locality = geoContext?.locality ?? null;
        const officialWebsite = officialWebsiteUrl
          ? await fetchWebsitePreview(officialWebsiteUrl, apiBase, signal)
          : null;

        // Minimal policy: geocode only
        if (signal?.aborted) return;
        if (policy === "minimal") {
          const result: EnrichedData = {
            ...createBaseEnrichment(poi),
            enrichedAt: new Date().toISOString(),
            status: "done", locality,
            geoContext,
            sourceCount: 0, sourceEngines: [], confidence: 0,
            officialWebsite,
          };
          searchResults.push({ poi, index, locality, geoContext, searchQuery: null, snippets: [], googleMapsUrl, officialWebsite, policy, unresponsiveEngines: [], earlyResult: result });
          emitResult(poi, result);
          onPhaseProgress?.("geocode-search", computeEta());
          return;
        }

        // Full policy: geocode + search
        if (signal?.aborted) return;
        const searchResult = await searchPoi(poi, locality, apiBase, signal, 3, geoContext);
        const snippets = searchResult.snippets;
        const searchQuery = searchResult.query;
        const unresponsiveEngines = searchResult.unresponsiveEngines;

        if (signal?.aborted) return;
        if (snippets.length === 0) {
          const result: EnrichedData = {
            ...createBaseEnrichment(poi),
            enrichedAt: new Date().toISOString(),
            status: "skipped", skipReason: "no-results", locality,
            geoContext,
            searchQuery,
            sourceCount: 0, sourceEngines: [], confidence: 0,
            officialWebsite,
            unresponsiveEngines,
          };
          searchResults.push({ poi, index, locality, geoContext, searchQuery, snippets: [], googleMapsUrl, officialWebsite, policy, unresponsiveEngines, earlyResult: result });
          emitResult(poi, result);
          onPhaseProgress?.("geocode-search", computeEta());
          return;
        }

        searchResults.push({ poi, index, locality, geoContext, searchQuery, snippets, googleMapsUrl, officialWebsite, policy, unresponsiveEngines });
        onPhaseProgress?.("geocode-search", computeEta());
      } catch (err) {
        if (signal?.aborted) return;
        const message = err instanceof Error ? err.message : "Unknown error";
        const result: EnrichedData = {
          ...createBaseEnrichment(poi),
          enrichedAt: new Date().toISOString(),
          status: "error", error: message, locality: null,
          sourceCount: 0, sourceEngines: [], confidence: 0,
        };
        searchResults.push({ poi, index, locality: null, geoContext: null, searchQuery: null, snippets: [], googleMapsUrl, officialWebsite: null, policy, unresponsiveEngines: [], earlyResult: result });
        emitResult(poi, result);
        onPhaseProgress?.("geocode-search", computeEta());
      }
    },
  );

  if (signal?.aborted) return results;

  // -----------------------------------------------------------------------
  // Stage 2: LLM Synthesis — serial (WebLLM is single-threaded)
  // -----------------------------------------------------------------------
  const needSynthesis = searchResults.filter((r) => !r.earlyResult && r.snippets.length > 0);

  if (needSynthesis.length > 0) {
    log.info(`Stage 2: LLM synthesis for ${needSynthesis.length} POIs (serial)`, {
      needSynthesis: needSynthesis.length,
      llmReady: isEngineReady(),
    });
    onPhaseProgress?.("synthesize", computeEta());

    for (const item of needSynthesis) {
      if (signal?.aborted) break;

      const { poi, locality, geoContext, searchQuery, snippets, googleMapsUrl, officialWebsite, unresponsiveEngines } = item;
      const sourceUrls = snippets.map((s) => s.url);

      // Signal that this POI is now in LLM synthesis (for live animation)
      onPoiStart?.(poi.id, poi.name);

      try {
        if (signal?.aborted) break;

        if (isEngineReady()) {
          const synthesis = await synthesize(poi.name, poi.category, snippets, targetLanguage, officialWebsite);

          if (signal?.aborted) break;

          if (synthesis) {
            const sourceDigests = buildSourceDigests(snippets, officialWebsite);
            const result: EnrichedData = {
              ...createBaseEnrichment(poi),
              rating: synthesis.rating,
              reviewCount: synthesis.reviewCount,
              hours: synthesis.hoursFlat,
              openingHours: synthesis.hours,
              description: synthesis.description,
              review: synthesis.review,
              // Legacy compat: populate summary/translatedSummary from description
              summary: synthesis.description,
              translatedSummary: synthesis.description,
              specialty: null,
              // LLM price first, fallback to snippet extraction
              priceLevel: synthesis.priceLevel ?? extractPriceLevel(snippets, poi.category),
              googleMapsUrl, sourceUrls, rawSnippets: snippets,
              enrichedAt: new Date().toISOString(),
              status: "done", locality,
              geoContext,
              searchQuery,
              sourceCount: snippets.length,
              sourceEngines: extractEngines(snippets),
              confidence: 0,
              essentials: synthesis.review,
              sourceDigests,
              officialWebsite,
              unresponsiveEngines,
            };
            result.structured = buildStructuredContent(poi, result, snippets, officialWebsite, targetLanguage);
            result.essentials = result.essentials ?? buildEssentialsText(result.structured);
            result.confidence = computeConfidence(result);
            emitResult(poi, result);
            onPhaseProgress?.("synthesize", computeEta());
            continue;
          }
        }

        // No LLM or synthesis failed — deterministic extraction from snippets
        const snippetPriceLevel = extractPriceLevel(snippets, poi.category);
        const noLlmResult: EnrichedData = {
          ...createBaseEnrichment(poi),
          priceLevel: snippetPriceLevel,
          googleMapsUrl, sourceUrls, rawSnippets: snippets,
          enrichedAt: new Date().toISOString(),
          status: "done", locality,
          geoContext,
          searchQuery,
          sourceCount: snippets.length,
          sourceEngines: extractEngines(snippets),
          confidence: 0,
          sourceDigests: buildSourceDigests(snippets, officialWebsite),
          officialWebsite,
          unresponsiveEngines,
        };
        noLlmResult.structured = buildStructuredContent(poi, noLlmResult, snippets, officialWebsite, targetLanguage);
        noLlmResult.essentials = buildEssentialsText(noLlmResult.structured);
        noLlmResult.confidence = computeConfidence(noLlmResult);
        emitResult(poi, noLlmResult);
        onPhaseProgress?.("synthesize", computeEta());
      } catch (err) {
        if (signal?.aborted) break;
        const message = err instanceof Error ? err.message : "Unknown error";
        const errResult: EnrichedData = {
          ...createBaseEnrichment(poi),
          googleMapsUrl, sourceUrls: [], rawSnippets: snippets,
          enrichedAt: new Date().toISOString(),
          status: "error", error: message, locality,
          geoContext,
          searchQuery,
          sourceCount: 0, sourceEngines: [], confidence: 0,
          officialWebsite,
          unresponsiveEngines,
        };
        emitResult(poi, errResult);
        onPhaseProgress?.("synthesize", computeEta());
      }
    }
  }

  // Final summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const doneCount = [...results.values()].filter((r) => r.status === "done").length;
  const skippedCount = [...results.values()].filter((r) => r.status === "skipped").length;
  const errorCount = [...results.values()].filter((r) => r.status === "error").length;
  log.info(`Enrichment complete: ${doneCount} done, ${skippedCount} skipped, ${errorCount} errors in ${elapsed}s`, {
    total: results.size,
    done: doneCount,
    skipped: skippedCount,
    errors: errorCount,
    elapsedSec: parseFloat(elapsed),
  });

  return results;
}

// ---------------------------------------------------------------------------
// Concurrent queue with stagger
// ---------------------------------------------------------------------------

/**
 * Run async tasks with controlled concurrency and stagger delay.
 * Each new task launch is staggered by `staggerMs` to spread rate-limit pressure.
 */
async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  staggerMs: number,
  signal: AbortSignal | undefined,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const running = new Set<Promise<void>>();

  function startNext(): void {
    if (signal?.aborted || nextIndex >= items.length) return;
    const idx = nextIndex++;
    const p = fn(items[idx]).finally(() => running.delete(p));
    running.add(p);
  }

  // Launch initial batch with stagger
  while (nextIndex < items.length && running.size < concurrency) {
    if (signal?.aborted) break;
    startNext();
    if (nextIndex < items.length && running.size < concurrency && staggerMs > 0) {
      await sleep(staggerMs);
    }
  }

  // As tasks complete, launch next with stagger
  while (running.size > 0) {
    if (signal?.aborted) break;
    await Promise.race(running);
    if (nextIndex < items.length && !signal?.aborted) {
      if (staggerMs > 0) await sleep(staggerMs);
      startNext();
    }
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Generic/descriptive POI names that won't produce useful web search results.
 * These are typically auto-generated from OSM tags rather than being actual
 * business names. Matching is case-insensitive.
 */
const GENERIC_POI_NAMES = new Set([
  // Empty / unknown
  "", "unknown", "unnamed",
  // Water & sanitation (often OSM tag names, not real names)
  "toilets", "toilet", "drinking water", "water",
  "restroom", "restrooms", "wc", "public toilet", "public toilets",
  // Shelter / picnic
  "shelter", "picnic", "picnic site", "picnic table", "picnic area",
  // Generic amenity descriptions
  "bench", "waste basket", "recycling", "parking",
  "bicycle parking", "bicycle repair station",
  // Generic French equivalents
  "toilettes", "eau potable", "fontaine", "point d'eau",
  "abri", "aire de pique-nique", "banc",
  // Generic Spanish/Basque equivalents
  "fuente", "aseos", "servicios",
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

/**
 * Compute a confidence score (0-1) for an enrichment result.
 * WS10: richer formula with official website bonus, snippet quality,
 * review volume weight, and platform diversity.
 *
 * Components (sum, capped at 1.0):
 *   sourceFactor   (0-0.40): snippet count, saturates at ~6
 *   diversityFactor(0-0.15): distinct search engines
 *   fieldFactor    (0-0.20): each non-null structured field adds weight
 *   officialBonus  (0-0.10): official website presence
 *   qualityFactor  (0-0.15): snippet content quality (avg length, URL diversity)
 */
export function computeConfidence(enrichment: {
  rawSnippets: { engine: string; content?: string; url?: string }[];
  rating: number | null;
  reviewCount: number | null;
  hours: string | null;
  description: string | null;
  review: string | null;
  officialWebsite?: { url: string } | null;
  structured?: { divergences: string[] } | null;
}): number {
  const snippetCount = enrichment.rawSnippets.length;
  if (snippetCount === 0) return 0;

  // --- Source count factor (0-0.40): diminishing returns beyond 6 snippets ---
  const sourceFactor = Math.min(snippetCount / 15, 0.40);

  // --- Engine diversity factor (0-0.15): multiple engines = higher confidence ---
  const engines = new Set(enrichment.rawSnippets.map((s) => s.engine));
  const diversityFactor = Math.min(engines.size * 0.05, 0.15);

  // --- Structured field presence factor (0-0.20) ---
  let fieldFactor = 0;
  if (enrichment.rating != null) fieldFactor += 0.04;
  if (enrichment.reviewCount != null) fieldFactor += 0.04;
  if (enrichment.hours != null) fieldFactor += 0.04;
  if (enrichment.description != null) fieldFactor += 0.04;
  if (enrichment.review != null) fieldFactor += 0.04;
  fieldFactor = Math.min(fieldFactor, 0.20);

  // --- Official website bonus (0-0.10) ---
  const officialBonus = enrichment.officialWebsite ? 0.10 : 0;

  // --- Snippet quality factor (0-0.15) ---
  let qualityFactor = 0;
  if (snippetCount > 0) {
    // Average content length: longer snippets tend to have more useful information
    const avgContentLength = enrichment.rawSnippets.reduce((sum, s) => sum + (s.content?.length ?? 0), 0) / snippetCount;
    // Normalize: 50+ chars average = good (0.05), 150+ chars = very good (0.10)
    qualityFactor += Math.min(avgContentLength / 1500, 0.10);

    // URL diversity: snippets from different domains = more corroboration
    const domains = new Set(enrichment.rawSnippets.map((s) => {
      try { return new URL(s.url ?? "").hostname; } catch { return ""; }
    }).filter(Boolean));
    qualityFactor += Math.min(domains.size * 0.025, 0.05);
  }
  qualityFactor = Math.min(qualityFactor, 0.15);

  // --- Contradiction penalty (WS11): divergences reduce confidence ---
  const divergenceCount = enrichment.structured?.divergences?.length ?? 0;
  const contradictionPenalty = Math.min(divergenceCount * 0.05, 0.15);

  const raw = sourceFactor + diversityFactor + fieldFactor + officialBonus + qualityFactor - contradictionPenalty;
  return Math.min(Math.max(Math.round(raw * 100) / 100, 0), 1);
}

/** Extract unique engine names from snippets */
function extractEngines(snippets: { engine: string }[]): string[] {
  return [...new Set(snippets.map((s) => s.engine))];
}
