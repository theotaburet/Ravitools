// ---------------------------------------------------------------------------
// Enricher – orchestrates POI enrichment pipeline
// For each POI: reverse geocode → search → LLM synthesis → EnrichedData
// Uses staged pipeline: geocode+search with concurrency, LLM serial.
// ---------------------------------------------------------------------------

import type { POI, EnrichedData, EnrichmentStatus, TargetLanguage, EnrichabilityPolicy, EnrichmentPhase, SearchSnippet } from "../../types";
import { buildGoogleMapsUrl, searchPoi, reverseGeocode, getOfficialWebsiteUrl, fetchWebsitePreview } from "./search";
import { synthesize, isEngineReady } from "./llm";
import { getEnrichabilityPolicy } from "../poi-config";
import { dlog } from "../debug-log";
import { buildEssentialsText, buildSourceDigests, buildStructuredContent } from "./structured";

function createBaseEnrichment(poi: POI): Omit<EnrichedData, "enrichedAt" | "status" | "locality" | "sourceCount" | "sourceEngines" | "confidence"> {
  return {
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
  let officialWebsite = null;

  try {
    // Step 1: Reverse geocode for locality
    status = "searching";
    locality = await reverseGeocode(poi.lat, poi.lon, apiBase, options.signal);

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
        sourceCount: 0, sourceEngines: [], confidence: 0,
        officialWebsite,
      };
    }

    // --- Policy: full → geocode + search + LLM ---

    // Step 2: Search for snippets
    if (options.signal?.aborted) throw new Error("Cancelled");
    const snippets = await searchPoi(poi, locality, apiBase, options.signal);

    if (officialWebsiteUrl) {
      officialWebsite = await fetchWebsitePreview(officialWebsiteUrl, apiBase, options.signal);
    }

    if (snippets.length === 0) {
      return {
        ...createBaseEnrichment(poi),
        enrichedAt: new Date().toISOString(),
        status: "skipped", skipReason: "no-results", locality,
        sourceCount: 0, sourceEngines: [], confidence: 0,
        officialWebsite,
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
        const sourceDigests = synthesis.sourceDigests.length > 0
          ? synthesis.sourceDigests
          : buildSourceDigests(snippets, officialWebsite);
        const result = {
          ...createBaseEnrichment(poi),
          rating: synthesis.rating,
          reviewCount: synthesis.reviewCount,
          hours: synthesis.hours,
          summary: synthesis.summary,
          translatedSummary: synthesis.translatedSummary,
          specialty: synthesis.specialty,
          priceLevel: synthesis.priceLevel,
          googleMapsUrl, sourceUrls, rawSnippets: snippets,
          enrichedAt: new Date().toISOString(),
          status: "done" as const, locality,
          sourceCount: snippets.length,
          sourceEngines: extractEngines(snippets),
          confidence: 0,
          essentials: synthesis.essentials,
          sourceDigests,
          officialWebsite,
        };
        result.structured = buildStructuredContent(poi, result, snippets, officialWebsite, targetLanguage);
        result.essentials = result.essentials ?? buildEssentialsText(result.structured);
        result.confidence = computeConfidence(result);
        return result;
      }
    }

    // No LLM or synthesis failed — return raw snippets without synthesis
    const noLlmResult = {
      ...createBaseEnrichment(poi),
      googleMapsUrl, sourceUrls, rawSnippets: snippets,
      enrichedAt: new Date().toISOString(),
      status: "done" as const, locality,
      sourceCount: snippets.length,
      sourceEngines: extractEngines(snippets),
      confidence: 0,
      sourceDigests: buildSourceDigests(snippets, officialWebsite),
      officialWebsite,
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
  snippets: SearchSnippet[];
  googleMapsUrl: string;
  officialWebsite: EnrichedData["officialWebsite"];
  policy: EnrichabilityPolicy;
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
        hasLLM: enrichment.summary != null,
        progress: `${completedCount}/${total}`,
      });
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

      try {
        // Geocode
        if (signal?.aborted) return;
        const locality = await reverseGeocode(poi.lat, poi.lon, apiBase, signal);
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
            sourceCount: 0, sourceEngines: [], confidence: 0,
            officialWebsite,
          };
          searchResults.push({ poi, index, locality, snippets: [], googleMapsUrl, officialWebsite, policy, earlyResult: result });
          emitResult(poi, result);
          onPhaseProgress?.("geocode-search", computeEta());
          return;
        }

        // Full policy: geocode + search
        if (signal?.aborted) return;
        const snippets = await searchPoi(poi, locality, apiBase, signal);

        if (signal?.aborted) return;
        if (snippets.length === 0) {
          const result: EnrichedData = {
            ...createBaseEnrichment(poi),
            enrichedAt: new Date().toISOString(),
            status: "skipped", skipReason: "no-results", locality,
            sourceCount: 0, sourceEngines: [], confidence: 0,
            officialWebsite,
          };
          searchResults.push({ poi, index, locality, snippets: [], googleMapsUrl, officialWebsite, policy, earlyResult: result });
          emitResult(poi, result);
          onPhaseProgress?.("geocode-search", computeEta());
          return;
        }

        searchResults.push({ poi, index, locality, snippets, googleMapsUrl, officialWebsite, policy });
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
        searchResults.push({ poi, index, locality: null, snippets: [], googleMapsUrl, officialWebsite: null, policy, earlyResult: result });
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

      const { poi, locality, snippets, googleMapsUrl, officialWebsite } = item;
      const sourceUrls = snippets.map((s) => s.url);

      try {
        if (signal?.aborted) break;

        if (isEngineReady()) {
          const synthesis = await synthesize(poi.name, poi.category, snippets, targetLanguage, officialWebsite);

          if (signal?.aborted) break;

          if (synthesis) {
            const sourceDigests = synthesis.sourceDigests.length > 0
              ? synthesis.sourceDigests
              : buildSourceDigests(snippets, officialWebsite);
            const result: EnrichedData = {
              ...createBaseEnrichment(poi),
              rating: synthesis.rating,
              reviewCount: synthesis.reviewCount,
              hours: synthesis.hours,
              summary: synthesis.summary,
              translatedSummary: synthesis.translatedSummary,
              specialty: synthesis.specialty,
              priceLevel: synthesis.priceLevel,
              googleMapsUrl, sourceUrls, rawSnippets: snippets,
              enrichedAt: new Date().toISOString(),
              status: "done", locality,
              sourceCount: snippets.length,
              sourceEngines: extractEngines(snippets),
              confidence: 0,
              essentials: synthesis.essentials,
              sourceDigests,
              officialWebsite,
            };
            result.structured = buildStructuredContent(poi, result, snippets, officialWebsite, targetLanguage);
            result.essentials = result.essentials ?? buildEssentialsText(result.structured);
            result.confidence = computeConfidence(result);
            emitResult(poi, result);
            onPhaseProgress?.("synthesize", computeEta());
            continue;
          }
        }

        // No LLM or synthesis failed — raw snippets
        const noLlmResult: EnrichedData = {
          ...createBaseEnrichment(poi),
          googleMapsUrl, sourceUrls, rawSnippets: snippets,
          enrichedAt: new Date().toISOString(),
          status: "done", locality,
          sourceCount: snippets.length,
          sourceEngines: extractEngines(snippets),
          confidence: 0,
          sourceDigests: buildSourceDigests(snippets, officialWebsite),
          officialWebsite,
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
          sourceCount: 0, sourceEngines: [], confidence: 0,
          officialWebsite,
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
 * Compute a lightweight confidence score (0-1) for an enrichment result.
 * Based on: source count, engine diversity, and structured field presence.
 */
export function computeConfidence(enrichment: {
  rawSnippets: { engine: string }[];
  rating: number | null;
  reviewCount: number | null;
  hours: string | null;
  summary: string | null;
  specialty: string | null;
}): number {
  const snippetCount = enrichment.rawSnippets.length;
  if (snippetCount === 0) return 0;

  // Source count factor: 1 snippet = 0.2, 3 = 0.5, 5+ = 0.7
  const sourceFactor = Math.min(snippetCount / 7, 0.7);

  // Engine diversity factor: multiple engines = higher confidence
  const engines = new Set(enrichment.rawSnippets.map((s) => s.engine));
  const diversityFactor = Math.min(engines.size * 0.1, 0.15);

  // Structured field presence factor: each non-null field adds 0.03
  let fieldFactor = 0;
  if (enrichment.rating != null) fieldFactor += 0.03;
  if (enrichment.reviewCount != null) fieldFactor += 0.03;
  if (enrichment.hours != null) fieldFactor += 0.03;
  if (enrichment.summary != null) fieldFactor += 0.03;
  if (enrichment.specialty != null) fieldFactor += 0.03;
  // Cap field factor at 0.15
  fieldFactor = Math.min(fieldFactor, 0.15);

  return Math.min(Math.round((sourceFactor + diversityFactor + fieldFactor) * 100) / 100, 1);
}

/** Extract unique engine names from snippets */
function extractEngines(snippets: { engine: string }[]): string[] {
  return [...new Set(snippets.map((s) => s.engine))];
}
