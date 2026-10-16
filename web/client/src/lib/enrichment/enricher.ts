// Enricher: orchestrates POI enrichment pipeline
// For each POI: reverse geocode → search → LLM synthesis → EnrichedData
// Uses staged pipeline: geocode+search with concurrency, LLM serial.

import type {
  EnrichabilityPolicy,
  EnrichedData,
  EnrichmentPhase,
  GoogleMapsPreview,
  OpeningHoursEntry,
  POI,
  SkipReason,
  TargetLanguage,
} from "../../types";
import { dlog } from "../debug-log";
import { getEnrichabilityPolicy } from "../poi-config";
import { isGenericPoiName } from "./deterministic";
import { areAllEnginesSuspended, buildCaptchaResolveUrl } from "./engine-health";
import { reverseGeocode } from "./geocode";
import { resolveGoogleMapsFallbackSnippets } from "./google-fallback";
import { buildGoogleMapsUrl } from "./google-maps";
import { isEngineReady, synthesize } from "./llm";
import { osmFacts } from "./osm-facts";
import {
  buildDeterministicResult,
  buildSynthesizedResult,
  emptyEnrichment,
  type SearchStageResult,
} from "./results";
import { runConcurrent } from "./run-concurrent";
import { searchPoi } from "./search";
import { rankSnippetsByQuality } from "./structured";
import { fetchOfficialSite, getOfficialWebsiteUrl, readSearchPages } from "./websites";

export function isRetryableEnrichmentResult(
  enrichment: Pick<EnrichedData, "status" | "skipReason" | "unresponsiveEngines"> | undefined,
): boolean {
  if (!enrichment) return true;
  if (enrichment.status === "error") return true;
  return (
    enrichment.status === "skipped" &&
    enrichment.skipReason === "no-results" &&
    (enrichment.unresponsiveEngines?.length ?? 0) > 0
  );
}

export interface EnrichmentTally<P extends Pick<POI, "id"> = POI> {
  total: number;
  done: number;
  skipped: number;
  /** Not enriched yet or worth retrying (errors included): what "Continue" picks up */
  remaining: number;
  errors: number;
  /** The skipped POIs themselves, so the user can judge each skip */
  skippedByReason: Partial<Record<SkipReason, P[]>>;
}

/** Where the shown POIs stand: every POI lands in exactly one of done, skipped, remaining. */
export function tallyEnrichments<P extends Pick<POI, "id">>(
  pois: readonly P[],
  enrichments: ReadonlyMap<
    string,
    Pick<EnrichedData, "status" | "skipReason" | "unresponsiveEngines">
  >,
): EnrichmentTally<P> {
  const tally: EnrichmentTally<P> = {
    total: pois.length,
    done: 0,
    skipped: 0,
    remaining: 0,
    errors: 0,
    skippedByReason: {},
  };
  for (const poi of pois) {
    const enrichment = enrichments.get(poi.id);
    if (enrichment?.status === "error") tally.errors++;
    if (enrichment?.status === "done") tally.done++;
    else if (enrichment?.status === "skipped" && !isRetryableEnrichmentResult(enrichment)) {
      tally.skipped++;
      const reason = enrichment.skipReason ?? "no-results";
      const group = tally.skippedByReason[reason];
      if (group) group.push(poi);
      else tally.skippedByReason[reason] = [poi];
    } else tally.remaining++;
  }
  return tally;
}

// --- Types ---

/** Callback fired after each POI is enriched */
export type EnrichmentProgressCallback = (
  poiId: string,
  enrichment: EnrichedData,
  index: number,
  total: number,
) => void;

/** Callback fired when a POI starts being processed (for live animation) */
export type PoiStartCallback = (poiId: string, poiName: string) => void;

/** POIs past the web search, skipped ones included; poiId is the POI that just left it (none on the first call) */
export type SearchProgressCallback = (searched: number, poiId?: string) => void;

/** Callback for phase/ETA updates during enrichment */
export type PhaseProgressCallback = (phase: EnrichmentPhase, etaSeconds: number | null) => void;

/** Options for the enrichment batch */
export interface EnrichBatchOptions {
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
  /** Callback when a POI leaves the web search (it waits for synthesis, out of the in-flight set) */
  onSearchProgress?: SearchProgressCallback;
  /** Callback for phase/ETA updates */
  onPhaseProgress?: PhaseProgressCallback;
  /** Callback for slow Google fallback status */
  onGoogleFallbackStatus?: (status: string | null) => void;
  /**
   * Callback fired when ALL search engines are simultaneously suspended
   * (CAPTCHA / access denied / rate-limited).
   * The batch should pause and the user should resolve the CAPTCHA manually.
   * Receives the URL to open for CAPTCHA resolution.
   */
  onAllEnginesSuspended?: (captchaUrl: string) => void;
}

// --- Single POI enrichment ---

/**
 * Enrich a single POI: geocode → search → synthesize.
 * Always returns an EnrichedData, even on partial failure.
 * Respects enrichability policy unless overridden.
 */
export async function enrichPoi(
  poi: POI,
  options: {
    signal?: AbortSignal;
    targetLanguage?: TargetLanguage;
    /** Override: force "full" enrichment regardless of category policy */
    policyOverride?: EnrichabilityPolicy;
  } = {},
): Promise<EnrichedData> {
  const results = await enrichBatch([poi], {
    signal: options.signal,
    targetLanguage: options.targetLanguage,
    enrichAll: options.policyOverride === "full",
    skipUnnamed: false, // single-POI callers pick the POI explicitly
  });
  return results.get(poi.id) ?? emptyEnrichment(poi, { status: "error", error: "Cancelled" });
}

/** Snippets handed to the LLM per POI: official site, search, pages read, Google, after ranking. */
const MAX_SNIPPETS_FOR_LLM = 10;

// --- Batch enrichment: staged pipeline with concurrency ---

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
    signal,
    searchConcurrency = 3,
    searchStaggerMs = 500,
    skipUnnamed = true,
    targetLanguage = "en",
    enrichAll = false,
    onProgress,
    onPoiStart,
    onSearchProgress,
    onPhaseProgress,
    onGoogleFallbackStatus,
    onAllEnginesSuspended,
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

      // Log divergences when detected
      if (enrichment.structured?.divergences && enrichment.structured.divergences.length > 0) {
        log.info(
          `Divergences detected for "${poi.name}": ${enrichment.structured.divergences.join(" | ")}`,
          {
            divergenceCount: enrichment.structured.divergences.length,
          },
        );
      }

      // Log source confirmation level
      if (
        enrichment.structured?.sourceConfirmation &&
        enrichment.structured.sourceConfirmation !== "none"
      ) {
        log.debug(
          `Source confirmation for "${poi.name}": ${enrichment.structured.sourceConfirmation}`,
          {
            sourceConfirmation: enrichment.structured.sourceConfirmation,
          },
        );
      }

      // Log official website impact
      if (enrichment.officialWebsite) {
        const hasUsefulContent =
          enrichment.officialWebsite.description || enrichment.officialWebsite.excerpt;
        log.debug(
          `Official site for "${poi.name}": ${hasUsefulContent ? "useful content extracted" : "no useful content"}`,
          {
            officialUrl: enrichment.officialWebsite.finalUrl,
            hasContent: !!hasUsefulContent,
          },
        );
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

  // --- Pre-filter: resolve skip/unnamed/generic POIs immediately (no network) ---
  const searchQueue: { poi: POI; policy: EnrichabilityPolicy }[] = [];

  for (let i = 0; i < pois.length; i++) {
    if (signal?.aborted) break;
    const poi = pois[i];

    // Skip unnamed or generic POI names that won't yield useful search results
    if (skipUnnamed && isGenericPoiName(poi.name)) {
      emitResult(poi, emptyEnrichment(poi, { status: "skipped", skipReason: "generic-name" }));
      continue;
    }

    const policy = enrichAll
      ? ("full" as EnrichabilityPolicy)
      : getEnrichabilityPolicy(poi.category);

    // Skip categories
    if (policy === "skip") {
      emitResult(
        poi,
        emptyEnrichment(poi, { status: "skipped", skipReason: "low-value-category" }),
      );
      continue;
    }

    searchQueue.push({ poi, policy });
  }

  if (signal?.aborted || searchQueue.length === 0) return results;

  // --- Stage 1: Geocode + Search: concurrent with stagger ---
  log.info(
    `Stage 1: geocode+search for ${searchQueue.length} POIs (concurrency=${searchConcurrency}, stagger=${searchStaggerMs}ms)`,
    {
      searchQueue: searchQueue.length,
      skipped: total - searchQueue.length,
      concurrency: searchConcurrency,
    },
  );
  onPhaseProgress?.("geocode-search", null);
  let searchedCount = total - searchQueue.length;
  onSearchProgress?.(searchedCount);

  const needSynthesis: SearchStageResult[] = [];
  /** Set to true when all engines are suspended so the batch stops immediately */
  let allEnginesSuspended = false;

  await runConcurrent(searchQueue, searchConcurrency, searchStaggerMs, signal, async (item) => {
    if (signal?.aborted) return;
    const { poi, policy } = item;
    const googleMapsUrl = buildGoogleMapsUrl(poi);
    const officialWebsiteUrl = getOfficialWebsiteUrl(poi);

    // Signal that this POI has started processing (for live animation)
    onPoiStart?.(poi.id, poi.name);

    try {
      // Geocode → returns full GeoContext
      if (signal?.aborted) return;
      const geoContext = await reverseGeocode(poi.lat, poi.lon, signal);
      const locality = geoContext?.locality ?? null;
      const { preview: officialWebsite, snippets: websiteSnippets } = officialWebsiteUrl
        ? await fetchOfficialSite(officialWebsiteUrl, signal)
        : { preview: null, snippets: [] };

      // Minimal policy: geocode only
      if (signal?.aborted) return;
      if (policy === "minimal") {
        emitResult(
          poi,
          emptyEnrichment(poi, { status: "done", locality, geoContext, officialWebsite }),
        );
        onPhaseProgress?.("geocode-search", computeEta());
        return;
      }

      // Full policy: geocode + search
      if (signal?.aborted) return;
      const searchResult = await searchPoi(poi, locality, signal, 3, geoContext);
      const searchQuery = searchResult.query;
      const unresponsiveEngines = searchResult.unresponsiveEngines;
      let snippets = [...websiteSnippets, ...searchResult.snippets].slice(0, MAX_SNIPPETS_FOR_LLM);
      const needsGoogleFallback = snippets.length < 2 || unresponsiveEngines.length >= 2;
      let googleMapsStructuredHoursForBatch: OpeningHoursEntry[] | null = null;
      let googleMapsPreviewForBatch: GoogleMapsPreview | null = null;
      if (needsGoogleFallback) {
        onPhaseProgress?.("google-fallback", computeEta());
        const googleResult = await resolveGoogleMapsFallbackSnippets(
          poi,
          targetLanguage,
          onGoogleFallbackStatus,
          signal,
        );
        snippets = [...snippets, ...googleResult.snippets].slice(0, MAX_SNIPPETS_FOR_LLM);
        googleMapsStructuredHoursForBatch = googleResult.structuredHours;
        googleMapsPreviewForBatch = googleResult.preview;
      }

      // Rank snippets by domain quality: highest-signal sources first, noise removed.
      snippets = rankSnippetsByQuality(snippets);
      // Read behind the two best results: a 160-character snippet never holds a price or a season.
      if (signal?.aborted) return;
      const pageSnippets = await readSearchPages(poi, snippets, officialWebsiteUrl, signal);
      snippets = rankSnippetsByQuality([...snippets, ...pageSnippets]).slice(
        0,
        MAX_SNIPPETS_FOR_LLM,
      );

      if (areAllEnginesSuspended()) {
        allEnginesSuspended = true;
        onAllEnginesSuspended?.(buildCaptchaResolveUrl());
        return; // stop this worker; the batch loop checks allEnginesSuspended
      }

      if (signal?.aborted) return;
      if (snippets.length === 0) {
        emitResult(
          poi,
          emptyEnrichment(poi, {
            status: "skipped",
            skipReason: "no-results",
            locality,
            geoContext,
            searchQuery,
            officialWebsite,
            unresponsiveEngines,
          }),
        );
        onPhaseProgress?.("geocode-search", computeEta());
        return;
      }

      needSynthesis.push({
        poi,
        locality,
        geoContext,
        searchQuery,
        snippets,
        googleMapsUrl,
        officialWebsite,
        unresponsiveEngines,
        googleMapsStructuredHours: googleMapsStructuredHoursForBatch,
        googleMapsPreview: googleMapsPreviewForBatch,
      });
      onPhaseProgress?.("geocode-search", computeEta());
    } catch (err) {
      if (signal?.aborted) return;
      const message = err instanceof Error ? err.message : "Unknown error";
      emitResult(poi, emptyEnrichment(poi, { status: "error", error: message }));
      onPhaseProgress?.("geocode-search", computeEta());
    } finally {
      if (!signal?.aborted) onSearchProgress?.(++searchedCount, poi.id);
    }
  });

  if (signal?.aborted) return results;
  if (allEnginesSuspended) throw new Error("all-engines-suspended");

  // --- Stage 2: LLM Synthesis: serial (WebLLM is single-threaded) ---
  if (needSynthesis.length > 0) {
    log.info(`Stage 2: LLM synthesis for ${needSynthesis.length} POIs (serial)`, {
      needSynthesis: needSynthesis.length,
      llmReady: isEngineReady(),
    });
    onPhaseProgress?.("synthesize", computeEta());

    for (const item of needSynthesis) {
      if (signal?.aborted) break;
      const { poi } = item;

      // Signal that this POI is now in LLM synthesis (for live animation)
      onPoiStart?.(poi.id, poi.name);

      try {
        if (signal?.aborted) break;

        let result: EnrichedData | null = null;
        if (isEngineReady()) {
          const synthesis = await synthesize(
            poi.name,
            poi.category,
            item.snippets,
            targetLanguage,
            item.officialWebsite,
            osmFacts(poi.tags, "en"),
          );
          if (signal?.aborted) break;
          if (synthesis) {
            result = buildSynthesizedResult(item, synthesis, targetLanguage);
          }
        }

        // No LLM or synthesis failed: deterministic extraction from snippets
        emitResult(poi, result ?? buildDeterministicResult(item, targetLanguage));
        onPhaseProgress?.("synthesize", computeEta());
      } catch (err) {
        if (signal?.aborted) break;
        const message = err instanceof Error ? err.message : "Unknown error";
        emitResult(
          poi,
          emptyEnrichment(poi, {
            status: "error",
            error: message,
            googleMapsUrl: item.googleMapsUrl,
            rawSnippets: item.snippets,
            locality: item.locality,
            geoContext: item.geoContext,
            searchQuery: item.searchQuery,
            officialWebsite: item.officialWebsite,
            unresponsiveEngines: item.unresponsiveEngines,
          }),
        );
        onPhaseProgress?.("synthesize", computeEta());
      }
    }
  }

  // Final summary
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const doneCount = [...results.values()].filter((r) => r.status === "done").length;
  const skippedCount = [...results.values()].filter((r) => r.status === "skipped").length;
  const errorCount = [...results.values()].filter((r) => r.status === "error").length;
  log.info(
    `Enrichment complete: ${doneCount} done, ${skippedCount} skipped, ${errorCount} errors in ${elapsed}s`,
    {
      total: results.size,
      done: doneCount,
      skipped: skippedCount,
      errors: errorCount,
      elapsedSec: parseFloat(elapsed),
    },
  );

  return results;
}
