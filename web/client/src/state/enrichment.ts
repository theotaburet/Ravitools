// Enrichment state: jotai atoms + action atoms
// Manages: model loading → batch enrichment → retry failed → results

import { atom, type Getter, type Setter } from "jotai";
import { dlog } from "../lib/debug-log";
import {
  areAllEnginesSuspended,
  buildCaptchaResolveUrl,
  type EnrichBatchOptions,
  enrichBatch,
  fetchGoogleMapsJobStats,
  initEngine,
  isRetryableEnrichmentResult,
  type LlmCapability,
  probeLlmCapability,
  resetEngineFailureState,
  tallyEnrichments,
  unloadEngine,
} from "../lib/enrichment";
import { API_BASE } from "../lib/enrichment/proxy-api";
import { lookupPoiBatch, poiCacheKey, uploadPoiEnrichment } from "../lib/poi-cache";
import type { EnrichedData, EnrichmentJobState, POI } from "../types";
import { enrichmentsAtom, filteredPoisAtom } from "./route";
import { enrichAllAtom, targetLanguageAtom } from "./ui";

/** Max number of automatic retry passes for failed POIs */
const MAX_RETRY_PASSES = 2;

/** Stagger multiplier for each retry pass (exponential backoff) */
const RETRY_STAGGER_MULTIPLIER = 3;

const INITIAL_JOB: EnrichmentJobState = {
  stage: "idle",
  total: 0,
  completed: 0,
  searched: 0,
  currentPoiName: null,
  currentPoiId: null,
  activePoiIds: new Set(),
  modelLoadProgress: 0,
  llmActive: false,
  searxngAvailable: false,
  error: null,
  phase: "idle",
  etaSeconds: null,
  googleFallbackStatus: null,
  googleFallbackStats: null,
  captchaUrl: null,
};

// --- Base atoms ---

export const enrichmentJobAtom = atom<EnrichmentJobState>(INITIAL_JOB);

/** Machine check for the local model; null until probed (see probeLlmCapabilityAtom) */
export const llmCapabilityAtom = atom<LlmCapability | null>(null);
/** "Try anyway" on a limited machine */
export const llmOptInAtom = atom(false);
/** AI synthesis runs only when the machine is ready, or limited and opted in */
export const llmEnabledAtom = atom((get) => {
  const cap = get(llmCapabilityAtom);
  if (!cap) return false;
  return cap.level === "ready" || (cap.level === "limited" && get(llmOptInAtom));
});

/** Probe once; cheap (adapter query, no model load). */
export const probeLlmCapabilityAtom = atom(null, async (get, set) => {
  if (get(llmCapabilityAtom)) return;
  set(llmCapabilityAtom, await probeLlmCapability());
});

/** IDs of POIs currently being enriched (null when no batch is running) */
export const enrichingPoiIdsAtom = atom((get) => {
  const job = get(enrichmentJobAtom);
  return job.stage === "running" ? job.activePoiIds : null;
});

/** Where the shown POIs stand: done, skipped, remaining (the 3-zone bar) */
export const enrichmentTallyAtom = atom((get) =>
  tallyEnrichments(get(filteredPoisAtom), get(enrichmentsAtom)),
);

/** No run in progress (never started or finished): only then is the step "done" */
export const enrichmentSettledAtom = atom((get) => {
  const { stage } = get(enrichmentJobAtom);
  return stage === "idle" || stage === "done";
});

// --- Non-reactive context (module singletons) ---

let abortCtrl: AbortController | null = null;
/** POIs to resume after CAPTCHA resolution */
let pausedPois: POI[] | null = null;

// --- Internal helpers ---

/** No POI in flight: the patch every stop (done, pause, error, cancel) applies */
function noCursor(): Pick<EnrichmentJobState, "currentPoiName" | "currentPoiId" | "activePoiIds"> {
  return { currentPoiName: null, currentPoiId: null, activePoiIds: new Set() };
}

function patchJob(get: Getter, set: Setter, partial: Partial<EnrichmentJobState>): void {
  set(enrichmentJobAtom, { ...get(enrichmentJobAtom), ...partial });
}

function setEnrichment(get: Getter, set: Setter, poiId: string, data: EnrichedData): void {
  const next = new Map(get(enrichmentsAtom));
  next.set(poiId, data);
  set(enrichmentsAtom, next);
}

function pauseForCaptcha(get: Getter, set: Setter, captchaUrl: string, pois: POI[]): void {
  pausedPois = pois;
  patchJob(get, set, { stage: "paused-captcha", captchaUrl, ...noCursor() });
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

/** A searched POI leaves the in-flight set; markPoiStarted brings it back for its synthesis. */
function markPoiSearched(
  get: Getter,
  set: Setter,
  poiId: string | undefined,
  patch: Partial<EnrichmentJobState> = {},
): void {
  const prev = get(enrichmentJobAtom);
  const nextActive = new Set(prev.activePoiIds);
  if (poiId) nextActive.delete(poiId);
  set(enrichmentJobAtom, { ...prev, ...patch, activePoiIds: nextActive });
}

// --- Action atoms ---

/** Is SearXNG up? The server's /health says (checked when the panel opens) */
export const checkSearxngAtom = atom(null, async (get, set) => {
  const searxngAvailable = await fetch(`${API_BASE}/health`)
    .then((res) => res.json())
    .then((data) => data.services?.searxng === "ok")
    .catch(() => false);
  patchJob(get, set, { searxngAvailable });
});

/** Refresh the server-side Google Maps queue stats (polled while a batch runs) */
export const refreshGoogleFallbackStatsAtom = atom(null, async (get, set, signal: AbortSignal) => {
  const stats = await fetchGoogleMapsJobStats(signal).catch(() => null);
  if (stats) patchJob(get, set, { googleFallbackStats: stats });
});

/**
 * Start enrichment for a list of POIs.
 * 1. Shared cache lookup (Postgres via /api/poi/search)
 * 2. Load WebLLM model (if WebGPU available)
 * 3. Run batch enrichment (search + geocode + LLM per POI)
 * 4. Auto-retry transient failures up to MAX_RETRY_PASSES times
 */
export const startEnrichmentAtom = atom(null, async (get, set, pois: POI[]) => {
  // Cancel any running job
  abortCtrl?.abort();
  const ctrl = new AbortController();
  abortCtrl = ctrl;
  const log = dlog("enrichment");
  // Settings shared by the first pass and the retries
  const common: EnrichBatchOptions = {
    signal: ctrl.signal,
    skipUnnamed: true,
    targetLanguage: get(targetLanguageAtom),
    enrichAll: get(enrichAllAtom),
    onPoiStart: (poiId, poiName) => markPoiStarted(get, set, poiId, poiName),
    onGoogleFallbackStatus: (googleFallbackStatus) => patchJob(get, set, { googleFallbackStatus }),
    onAllEnginesSuspended: (captchaUrl) => pauseForCaptcha(get, set, captchaUrl, pois),
  };

  await set(probeLlmCapabilityAtom);
  const useLlm = get(llmEnabledAtom);

  try {
    // Step 0: Shared cache lookup: POIs found non-stale in the DB are
    // reused directly. Stale or missing POIs continue through the pipeline.
    let poisToEnrich: POI[] = pois;
    try {
      const cached = await lookupPoiBatch(pois);
      if (cached.size > 0) {
        const reusedIds: string[] = [];
        const next = new Map(get(enrichmentsAtom));
        for (const poi of pois) {
          const key = poiCacheKey(poi);
          if (!key) continue;
          const hit = cached.get(key);
          // A deterministic (no-LLM) result is only worth reusing when this
          // browser cannot do better; otherwise it would be locked in for 90 days.
          const reusable =
            hit && !hit.is_stale && !(useLlm && hit.enrichment.synthesisSource === "deterministic");
          if (reusable) {
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
        ...noCursor(),
        phase: "idle",
        etaSeconds: null,
      });
      return;
    }

    // Step 1: Load LLM model (skipped when the machine check says no)
    patchJob(get, set, {
      stage: "loading-model",
      total: pois.length,
      completed: 0,
      currentPoiName: null,
      modelLoadProgress: useLlm ? 0 : 1,
      llmActive: useLlm,
      error: null,
      googleFallbackStatus: null,
      googleFallbackStats: null,
    });

    if (useLlm) {
      const ok = await initEngine((progress) => {
        patchJob(get, set, { modelLoadProgress: progress });
      });
      if (!ok) {
        // Model load failed: continue without LLM
        patchJob(get, set, { llmActive: false });
      }
    }

    if (ctrl.signal.aborted) return;

    // Step 2: Batch enrichment
    patchJob(get, set, {
      stage: "running",
      modelLoadProgress: 1,
      phase: "geocode-search",
      etaSeconds: null,
      searched: 0,
      ...noCursor(),
    });

    // Build a POI lookup for retry passes (covers all pois, not just to-enrich)
    const poiById = new Map(pois.map((p) => [p.id, p]));
    const cachedCount = pois.length - poisToEnrich.length;

    await enrichBatch(poisToEnrich, {
      ...common,
      searchConcurrency: 3,
      searchStaggerMs: 500,
      onSearchProgress: (searched, poiId) =>
        markPoiSearched(get, set, poiId, { searched: searched + cachedCount }),
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
        set(enrichmentJobAtom, {
          ...prev,
          completed: completed + cachedCount,
          total: total + cachedCount,
          activePoiIds: nextActive,
        });
      },
      onPhaseProgress: (phase, etaSeconds) => patchJob(get, set, { phase, etaSeconds }),
    });

    if (ctrl.signal.aborted) return;

    // Step 3: Retry transient failures after cooldown
    // Skip if all engines are still suspended: pause for CAPTCHA instead
    for (let retryPass = 1; retryPass <= MAX_RETRY_PASSES; retryPass++) {
      if (ctrl.signal.aborted) break;

      // Don't retry if all engines are blocked: the user needs to solve a CAPTCHA first
      if (areAllEnginesSuspended()) {
        pauseForCaptcha(get, set, buildCaptchaResolveUrl(), pois);
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
        ...common,
        searchConcurrency: 2, // lower concurrency for retries
        searchStaggerMs: retryStaggerMs,
        onSearchProgress: (_searched, poiId) => markPoiSearched(get, set, poiId),
        onProgress: (poiId, enrichment) => {
          // Overwrite the previous retryable result
          setEnrichment(get, set, poiId, enrichment);

          // A recovered POI no longer holds the "current" label
          const prev = get(enrichmentJobAtom);
          const retrySucceeded = !isRetryableEnrichmentResult(enrichment);
          const nextActive = new Set(prev.activePoiIds);
          nextActive.delete(poiId);
          set(enrichmentJobAtom, {
            ...prev,
            // Retries re-report already-counted POIs: never exceed total
            completed: Math.min(prev.completed + 1, prev.total),
            currentPoiName: retrySucceeded ? null : prev.currentPoiName,
            currentPoiId: retrySucceeded ? null : prev.currentPoiId,
            activePoiIds: nextActive,
          });
        },
        onPhaseProgress: (_phase, etaSeconds) => patchJob(get, set, { phase: "retry", etaSeconds }),
      });
    }

    if (ctrl.signal.aborted) return;

    patchJob(get, set, {
      stage: "done",
      ...noCursor(),
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
      ...noCursor(),
      googleFallbackStatus: null,
      googleFallbackStats: null,
    });
  }
});

/**
 * Continue enrichment: only process POIs that are missing or retryable.
 * Preserves existing successful/skipped enrichments.
 * Perfect for resuming after a disconnect or session restore.
 */
export const continueEnrichmentAtom = atom(null, async (get, set, allPois: POI[]) => {
  const currentEnrichments = get(enrichmentsAtom);
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
    // Nothing to do: everything is already enriched
    patchJob(get, set, { stage: "done" });
    return;
  }

  await set(startEnrichmentAtom, pendingPois);
});

/** Cancel a running enrichment job. */
export const cancelEnrichmentAtom = atom(null, (get, set) => {
  abortCtrl?.abort();
  pausedPois = null;
  patchJob(get, set, {
    stage: "idle",
    ...noCursor(),
    error: null,
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
  const pois = pausedPois;
  if (!pois) return;
  pausedPois = null;
  patchJob(get, set, { stage: "idle", captchaUrl: null });
  // continueEnrichment filters to unenriched/retryable POIs
  void set(continueEnrichmentAtom, pois);
});

/** Reset enrichment state entirely. */
export const resetEnrichmentAtom = atom(null, async (_get, set) => {
  abortCtrl?.abort();
  await unloadEngine();
  resetEngineFailureState();
  set(enrichmentJobAtom, INITIAL_JOB);
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
