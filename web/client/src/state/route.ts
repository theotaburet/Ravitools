// ---------------------------------------------------------------------------
// Route/POI state — jotai atoms + action atoms
// Pipeline: upload → parse → simplify → query → process (multi-GPX)
// ---------------------------------------------------------------------------

import { atom, type Getter, type Setter } from "jotai";
import { dlog } from "../lib/debug-log";
import { parseGpx } from "../lib/gpx-parser";
import {
  type OverpassElement,
  type QueryAllPoisResult,
  type QueryProgress,
  queryAllPois,
} from "../lib/overpass";
import { ALL_CATEGORIES, DEFAULT_CATEGORIES } from "../lib/poi-config";
import { processElements } from "../lib/poi-processor";
import type { AppState, POI, PoiCategory, RouteProcessingSettings, TraceData } from "../types";

const DEFAULT_ROUTE_SETTINGS: RouteProcessingSettings = {
  maxDistanceM: 1500,
};

// ---------------------------------------------------------------------------
// Base atoms
// ---------------------------------------------------------------------------

export const stageAtom = atom<AppState["stage"]>("idle");
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

// ---------------------------------------------------------------------------
// Derived atoms
// ---------------------------------------------------------------------------

/** POIs filtered by the active categories */
export const filteredPoisAtom = atom((get) => {
  const active = get(activeCategoriesAtom);
  return get(poisAtom).filter((p) => active.has(p.category));
});

export const isProcessingAtom = atom((get) =>
  ["parsing", "simplifying", "querying", "processing"].includes(get(stageAtom)),
);

// ---------------------------------------------------------------------------
// Non-reactive pipeline context (module singletons, not render state)
// ---------------------------------------------------------------------------

let abortCtrl: AbortController | null = null;
let rawElements: OverpassElement[] = [];
// AUDIT R19: restored sessions have no raw Overpass elements — keep the
// restored POI superset so the distance slider can still re-filter.
// ponytail: bounded by the radius used before restore; going wider needs a re-upload.
let restoredPois: POI[] = [];

// ---------------------------------------------------------------------------
// Action atoms
// ---------------------------------------------------------------------------

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
    _get,
    set,
    restored: {
      traces: TraceData[];
      pois: POI[];
      activeCategories: Set<PoiCategory>;
      routeSettings: RouteProcessingSettings;
    },
  ) => {
    restoredPois = restored.pois; // AUDIT R19
    set(stageAtom, "done");
    set(tracesAtom, restored.traces);
    set(poisAtom, restored.pois);
    set(activeCategoriesAtom, restored.activeCategories);
    set(routeSettingsAtom, restored.routeSettings);
    set(progressAtom, `Restored ${restored.pois.length} POIs from previous session`);
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

export const setMaxDistanceAtom = atom(null, (get, set, maxDistanceM: number) => {
  set(routeSettingsAtom, { maxDistanceM });

  const stage = get(stageAtom);
  const traces = get(tracesAtom);
  if (stage !== "done" || traces.length === 0 || rawElements.length === 0) {
    // AUDIT R19: after a session restore there are no raw elements, but we
    // can still re-filter the restored superset by distance.
    if (stage === "done" && traces.length > 0 && restoredPois.length > 0) {
      const pois = restoredPois.filter((p) => p.distanceToTrace <= maxDistanceM);
      set(poisAtom, pois);
      set(
        progressAtom,
        `Found ${pois.length} POIs within ${maxDistanceM}m of your route${traces.length > 1 ? "s" : ""}`,
      );
    }
    return;
  }

  const pois = processElements(
    rawElements,
    traces.map((t) => t.simplified),
    maxDistanceM,
    50,
    traces.map((t) => t.original),
  );
  set(poisAtom, pois);
  set(
    progressAtom,
    `Found ${pois.length} POIs within ${maxDistanceM}m of your route${traces.length > 1 ? "s" : ""}`,
  );
});

// -----------------------------------------------------------------------
// Shared query→process→done pipeline used by processFiles and retryQuery
// (AUDIT R32 — the two used to duplicate ~60 lines of it)
// -----------------------------------------------------------------------
async function runQuery(
  get: Getter,
  set: Setter,
  traces: TraceData[],
  ctrl: AbortController,
): Promise<void> {
  const log = dlog("pipeline");
  const selectedCategories = [...get(activeCategoriesAtom)];

  const allSimplified = traces.flatMap((t) => t.simplified);

  const endQuery = log.time("Overpass querying");
  const queryResult: QueryAllPoisResult = await queryAllPois(
    allSimplified,
    1000,
    selectedCategories,
    (p: QueryProgress) => {
      const retryLabel =
        p.retryRound > 0 ? ` (retry ${p.retryRound}, ${p.retryingCount} chunks)` : "";
      set(
        progressAtom,
        `Querying Overpass... (${p.completedChunks}/${p.totalChunks} chunks)${retryLabel}`,
      );
      set(progressRatioAtom, p.totalChunks > 0 ? p.completedChunks / p.totalChunks : null);
    },
  );
  const elements = queryResult.elements;
  endQuery();

  if (ctrl.signal.aborted) return;

  // Process & filter POIs — distance is min over all traces
  set(stageAtom, "processing");
  set(progressAtom, `Processing ${elements.length} raw elements...`);

  const maxDistanceM = get(routeSettingsAtom).maxDistanceM;
  const endProcess = log.time("POI processing");
  rawElements = elements;
  const pois = processElements(
    elements,
    traces.map((t) => t.simplified),
    maxDistanceM,
    50,
    traces.map((t) => t.original),
  );
  endProcess();

  log.info(`Pipeline complete: ${pois.length} POIs from ${elements.length} raw elements`, {
    rawElements: elements.length,
    filteredPois: pois.length,
    maxDistanceM,
  });

  if (ctrl.signal.aborted) return;

  // Build warning if some chunks failed
  const chunkWarning =
    queryResult.failedChunks > 0
      ? `${queryResult.failedChunks}/${queryResult.totalChunks} Overpass chunks failed — results may be incomplete for parts of the route.`
      : null;

  set(stageAtom, "done");
  set(poisAtom, pois);
  set(progressAtom, `Found ${pois.length} POIs along your route${traces.length > 1 ? "s" : ""}`);
  set(progressRatioAtom, null);
  set(routeWarningAtom, chunkWarning);
}

export const processFilesAtom = atom(null, async (get, set, files: File[]) => {
  const log = dlog("pipeline");
  abortCtrl?.abort();
  const ctrl = new AbortController();
  abortCtrl = ctrl;

  const selectedCategories = [...get(activeCategoriesAtom)];

  try {
    // Stage 1: Parse all GPX files
    set(stageAtom, "parsing");
    set(routeErrorAtom, null);
    set(progressAtom, `Reading ${files.length} GPX file${files.length > 1 ? "s" : ""}...`);

    const endParse = log.time("GPX parsing");
    const traces: TraceData[] = [];
    for (let i = 0; i < files.length; i++) {
      const text = await files[i].text();
      const trace = parseGpx(text, i);
      // Use filename (without extension) as fallback name
      if (!trace.name) {
        trace.name = files[i].name.replace(/\.gpx$/i, "");
      }
      log.info(
        `Parsed "${trace.name}": ${trace.original.length} pts → ${trace.simplified.length} simplified, ${(trace.totalDistanceM / 1000).toFixed(1)} km`,
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

    const totalPoints = traces.reduce((sum, t) => sum + t.original.length, 0);
    const totalSimplified = traces.reduce((sum, t) => sum + t.simplified.length, 0);
    const totalKm = traces.reduce((sum, t) => sum + t.totalDistanceM, 0) / 1000;

    set(stageAtom, "simplifying");
    set(tracesAtom, traces);
    set(
      progressAtom,
      `Parsed ${totalPoints} points across ${traces.length} trace${traces.length > 1 ? "s" : ""}, simplified to ${totalSimplified}. Total: ${totalKm.toFixed(1)} km`,
    );

    if (ctrl.signal.aborted) return;

    // Stages 2-3: Query Overpass + process POIs (shared with retryQuery)
    set(stageAtom, "querying");
    set(progressAtom, `Querying OpenStreetMap for ${selectedCategories.length} categories...`);
    set(progressRatioAtom, 0);
    set(routeWarningAtom, null);
    await runQuery(get, set, traces, ctrl);
  } catch (err) {
    if (ctrl.signal.aborted) return;
    const message = err instanceof Error ? err.message : "Unknown error occurred";
    log.error(`Pipeline error: ${message}`);
    // Keep traces visible on the map so the user can see what was loaded
    // and retry without re-uploading. Stage goes to "error" but traces persist.
    set(stageAtom, "error");
    set(routeErrorAtom, message);
    set(progressAtom, "");
    set(progressRatioAtom, null);
  }
});

export const retryQueryAtom = atom(null, async (get, set) => {
  const log = dlog("pipeline");
  const currentTraces = get(tracesAtom);
  if (currentTraces.length === 0) {
    log.warn("retryQuery called but no traces loaded");
    return;
  }

  const ctrl = new AbortController();
  abortCtrl = ctrl;
  const selectedCategories = [...get(activeCategoriesAtom)];

  try {
    set(stageAtom, "querying");
    set(routeErrorAtom, null);
    set(progressAtom, `Retrying Overpass query for ${selectedCategories.length} categories...`);
    set(progressRatioAtom, 0);
    set(routeWarningAtom, null);

    log.info("Retrying Overpass query", {
      traces: currentTraces.length,
      simplifiedPoints: currentTraces.reduce((sum, t) => sum + t.simplified.length, 0),
    });

    await runQuery(get, set, currentTraces, ctrl);
  } catch (err) {
    if (ctrl.signal.aborted) return;
    const message = err instanceof Error ? err.message : "Unknown error occurred";
    log.error(`Retry failed: ${message}`);
    set(stageAtom, "error");
    set(routeErrorAtom, message);
    set(progressAtom, "");
    set(progressRatioAtom, null);
  }
});
