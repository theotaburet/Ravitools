// Route/POI state: jotai atoms + action atoms
// Pipeline: upload → parse → simplify → query → process (multi-GPX)

import { atom, type Getter, type Setter } from "jotai";
import { dlog } from "../lib/debug-log";
import { km } from "../lib/format";
import { parseGpx } from "../lib/gpx-parser";
import { t } from "../lib/i18n";
import { type OverpassElement, queryAllPois } from "../lib/overpass";
import { ALL_CATEGORIES, DEFAULT_CATEGORIES, DEFAULT_MAX_DISTANCE_M } from "../lib/poi-config";
import { processElements } from "../lib/poi-processor";
import type { PipelineStage, POI, PoiCategory, RouteProcessingSettings, TraceData } from "../types";
import { showTabAtom, targetLanguageAtom } from "./ui";

const DEFAULT_ROUTE_SETTINGS: RouteProcessingSettings = {
  maxDistanceM: DEFAULT_MAX_DISTANCE_M,
};

// --- Base atoms ---

export const stageAtom = atom<PipelineStage>("idle");
export const tracesAtom = atom<TraceData[]>([]);
export const poisAtom = atom<POI[]>([]);
export const activeCategoriesAtom = atom<Set<PoiCategory>>(
  new Set<PoiCategory>(DEFAULT_CATEGORIES),
);
export const routeSettingsAtom = atom<RouteProcessingSettings>(DEFAULT_ROUTE_SETTINGS);
export const routeErrorAtom = atom<string | null>(null);
export const progressAtom = atom("");
export const progressRatioAtom = atom<number | null>(null);
export const routeWarningAtom = atom<string | null>(null);

// --- Derived atoms ---

/** POIs filtered by the active categories */
export const filteredPoisAtom = atom((get) => {
  const active = get(activeCategoriesAtom);
  return get(poisAtom).filter((p) => active.has(p.category));
});

export const isProcessingAtom = atom((get) =>
  ["parsing", "simplifying", "querying", "processing"].includes(get(stageAtom)),
);

// --- Non-reactive pipeline context (module singletons, not render state) ---

let abortCtrl: AbortController | null = null;
let rawElements: OverpassElement[] = [];
// Restored sessions have no raw Overpass elements: keep the
// restored POI superset so the distance slider can still re-filter.
// Bounded by the radius used before restore; going wider needs a re-upload.
let restoredPois: POI[] = [];

// --- Action atoms ---

export const resetRouteAtom = atom(null, (_get, set) => {
  abortCtrl?.abort();
  rawElements = [];
  restoredPois = [];
  set(stageAtom, "idle");
  set(tracesAtom, []);
  set(poisAtom, []);
  set(activeCategoriesAtom, new Set<PoiCategory>(DEFAULT_CATEGORIES));
  set(routeSettingsAtom, DEFAULT_ROUTE_SETTINGS);
  set(routeErrorAtom, null);
  set(progressAtom, "");
  set(progressRatioAtom, null);
  set(routeWarningAtom, null);
});

export const restoreRouteAtom = atom(
  null,
  (
    get,
    set,
    restored: {
      traces: TraceData[];
      pois: POI[];
      activeCategories: Set<PoiCategory>;
      routeSettings: RouteProcessingSettings;
    },
  ) => {
    restoredPois = restored.pois;
    set(stageAtom, "done");
    set(showTabAtom, "poi");
    set(tracesAtom, restored.traces);
    set(poisAtom, restored.pois);
    set(activeCategoriesAtom, restored.activeCategories);
    set(routeSettingsAtom, restored.routeSettings);
    set(progressAtom, t("route.restored", get(targetLanguageAtom), { n: restored.pois.length }));
    set(routeErrorAtom, null);
  },
);

export const toggleCategoryAtom = atom(null, (get, set, cat: PoiCategory) => {
  const next = new Set(get(activeCategoriesAtom));
  if (next.has(cat)) next.delete(cat);
  else next.add(cat);
  set(activeCategoriesAtom, next);
});

export const setAllCategoriesAtom = atom(null, (_get, set, on: boolean) => {
  set(activeCategoriesAtom, on ? new Set<PoiCategory>(ALL_CATEGORIES) : new Set<PoiCategory>());
});

/** Keep the POIs within `maxDistanceM` and say how many */
function showPois(get: Getter, set: Setter, pois: POI[], maxDistanceM: number): void {
  set(poisAtom, pois);
  set(progressAtom, t("route.found", get(targetLanguageAtom), { n: pois.length, m: maxDistanceM }));
}

export const setMaxDistanceAtom = atom(null, (get, set, maxDistanceM: number) => {
  set(routeSettingsAtom, { maxDistanceM });
  if (get(stageAtom) !== "done") return;

  if (rawElements.length > 0) {
    showPois(get, set, processElements(rawElements, get(tracesAtom), maxDistanceM), maxDistanceM);
  } else if (restoredPois.length > 0) {
    // After a session restore there are no raw elements: re-filter the restored superset
    showPois(
      get,
      set,
      restoredPois.filter((p) => p.distanceToTrace <= maxDistanceM),
      maxDistanceM,
    );
  }
});

/**
 * The upload and retry pipeline: `loadTraces` → Overpass → POIs. A newer run
 * aborts this one (its requests included), and an aborted run writes nothing.
 * On error the traces stay on the map so the user can retry without re-uploading.
 */
async function runPipeline(
  get: Getter,
  set: Setter,
  loadTraces: (signal: AbortSignal) => Promise<TraceData[]>,
): Promise<void> {
  const log = dlog("pipeline");
  abortCtrl?.abort();
  const ctrl = new AbortController();
  abortCtrl = ctrl;
  const lang = get(targetLanguageAtom);
  set(routeErrorAtom, null);
  set(routeWarningAtom, null);

  try {
    const traces = await loadTraces(ctrl.signal);
    if (ctrl.signal.aborted) return;

    const selectedCategories = [...get(activeCategoriesAtom)];
    set(stageAtom, "querying");
    set(progressAtom, t("route.querying", lang, { n: selectedCategories.length }));
    set(progressRatioAtom, 0);

    const endQuery = log.time("Overpass querying");
    const result = await queryAllPois(
      traces.map((tr) => tr.simplified),
      1000,
      selectedCategories,
      (p) => {
        if (ctrl.signal.aborted) return;
        const vars = { done: p.completedChunks, total: p.totalChunks, round: p.retryRound };
        set(progressAtom, t(p.retryRound > 0 ? "route.chunksRetry" : "route.chunks", lang, vars));
        set(progressRatioAtom, p.totalChunks > 0 ? p.completedChunks / p.totalChunks : null);
      },
      ctrl.signal,
    );
    endQuery();
    if (ctrl.signal.aborted) return;

    set(stageAtom, "processing");
    set(progressAtom, t("route.processing", lang, { n: result.elements.length }));
    const maxDistanceM = get(routeSettingsAtom).maxDistanceM;
    const endProcess = log.time("POI processing");
    rawElements = result.elements;
    const pois = processElements(result.elements, traces, maxDistanceM);
    endProcess();
    log.info(`Pipeline complete: ${pois.length} POIs from ${result.elements.length} raw elements`, {
      rawElements: result.elements.length,
      filteredPois: pois.length,
      maxDistanceM,
    });

    set(stageAtom, "done");
    set(showTabAtom, "poi");
    showPois(get, set, pois, maxDistanceM);
    set(progressRatioAtom, null);
    if (result.failedChunks > 0) {
      set(
        routeWarningAtom,
        t("route.chunksFailed", lang, { failed: result.failedChunks, total: result.totalChunks }),
      );
    }
  } catch (err) {
    if (ctrl.signal.aborted) return;
    const message = err instanceof Error ? err.message : "Unknown error occurred";
    log.error(`Pipeline error: ${message}`);
    set(stageAtom, "error");
    set(routeErrorAtom, message);
    set(progressAtom, "");
    set(progressRatioAtom, null);
  }
}

export const processFilesAtom = atom(null, (get, set, files: File[]) =>
  runPipeline(get, set, async () => {
    const log = dlog("pipeline");
    set(stageAtom, "parsing");
    set(progressAtom, t("route.reading", get(targetLanguageAtom), { n: files.length }));

    const endParse = log.time("GPX parsing");
    const traces: TraceData[] = [];
    for (let i = 0; i < files.length; i++) {
      const trace = parseGpx(await files[i].text(), i);
      // Use filename (without extension) as fallback name
      if (!trace.name) {
        trace.name = files[i].name.replace(/\.gpx$/i, "");
      }
      log.info(
        `Parsed "${trace.name}": ${trace.original.length} pts → ${trace.simplified.length} simplified, ${km(trace.totalDistanceM)} km`,
        {
          name: trace.name,
          originalPoints: trace.original.length,
          simplifiedPoints: trace.simplified.length,
          distanceKm: Math.round(trace.totalDistanceM / 100) / 10,
        },
      );
      traces.push(trace);
    }
    endParse();

    set(stageAtom, "simplifying");
    set(tracesAtom, traces);
    set(
      progressAtom,
      t("route.parsed", get(targetLanguageAtom), {
        points: traces.reduce((sum, tr) => sum + tr.original.length, 0),
        simplified: traces.reduce((sum, tr) => sum + tr.simplified.length, 0),
        km: km(traces.reduce((sum, tr) => sum + tr.totalDistanceM, 0)),
      }),
    );
    return traces;
  }),
);

export const retryQueryAtom = atom(null, (get, set) => {
  const traces = get(tracesAtom);
  if (traces.length === 0) {
    dlog("pipeline").warn("retryQuery called but no traces loaded");
    return;
  }
  return runPipeline(get, set, async () => traces);
});
