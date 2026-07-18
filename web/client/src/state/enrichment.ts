// ---------------------------------------------------------------------------
// Enrichment state — jotai atoms + action atoms
// Manages: model loading → batch enrichment → retry failed → results
// ---------------------------------------------------------------------------

import { atom, type Getter, type Setter } from "jotai";
import { dlog } from "../lib/debug-log";
import {
  areAllEnginesSuspended,
  buildCaptchaResolveUrl,
  enrichBatch,
  initEngine,
  isRetryableEnrichmentResult,
  isWebGpuAvailable,
  resetEngineFailureState,
  unloadEngine,
} from "../lib/enrichment";
import { getPoiCacheKey, lookupPoiBatch, uploadPoiEnrichment } from "../lib/poi-cache";
import type {
  EnrichedData,
  EnrichmentJobState,
  EnrichmentPhase,
  POI,
  TargetLanguage,
} from "../types";

export const API_BASE = "/api";

/** Max number of automatic retry passes for failed POIs */
const MAX_RETRY_PASSES = 2;

/** Stagger multiplier for each retry pass (exponential backoff) */
const RETRY_STAGGER_MULTIPLIER = 3;

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
// Base atoms
// ---------------------------------------------------------------------------

export const enrichmentJobAtom = atom<EnrichmentJobState>({
  ...INITIAL_JOB,
  webGpuAvailable: isWebGpuAvailable(),
});

export const enrichmentsAtom = atom<Map<string, EnrichedData>>(new Map());

/** IDs of POIs currently being enriched (null when no batch is running) */
export const enrichingPoiIdsAtom = atom((get) => {
  const job = get(enrichmentJobAtom);
  return job.stage === "running" ? job.activePoiIds : null;
});

// ---------------------------------------------------------------------------
// Non-reactive context (module singletons)
// ---------------------------------------------------------------------------

let abortCtrl: AbortController | null = null;
/** Stored params to resume after CAPTCHA resolution */
let pausedParams: { pois: POI[]; targetLanguage: TargetLanguage; enrichAll: boolean } | null = null;

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function patchJob(get: Getter, set: Setter, partial: Partial<EnrichmentJobState>): void {
  set(enrichmentJobAtom, { ...get(enrichmentJobAtom), ...partial });
}

function setEnrichment(get: Getter, set: Setter, poiId: string, data: EnrichedData): void {
  const next = new Map(get(enrichmentsAtom));
  next.set(poiId, data);
  set(enrichmentsAtom, next);
}

function pauseForCaptcha(
  get: Getter,
  set: Setter,
  captchaUrl: string,
  params: { pois: POI[]; targetLanguage: TargetLanguage; enrichAll: boolean },
): void {
  pausedParams = params;
  patchJob(get, set, {
    stage: "paused-captcha",
    captchaUrl,
    currentPoiName: null,
    currentPoiId: null,
    activePoiIds: new Set(),
    warning: null,
  });
}

function markPoiStarted(get: Getter, set: Setter, poiId: string, poiName: string): void {
  const prev = get(enrichmentJobAtom);
  const nextActive = new Set(prev.activePoiIds);
  nextActive.add(poiId);
  set(enrichmentJobAtom, {
    ...prev,
    currentPoiId: poiId,
    currentPoiName: poiName,
    activePoiIds: nextActive,
  });
}

// ---------------------------------------------------------------------------
// Action atoms
// ---------------------------------------------------------------------------

/**
 * Start enrichment for a list of POIs.
 * 1. Shared cache lookup (Postgres via /api/poi/search)
 * 2. Load WebLLM model (if WebGPU available)
 * 3. Run batch enrichment (search + geocode + LLM per POI)
 * 4. Auto-retry transient failures up to MAX_RETRY_PASSES times
 */
export const startEnrichmentAtom = atom(
  null,
  async (
    get,
    set,
    pois: POI[],
    targetLanguage: TargetLanguage = "en",
    enrichAll: boolean = false,
  ) => {
    // Cancel any running job
    abortCtrl?.abort();
    const ctrl = new AbortController();
    abortCtrl = ctrl;
    const log = dlog("enrichment");

    const hasWebGpu = isWebGpuAvailable();

    try {
      // -----------------------------------------------------------------
      // Step 0: Shared cache lookup — POIs found non-stale in the DB are
      // reused directly. Stale or missing POIs continue through the pipeline.
      // -----------------------------------------------------------------
      let poisToEnrich: POI[] = pois;
      try {
        const cached = await lookupPoiBatch(pois);
        if (cached.size > 0) {
          const reusedIds: string[] = [];
          const next = new Map(get(enrichmentsAtom));
          for (const poi of pois) {
            const key = getPoiCacheKey(poi);
            if (!key) continue;
            const hit = cached.get(key);
            if (hit && !hit.is_stale) {
              next.set(poi.id, hit.enrichment);
              reusedIds.push(poi.id);
            }
          }
          set(enrichmentsAtom, next);
          if (reusedIds.length > 0) {
            const reusedSet = new Set(reusedIds);
            poisToEnrich = pois.filter((p) => !reusedSet.has(p.id));
            log.info(
              `Shared cache reused ${reusedIds.length}/${pois.length} POIs; ${poisToEnrich.length} to enrich`,
            );
          }
        }
      } catch (err) {
        // Never block enrichment on cache failure
        log.warn("Shared cache lookup failed, falling back to full enrichment", { err });
      }

      // If everything came from the cache, short-circuit cleanly.
      if (poisToEnrich.length === 0) {
        patchJob(get, set, {
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
      patchJob(get, set, {
        stage: "loading-model",
        total: pois.length,
        completed: 0,
        currentPoiName: null,
        modelLoadProgress: hasWebGpu ? 0 : 1,
        webGpuAvailable: hasWebGpu,
        targetLanguage,
        error: null,
        warning: null,
        googleFallbackStatus: null,
        googleFallbackStats: null,
      });

      if (hasWebGpu) {
        const ok = await initEngine((progress) => {
          patchJob(get, set, { modelLoadProgress: progress });
        });
        if (!ok) {
          // Model load failed — continue without LLM
          patchJob(get, set, { webGpuAvailable: false });
        }
      }

      if (ctrl.signal.aborted) return;

      // Step 2: Batch enrichment
      patchJob(get, set, {
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
        onPoiStart: (poiId, poiName) => markPoiStarted(get, set, poiId, poiName),
        onProgress: (poiId, enrichment, completed, total) => {
          setEnrichment(get, set, poiId, enrichment);

          // Push successful enrichments to the shared cache (fire-and-forget).
          // Skip errors and skipped POIs so the cache stays clean.
          if (enrichment.status === "done") {
            const poi = poiById.get(poiId);
            if (poi) {
              void uploadPoiEnrichment(poi, enrichment);
            }
          }

          const prev = get(enrichmentJobAtom);
          const nextActive = new Set(prev.activePoiIds);
          nextActive.delete(poiId);
          const cachedCount = pois.length - poisToEnrich.length;
          set(enrichmentJobAtom, {
            ...prev,
            completed: completed + cachedCount,
            total: total + cachedCount,
            errorCount: prev.errorCount + (enrichment.status === "error" ? 1 : 0),
            skippedCount: prev.skippedCount + (enrichment.status === "skipped" ? 1 : 0),
            activePoiIds: nextActive,
          });
        },
        onPhaseProgress: (phase: EnrichmentPhase, etaSeconds: number | null) => {
          patchJob(get, set, { phase, etaSeconds });
        },
        onWarning: (warning: string | null) => patchJob(get, set, { warning }),
        onGoogleFallbackStatus: (googleFallbackStatus: string | null) =>
          patchJob(get, set, { googleFallbackStatus }),
        onAllEnginesSuspended: (captchaUrl: string) =>
          pauseForCaptcha(get, set, captchaUrl, { pois, targetLanguage, enrichAll }),
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
          pauseForCaptcha(get, set, buildCaptchaResolveUrl(API_BASE), {
            pois,
            targetLanguage,
            enrichAll,
          });
          return;
        }

        // Collect retryable POIs from current enrichments
        const retryablePois: POI[] = [];
        for (const [id, data] of get(enrichmentsAtom)) {
          if (isRetryableEnrichmentResult(data)) {
            const poi = poiById.get(id);
            if (poi) retryablePois.push(poi);
          }
        }

        if (retryablePois.length === 0) break;

        const retryStaggerMs = 500 * RETRY_STAGGER_MULTIPLIER * retryPass;
        log.info(
          `Retry pass ${retryPass}/${MAX_RETRY_PASSES}: ${retryablePois.length} retryable POIs (stagger=${retryStaggerMs}ms)`,
          {
            retryPass,
            retryableCount: retryablePois.length,
            staggerMs: retryStaggerMs,
          },
        );

        patchJob(get, set, {
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
          onPoiStart: (poiId, poiName) => markPoiStarted(get, set, poiId, poiName),
          onProgress: (poiId, enrichment) => {
            // Overwrite the previous retryable result
            setEnrichment(get, set, poiId, enrichment);

            // Update error count when a previously failing retryable item recovers.
            const prev = get(enrichmentJobAtom);
            const retrySucceeded = !isRetryableEnrichmentResult(enrichment);
            const nextActive = new Set(prev.activePoiIds);
            nextActive.delete(poiId);
            set(enrichmentJobAtom, {
              ...prev,
              // AUDIT R17: retries re-report already-counted POIs — never exceed total
              completed: Math.min(prev.completed + 1, prev.total),
              errorCount: retrySucceeded ? Math.max(0, prev.errorCount - 1) : prev.errorCount,
              currentPoiName: retrySucceeded ? null : prev.currentPoiName,
              currentPoiId: retrySucceeded ? null : prev.currentPoiId,
              activePoiIds: nextActive,
            });
          },
          onPhaseProgress: (_phase: EnrichmentPhase, etaSeconds: number | null) => {
            patchJob(get, set, { phase: "retry" as EnrichmentPhase, etaSeconds });
          },
          onWarning: (warning: string | null) => patchJob(get, set, { warning }),
          onGoogleFallbackStatus: (googleFallbackStatus: string | null) =>
            patchJob(get, set, { googleFallbackStatus }),
          onAllEnginesSuspended: (captchaUrl: string) =>
            pauseForCaptcha(get, set, captchaUrl, { pois, targetLanguage, enrichAll }),
        });
      }

      if (ctrl.signal.aborted) return;

      patchJob(get, set, {
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
      const message = err instanceof Error ? err.message : "Unknown enrichment error";
      // "all-engines-suspended" is handled via onAllEnginesSuspended callback
      // which already set the stage to "paused-captcha"; don't overwrite it.
      if (message === "all-engines-suspended") return;
      patchJob(get, set, {
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
);

/**
 * Continue enrichment: only process POIs that are missing or retryable.
 * Preserves existing successful/skipped enrichments.
 * Perfect for resuming after a disconnect or session restore.
 */
export const continueEnrichmentAtom = atom(
  null,
  async (
    get,
    set,
    allPois: POI[],
    targetLanguage: TargetLanguage = "en",
    enrichAll: boolean = false,
  ) => {
    const currentEnrichments = get(enrichmentsAtom);
    const pendingPois = allPois.filter((poi) => {
      const existing = currentEnrichments.get(poi.id);
      if (!existing) return true; // never enriched
      return isRetryableEnrichmentResult(existing);
    });

    const log = dlog("enrichment");
    log.info(
      `Continue enrichment: ${pendingPois.length} remaining out of ${allPois.length} total`,
      {
        total: allPois.length,
        alreadyDone: allPois.length - pendingPois.length,
        pending: pendingPois.length,
      },
    );

    if (pendingPois.length === 0) {
      // Nothing to do — everything is already enriched
      patchJob(get, set, { stage: "done" });
      return;
    }

    await set(startEnrichmentAtom, pendingPois, targetLanguage, enrichAll);
  },
);

/** Cancel a running enrichment job. */
export const cancelEnrichmentAtom = atom(null, (get, set) => {
  abortCtrl?.abort();
  pausedParams = null;
  patchJob(get, set, {
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
});

/**
 * Resume enrichment after the user has manually resolved a CAPTCHA.
 * Picks up where the batch left off (only retryable/unenriched POIs).
 */
export const resumeAfterCaptchaAtom = atom(null, (get, set) => {
  const params = pausedParams;
  if (!params) return;
  pausedParams = null;
  patchJob(get, set, { stage: "idle", captchaUrl: null });
  // continueEnrichment filters to unenriched/retryable POIs
  void set(continueEnrichmentAtom, params.pois, params.targetLanguage, params.enrichAll);
});

/** Reset enrichment state entirely. */
export const resetEnrichmentAtom = atom(null, async (_get, set) => {
  abortCtrl?.abort();
  await unloadEngine();
  resetEngineFailureState();
  set(enrichmentJobAtom, {
    ...INITIAL_JOB,
    webGpuAvailable: isWebGpuAvailable(),
  });
  set(enrichmentsAtom, new Map());
});

/** Restore enrichments from a saved session (no model load, no batch). */
export const restoreEnrichmentsAtom = atom(null, (get, set, saved: Map<string, EnrichedData>) => {
  set(enrichmentsAtom, saved);
  if (saved.size > 0) {
    patchJob(get, set, {
      stage: "done",
      total: saved.size,
      completed: saved.size,
    });
  }
});
