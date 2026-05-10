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
  isRetryableEnrichmentResult,
  fetchGoogleMapsJobStats,
  buildCaptchaResolveUrl,
  areAllEnginesSuspended,
  resetEngineFailureState,
} from "../lib/enrichment";
import { dlog } from "../lib/debug-log";
import { lookupPoiBatch, uploadPoiEnrichment, getPoiCacheKey } from "../lib/poi-cache";

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
  activePoiIds: new Set(),
  modelLoadProgress: 0,
  webGpuAvailable: false,
  searxngAvailable: false,
  targetLanguage: "en",
  error: null,
  phase: "idle",
  etaSeconds: null,
  warning: null,
  googleFallbackStatus: null,
  googleFallbackStats: null,
  captchaUrl: null,
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
  /** Stored params to resume after CAPTCHA resolution */
  const pausedParamsRef = useRef<{ pois: POI[]; targetLanguage: TargetLanguage; enrichAll: boolean } | null>(null);

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

  useEffect(() => {
    if (job.stage !== "running") return;
    const ctrl = new AbortController();
    const timer = setInterval(() => {
      fetchGoogleMapsJobStats(API_BASE, ctrl.signal)
        .then((stats) => {
          if (stats) updateJob({ googleFallbackStats: stats });
        })
        .catch(() => undefined);
    }, 3000);
    return () => {
      ctrl.abort();
      clearInterval(timer);
    };
  }, [job.stage, updateJob]);

  /**
   * Start enrichment for a list of POIs.
   * 1. Load WebLLM model (if WebGPU available)
   * 2. Run batch enrichment (search + geocode + LLM per POI)
    * 3. Auto-retry transient failures (errors + degraded no-results) up to MAX_RETRY_PASSES times
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
        // -----------------------------------------------------------------
        // Step 0: Shared cache lookup (Postgres+PostGIS via /api/poi/search)
        // POIs found non-stale in the DB are reused directly — no LLM, no
        // network search. Stale or missing POIs continue through the pipeline.
        // -----------------------------------------------------------------
        let poisToEnrich: POI[] = pois;
        try {
          const cached = await lookupPoiBatch(pois);
          if (cached.size > 0) {
            const reusedIds: string[] = [];
            updateEnrichments((prev) => {
              const next = new Map(prev);
              for (const poi of pois) {
                const key = getPoiCacheKey(poi);
                if (!key) continue;
                const hit = cached.get(key);
                if (hit && !hit.is_stale) {
                  next.set(poi.id, hit.enrichment);
                  reusedIds.push(poi.id);
                }
              }
              return next;
            });
            if (reusedIds.length > 0) {
              const reusedSet = new Set(reusedIds);
              poisToEnrich = pois.filter((p) => !reusedSet.has(p.id));
              log.info(`Shared cache reused ${reusedIds.length}/${pois.length} POIs; ${poisToEnrich.length} to enrich`);
            }
          }
        } catch (err) {
          // Never block enrichment on cache failure
          log.warn("Shared cache lookup failed, falling back to full enrichment", { err });
        }

        // If everything came from the cache, short-circuit cleanly.
        if (poisToEnrich.length === 0) {
          updateJob({
            stage: "done",
            total: pois.length,
            completed: pois.length,
            currentPoiName: null,
            currentPoiId: null,
            activePoiIds: new Set(),
            phase: "idle",
            etaSeconds: null,
            warning: null,
          });
          return;
        }

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
            warning: null,
            googleFallbackStatus: null,
            googleFallbackStats: null,
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
            warning: null,
            googleFallbackStatus: null,
            googleFallbackStats: null,
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
          currentPoiId: null,
          currentPoiName: null,
          activePoiIds: new Set(),
        });

        // Build a POI lookup for retry passes (covers all pois, not just to-enrich)
        const poiById = new Map(pois.map((p) => [p.id, p]));

        await enrichBatch(poisToEnrich, {
          signal: ctrl.signal,
          searchConcurrency: 3,
          searchStaggerMs: 500,
          skipUnnamed: true,
          targetLanguage,
          enrichAll,
          onPoiStart: (poiId, poiName) => {
            setJob((prev) => {
              const nextActive = new Set(prev.activePoiIds);
              nextActive.add(poiId);
              return {
                ...prev,
                currentPoiId: poiId,
                currentPoiName: poiName,
                activePoiIds: nextActive,
              };
            });
          },
          onProgress: (poiId, enrichment, completed, total) => {
            // Update enrichments map incrementally
            updateEnrichments((prev) => {
              const next = new Map(prev);
              next.set(poiId, enrichment);
              return next;
            });

            // Push successful enrichments to the shared cache (fire-and-forget).
            // Skip errors and skipped POIs so the cache stays clean.
            if (enrichment.status === "done") {
              const poi = poiById.get(poiId);
              if (poi) {
                void uploadPoiEnrichment(poi, enrichment);
              }
            }

            setJob((prev) => {
              const nextActive = new Set(prev.activePoiIds);
              nextActive.delete(poiId);
              const cachedCount = pois.length - poisToEnrich.length;
              return {
                ...prev,
                completed: completed + cachedCount,
                total: total + cachedCount,
                errorCount: prev.errorCount + (enrichment.status === "error" ? 1 : 0),
                skippedCount: prev.skippedCount + (enrichment.status === "skipped" ? 1 : 0),
                activePoiIds: nextActive,
              };
            });
          },
          onPhaseProgress: (phase: EnrichmentPhase, etaSeconds: number | null) => {
            updateJob({ phase, etaSeconds });
          },
          onWarning: (warning: string | null) => {
            updateJob({ warning });
          },
          onGoogleFallbackStatus: (googleFallbackStatus: string | null) => {
            updateJob({ googleFallbackStatus });
          },
          onAllEnginesSuspended: (captchaUrl: string) => {
            // Store params for resuming after CAPTCHA resolution
            pausedParamsRef.current = { pois, targetLanguage, enrichAll };
            updateJob({
              stage: "paused-captcha",
              captchaUrl,
              currentPoiName: null,
              currentPoiId: null,
              activePoiIds: new Set(),
              warning: null,
            });
          },
        });

        if (ctrl.signal.aborted) return;

        // -----------------------------------------------------------------
        // Step 3: Retry transient failures after cooldown
        // Skip if all engines are still suspended — pause for CAPTCHA instead
        // -----------------------------------------------------------------
        for (let retryPass = 1; retryPass <= MAX_RETRY_PASSES; retryPass++) {
          if (ctrl.signal.aborted) break;

          // Don't retry if all engines are blocked: the user needs to solve a CAPTCHA first
          if (areAllEnginesSuspended()) {
            const captchaUrl = buildCaptchaResolveUrl(API_BASE);
            pausedParamsRef.current = { pois, targetLanguage, enrichAll };
            updateJob({
              stage: "paused-captcha",
              captchaUrl,
              currentPoiName: null,
              currentPoiId: null,
              activePoiIds: new Set(),
              warning: null,
            });
            return;
          }

          // Collect retryable POI IDs from current enrichments ref
          const retryablePois: POI[] = [];
          for (const [id, data] of enrichmentsRef.current) {
            if (isRetryableEnrichmentResult(data)) {
              const poi = poiById.get(id);
              if (poi) retryablePois.push(poi);
            }
          }

          if (retryablePois.length === 0) break;

          const retryStaggerMs = 500 * RETRY_STAGGER_MULTIPLIER * retryPass;
          log.info(`Retry pass ${retryPass}/${MAX_RETRY_PASSES}: ${retryablePois.length} retryable POIs (stagger=${retryStaggerMs}ms)`, {
            retryPass,
            retryableCount: retryablePois.length,
            staggerMs: retryStaggerMs,
          });

          updateJob({
            phase: "retry",
            currentPoiName: retryablePois[0]?.name ?? null,
            currentPoiId: retryablePois[0]?.id ?? null,
            activePoiIds: new Set(),
          });

          // Wait before retry to let rate-limits cool down
          const cooldownMs = 5_000 * retryPass;
          await new Promise((r) => setTimeout(r, cooldownMs));
          if (ctrl.signal.aborted) break;

          await enrichBatch(retryablePois, {
            signal: ctrl.signal,
            searchConcurrency: 2, // lower concurrency for retries
            searchStaggerMs: retryStaggerMs,
            skipUnnamed: true,
            targetLanguage,
            enrichAll,
            onPoiStart: (poiId, poiName) => {
              setJob((prev) => {
                const nextActive = new Set(prev.activePoiIds);
                nextActive.add(poiId);
                return {
                  ...prev,
                  currentPoiId: poiId,
                  currentPoiName: poiName,
                  activePoiIds: nextActive,
                };
              });
            },
            onProgress: (poiId, enrichment) => {
              // Overwrite the previous retryable result
              updateEnrichments((prev) => {
                const next = new Map(prev);
                next.set(poiId, enrichment);
                return next;
              });

              // Update error count when a previously failing retryable item recovers.
              setJob((prev) => {
                const retrySucceeded = !isRetryableEnrichmentResult(enrichment);
                const nextActive = new Set(prev.activePoiIds);
                nextActive.delete(poiId);
                return {
                  ...prev,
                  completed: prev.completed + 1,
                  errorCount: retrySucceeded
                    ? Math.max(0, prev.errorCount - 1)
                    : prev.errorCount,
                  currentPoiName: retrySucceeded ? null : prev.currentPoiName,
                  currentPoiId: retrySucceeded ? null : prev.currentPoiId,
                  activePoiIds: nextActive,
                };
              });
            },
            onPhaseProgress: (phase: EnrichmentPhase, etaSeconds: number | null) => {
              updateJob({ phase: "retry" as EnrichmentPhase, etaSeconds });
            },
            onWarning: (warning: string | null) => {
              updateJob({ warning });
            },
            onGoogleFallbackStatus: (googleFallbackStatus: string | null) => {
              updateJob({ googleFallbackStatus });
            },
            onAllEnginesSuspended: (captchaUrl: string) => {
              pausedParamsRef.current = { pois, targetLanguage, enrichAll };
              updateJob({
                stage: "paused-captcha",
                captchaUrl,
                currentPoiName: null,
                currentPoiId: null,
                activePoiIds: new Set(),
                warning: null,
              });
            },
          });
        }

        if (ctrl.signal.aborted) return;

        updateJob({
          stage: "done",
          currentPoiName: null,
          currentPoiId: null,
          activePoiIds: new Set(),
          warning: null,
          googleFallbackStatus: null,
          googleFallbackStats: null,
        });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        const message =
          err instanceof Error ? err.message : "Unknown enrichment error";
        // "all-engines-suspended" is handled via onAllEnginesSuspended callback
        // which already set the stage to "paused-captcha"; don't overwrite it.
        if (message === "all-engines-suspended") return;
        updateJob({
          stage: "error",
          error: message,
          currentPoiName: null,
          currentPoiId: null,
          activePoiIds: new Set(),
          warning: null,
          googleFallbackStatus: null,
          googleFallbackStats: null,
        });
      }
    },
    [updateJob, updateEnrichments],
  );

  /**
   * Cancel a running enrichment job.
   */
  const cancelEnrichment = useCallback(() => {
    abortRef.current?.abort();
    pausedParamsRef.current = null;
    updateJob({
      stage: "idle",
      currentPoiName: null,
      currentPoiId: null,
      activePoiIds: new Set(),
      error: null,
      warning: null,
      googleFallbackStatus: null,
      googleFallbackStats: null,
      captchaUrl: null,
    });
  }, [updateJob]);

  /**
   * Continue enrichment: only process POIs that are missing or retryable.
   * Preserves existing successful/skipped enrichments.
   * Perfect for resuming after a disconnect or session restore.
   */
  const continueEnrichment = useCallback(
    async (allPois: POI[], targetLanguage: TargetLanguage = "en", enrichAll: boolean = false) => {
      // Filter to only unenriched or retryable POIs
      const currentEnrichments = enrichmentsRef.current;
      const pendingPois = allPois.filter((poi) => {
        const existing = currentEnrichments.get(poi.id);
        if (!existing) return true; // never enriched
        return isRetryableEnrichmentResult(existing);
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
   * Resume enrichment after the user has manually resolved a CAPTCHA.
   * Picks up where the batch left off (only retryable/unenriched POIs).
   */
  const resumeAfterCaptcha = useCallback(() => {
    const params = pausedParamsRef.current;
    if (!params) return;
    pausedParamsRef.current = null;
    updateJob({ stage: "idle", captchaUrl: null });
    // continueEnrichment filters to unenriched/retryable POIs
    continueEnrichment(params.pois, params.targetLanguage, params.enrichAll);
  }, [continueEnrichment, updateJob]);

  /**
   * Reset enrichment state entirely.
   */
  const resetEnrichment = useCallback(async () => {
    abortRef.current?.abort();
    await unloadEngine();
    resetEngineFailureState();
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
    resumeAfterCaptcha,
    resetEnrichment,
    restoreEnrichments,
  };
}
