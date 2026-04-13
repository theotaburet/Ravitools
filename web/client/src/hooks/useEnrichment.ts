// ---------------------------------------------------------------------------
// useEnrichment – React hook for POI enrichment batch job
// Manages: model loading → batch enrichment → progress → results
// ---------------------------------------------------------------------------

import { useState, useCallback, useRef, useEffect } from "react";
import type { POI, EnrichedData, EnrichmentJobState, TargetLanguage, EnrichmentPhase } from "../types";
import {
  isWebGpuAvailable,
  initEngine,
  unloadEngine,
  enrichBatch,
} from "../lib/enrichment";

const API_BASE = "/api";

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
   * 3. Update enrichments map incrementally
   * @param targetLanguage - language for LLM synthesis output (default: "en")
   * @param enrichAll - override enrichability policy to "full" for all categories
   */
  const startEnrichment = useCallback(
    async (pois: POI[], targetLanguage: TargetLanguage = "en", enrichAll: boolean = false) => {
      // Cancel any running job
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

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

        await enrichBatch(pois, {
          signal: ctrl.signal,
          searchConcurrency: 3,
          searchStaggerMs: 500,
          skipUnnamed: true,
          targetLanguage,
          enrichAll,
          onProgress: (poiId, enrichment, completed, total) => {
            // Update enrichments map incrementally
            setEnrichments((prev) => {
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
   * Reset enrichment state entirely.
   */
  const resetEnrichment = useCallback(async () => {
    abortRef.current?.abort();
    await unloadEngine();
    setJob({
      ...INITIAL_JOB,
      webGpuAvailable: isWebGpuAvailable(),
    });
    setEnrichments(new Map());
  }, []);

  /**
   * Restore enrichments from a saved session (no model load, no batch).
   */
  const restoreEnrichments = useCallback(
    (saved: Map<string, EnrichedData>) => {
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
    cancelEnrichment,
    resetEnrichment,
    restoreEnrichments,
  };
}
