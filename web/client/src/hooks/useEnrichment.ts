// ---------------------------------------------------------------------------
// useEnrichment – React hook for POI enrichment batch job
// Manages: model loading → batch enrichment → retry failed → results
// ---------------------------------------------------------------------------

import { useState, useCallback, useRef, useEffect } from "react";
import type { POI, EnrichedData, EnrichmentJobState, TargetLanguage, EnrichmentPhase } from "../types";
import {
  isWebGpuAvailable,
  initEngine,
  unloadEngine,
  enrichBatch,
} from "../lib/enrichment";
import { dlog } from "../lib/debug-log";

const API_BASE = "/api";

/** Max number of automatic retry passes for failed POIs */
const MAX_RETRY_PASSES = 2;

/** Stagger multiplier for each retry pass (exponential backoff) */
const RETRY_STAGGER_MULTIPLIER = 3;

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL_JOB: EnrichmentJobState = {
  stage: "idle",
  total: 0,
  completed: 0,
  errorCount: 0,
  skippedCount: 0,
  currentPoiName: null,
  currentPoiId: null,
  modelLoadProgress: 0,
  webGpuAvailable: false,
  searxngAvailable: false,
  targetLanguage: "en",
  error: null,
  phase: "idle",
  etaSeconds: null,
};

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useEnrichment() {
  const [job, setJob] = useState<EnrichmentJobState>({
    ...INITIAL_JOB,
    webGpuAvailable: isWebGpuAvailable(),
  });
  const [enrichments, setEnrichments] = useState<Map<string, EnrichedData>>(
    new Map(),
  );
  const abortRef = useRef<AbortController | null>(null);
  /** Ref mirror of enrichments for synchronous reads (e.g. filtering in continueEnrichment) */
  const enrichmentsRef = useRef<Map<string, EnrichedData>>(new Map());

  /** Update enrichments state + ref mirror together */
  const updateEnrichments = useCallback(
    (updater: (prev: Map<string, EnrichedData>) => Map<string, EnrichedData>) => {
      setEnrichments((prev) => {
        const next = updater(prev);
        enrichmentsRef.current = next;
        return next;
      });
    },
    [],
  );

  const updateJob = useCallback(
    (partial: Partial<EnrichmentJobState>) =>
      setJob((prev) => ({ ...prev, ...partial })),
    [],
  );

  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then((res) => res.json())
      .then((data) => {
        updateJob({
          searxngAvailable: data.services?.searxng === "ok",
        });
      })
      .catch(() => {
        updateJob({ searxngAvailable: false });
      });
  }, [updateJob]);

  /**
   * Start enrichment for a list of POIs.
   * 1. Load WebLLM model (if WebGPU available)
   * 2. Run batch enrichment (search + geocode + LLM per POI)
   * 3. Auto-retry failed POIs (rate-limited / errors) up to MAX_RETRY_PASSES times
   * 4. Update enrichments map incrementally
   * @param targetLanguage - language for LLM synthesis output (default: "en")
   * @param enrichAll - override enrichability policy to "full" for all categories
   */
  const startEnrichment = useCallback(
    async (pois: POI[], targetLanguage: TargetLanguage = "en", enrichAll: boolean = false) => {
      // Cancel any running job
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;
      const log = dlog("enrichment");

      const hasWebGpu = isWebGpuAvailable();

      try {
        // Step 1: Load LLM model (skip if no WebGPU)
        if (hasWebGpu) {
          updateJob({
            stage: "loading-model",
            total: pois.length,
            completed: 0,
            currentPoiName: null,
            modelLoadProgress: 0,
            webGpuAvailable: true,
            targetLanguage,
            error: null,
          });

          const ok = await initEngine((progress) => {
            updateJob({ modelLoadProgress: progress });
          });

          if (!ok) {
            // Model load failed — continue without LLM
            updateJob({ webGpuAvailable: false });
          }
        } else {
          updateJob({
            stage: "loading-model",
            total: pois.length,
            completed: 0,
            currentPoiName: null,
            modelLoadProgress: 1,
            webGpuAvailable: false,
            targetLanguage,
            error: null,
          });
        }

        if (ctrl.signal.aborted) return;

        // Step 2: Batch enrichment
        updateJob({
          stage: "running",
          modelLoadProgress: 1,
          phase: "geocode-search",
          etaSeconds: null,
          errorCount: 0,
          skippedCount: 0,
          currentPoiId: pois[0]?.id ?? null,
          currentPoiName: pois[0]?.name ?? null,
        });

        // Build a POI lookup for retry passes
        const poiById = new Map(pois.map((p) => [p.id, p]));

        await enrichBatch(pois, {
          signal: ctrl.signal,
          searchConcurrency: 3,
          searchStaggerMs: 500,
          skipUnnamed: true,
          targetLanguage,
          enrichAll,
          onProgress: (poiId, enrichment, completed, total) => {
            // Update enrichments map incrementally
            updateEnrichments((prev) => {
              const next = new Map(prev);
              next.set(poiId, enrichment);
              return next;
            });

            // Track the next POI being processed
            const nextPoi = completed < total ? pois[completed] : null;

            setJob((prev) => ({
              ...prev,
              completed,
              total,
              errorCount: prev.errorCount + (enrichment.status === "error" ? 1 : 0),
              skippedCount: prev.skippedCount + (enrichment.status === "skipped" ? 1 : 0),
              currentPoiName: nextPoi?.name ?? null,
              currentPoiId: nextPoi?.id ?? null,
            }));
          },
          onPhaseProgress: (phase: EnrichmentPhase, etaSeconds: number | null) => {
            updateJob({ phase, etaSeconds });
          },
        });

        if (ctrl.signal.aborted) return;

        // -----------------------------------------------------------------
        // Step 3: Retry failed POIs (rate-limited / search errors)
        // -----------------------------------------------------------------
        for (let retryPass = 1; retryPass <= MAX_RETRY_PASSES; retryPass++) {
          if (ctrl.signal.aborted) break;

          // Collect failed POI IDs from current enrichments ref
          const failedPois: POI[] = [];
          for (const [id, data] of enrichmentsRef.current) {
            if (data.status === "error") {
              const poi = poiById.get(id);
              if (poi) failedPois.push(poi);
            }
          }

          if (failedPois.length === 0) break;

          const retryStaggerMs = 500 * RETRY_STAGGER_MULTIPLIER * retryPass;
          log.info(`Retry pass ${retryPass}/${MAX_RETRY_PASSES}: ${failedPois.length} failed POIs (stagger=${retryStaggerMs}ms)`, {
            retryPass,
            failedCount: failedPois.length,
            staggerMs: retryStaggerMs,
          });

          updateJob({
            phase: "retry",
            currentPoiName: failedPois[0]?.name ?? null,
            currentPoiId: failedPois[0]?.id ?? null,
          });

          // Wait before retry to let rate-limits cool down
          const cooldownMs = 5_000 * retryPass;
          await new Promise((r) => setTimeout(r, cooldownMs));
          if (ctrl.signal.aborted) break;

          await enrichBatch(failedPois, {
            signal: ctrl.signal,
            searchConcurrency: 2, // lower concurrency for retries
            searchStaggerMs: retryStaggerMs,
            skipUnnamed: true,
            targetLanguage,
            enrichAll,
            onProgress: (poiId, enrichment) => {
              // Overwrite the previous error result
              updateEnrichments((prev) => {
                const next = new Map(prev);
                next.set(poiId, enrichment);
                return next;
              });

              // Update error count: decrement if this retry succeeded (was error → now ok)
              setJob((prev) => {
                const retrySucceeded = enrichment.status !== "error";
                return {
                  ...prev,
                  errorCount: retrySucceeded
                    ? Math.max(0, prev.errorCount - 1)
                    : prev.errorCount,
                  currentPoiName: retrySucceeded ? null : prev.currentPoiName,
                  currentPoiId: retrySucceeded ? null : prev.currentPoiId,
                };
              });
            },
            onPhaseProgress: (phase: EnrichmentPhase, etaSeconds: number | null) => {
              updateJob({ phase: "retry" as EnrichmentPhase, etaSeconds });
            },
          });
        }

        if (ctrl.signal.aborted) return;

        updateJob({
          stage: "done",
          currentPoiName: null,
          currentPoiId: null,
        });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        const message =
          err instanceof Error ? err.message : "Unknown enrichment error";
        updateJob({
          stage: "error",
          error: message,
          currentPoiName: null,
          currentPoiId: null,
        });
      }
    },
    [updateJob],
  );

  /**
   * Cancel a running enrichment job.
   */
  const cancelEnrichment = useCallback(() => {
    abortRef.current?.abort();
    updateJob({
      stage: "idle",
      currentPoiName: null,
      currentPoiId: null,
      error: null,
    });
  }, [updateJob]);

  /**
   * Continue enrichment: only process POIs that are missing or failed.
   * Preserves existing successful/skipped enrichments.
   * Perfect for resuming after a disconnect or session restore.
   */
  const continueEnrichment = useCallback(
    async (allPois: POI[], targetLanguage: TargetLanguage = "en", enrichAll: boolean = false) => {
      // Filter to only unenriched or failed POIs
      const currentEnrichments = enrichmentsRef.current;
      const pendingPois = allPois.filter((poi) => {
        const existing = currentEnrichments.get(poi.id);
        if (!existing) return true; // never enriched
        return existing.status === "error"; // failed — retry
      });

      const log = dlog("enrichment");
      log.info(`Continue enrichment: ${pendingPois.length} remaining out of ${allPois.length} total`, {
        total: allPois.length,
        alreadyDone: allPois.length - pendingPois.length,
        pending: pendingPois.length,
      });

      if (pendingPois.length === 0) {
        // Nothing to do — everything is already enriched
        updateJob({ stage: "done" });
        return;
      }

      // Reuse startEnrichment with only the pending POIs
      await startEnrichment(pendingPois, targetLanguage, enrichAll);
    },
    [startEnrichment, updateJob],
  );

  /**
   * Reset enrichment state entirely.
   */
  const resetEnrichment = useCallback(async () => {
    abortRef.current?.abort();
    await unloadEngine();
    setJob({
      ...INITIAL_JOB,
      webGpuAvailable: isWebGpuAvailable(),
    });
    enrichmentsRef.current = new Map();
    setEnrichments(new Map());
  }, []);

  /**
   * Restore enrichments from a saved session (no model load, no batch).
   */
  const restoreEnrichments = useCallback(
    (saved: Map<string, EnrichedData>) => {
      enrichmentsRef.current = saved;
      setEnrichments(saved);
      if (saved.size > 0) {
        setJob((prev) => ({
          ...prev,
          stage: "done",
          total: saved.size,
          completed: saved.size,
        }));
      }
    },
    [],
  );

  return {
    job,
    enrichments,
    startEnrichment,
    continueEnrichment,
    cancelEnrichment,
    resetEnrichment,
    restoreEnrichments,
  };
}
