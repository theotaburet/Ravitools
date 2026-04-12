// ---------------------------------------------------------------------------
// useEnrichment – React hook for POI enrichment batch job
// Manages: model loading → batch enrichment → progress → results
// ---------------------------------------------------------------------------

import { useState, useCallback, useRef } from "react";
import type { POI, EnrichedData, EnrichmentJobState } from "../types";
import {
  isWebGpuAvailable,
  initEngine,
  unloadEngine,
  enrichBatch,
} from "../lib/enrichment";

// ---------------------------------------------------------------------------
// Initial state
// ---------------------------------------------------------------------------

const INITIAL_JOB: EnrichmentJobState = {
  stage: "idle",
  total: 0,
  completed: 0,
  currentPoiName: null,
  modelLoadProgress: 0,
  webGpuAvailable: false,
  error: null,
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

  /**
   * Start enrichment for a list of POIs.
   * 1. Load WebLLM model (if WebGPU available)
   * 2. Run batch enrichment (search + geocode + LLM per POI)
   * 3. Update enrichments map incrementally
   */
  const startEnrichment = useCallback(
    async (pois: POI[]) => {
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
            error: null,
          });
        }

        if (ctrl.signal.aborted) return;

        // Step 2: Batch enrichment
        updateJob({ stage: "running", modelLoadProgress: 1 });

        await enrichBatch(pois, {
          signal: ctrl.signal,
          delayBetweenPois: 1500,
          skipUnnamed: true,
          onProgress: (poiId, enrichment, index, total) => {
            // Update enrichments map incrementally
            setEnrichments((prev) => {
              const next = new Map(prev);
              next.set(poiId, enrichment);
              return next;
            });

            updateJob({
              completed: index + 1,
              total,
              currentPoiName:
                index + 1 < total ? pois[index + 1]?.name ?? null : null,
            });
          },
        });

        if (ctrl.signal.aborted) return;

        updateJob({
          stage: "done",
          currentPoiName: null,
        });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        const message =
          err instanceof Error ? err.message : "Unknown enrichment error";
        updateJob({
          stage: "error",
          error: message,
          currentPoiName: null,
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

  return {
    job,
    enrichments,
    startEnrichment,
    cancelEnrichment,
    resetEnrichment,
  };
}
