// ---------------------------------------------------------------------------
// useRavitools – main application hook
// Orchestrates the full pipeline: upload → parse → simplify → query → process
// Supports multiple GPX files simultaneously
// ---------------------------------------------------------------------------

import { useState, useCallback, useRef } from "react";
import type { AppState, POI, PoiCategory, TraceData, RouteProcessingSettings } from "../types";
import { parseGpx } from "../lib/gpx-parser";
import { queryAllPois, type OverpassElement, type QueryAllPoisResult, type QueryProgress } from "../lib/overpass";
import { processElements } from "../lib/poi-processor";
import { ALL_CATEGORIES, DEFAULT_CATEGORIES } from "../lib/poi-config";
import { dlog } from "../lib/debug-log";

const DEFAULT_ROUTE_SETTINGS: RouteProcessingSettings = {
  maxDistanceM: 1500,
};

const INITIAL_STATE: AppState = {
  stage: "idle",
  traces: [],
  pois: [],
  activeCategories: new Set(DEFAULT_CATEGORIES),
  routeSettings: DEFAULT_ROUTE_SETTINGS,
  error: null,
  progress: "",
  progressRatio: null,
  warning: null,
};

export function useRavitools() {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);
  const rawElementsRef = useRef<OverpassElement[]>([]);
  // Keep a ref to activeCategories so processFiles always reads the latest value
  const activeCatsRef = useRef<Set<PoiCategory>>(state.activeCategories);
  activeCatsRef.current = state.activeCategories;
  const routeSettingsRef = useRef<RouteProcessingSettings>(state.routeSettings);
  routeSettingsRef.current = state.routeSettings;

  const update = useCallback(
    (partial: Partial<AppState>) =>
      setState((prev) => ({ ...prev, ...partial })),
    [],
  );

  // Reset
  const reset = useCallback(() => {
    abortRef.current?.abort();
    rawElementsRef.current = [];
    routeSettingsRef.current = DEFAULT_ROUTE_SETTINGS;
    setState(INITIAL_STATE);
  }, []);

  // Restore state from a saved session
  const restoreState = useCallback(
    (restored: {
      traces: TraceData[];
      pois: POI[];
      activeCategories: Set<PoiCategory>;
      routeSettings: RouteProcessingSettings;
    }) => {
      routeSettingsRef.current = restored.routeSettings;
      setState((prev) => ({
        ...prev,
        stage: "done" as const,
        traces: restored.traces,
        pois: restored.pois,
        activeCategories: restored.activeCategories,
        routeSettings: restored.routeSettings,
        progress: `Restored ${restored.pois.length} POIs from previous session`,
        error: null,
      }));
    },
    [],
  );

  // Toggle category filter
  const toggleCategory = useCallback((cat: PoiCategory) => {
    setState((prev) => {
      const next = new Set(prev.activeCategories);
      if (next.has(cat)) next.delete(cat);
      else next.add(cat);
      return { ...prev, activeCategories: next };
    });
  }, []);

  // Set all categories on/off
  const setAllCategories = useCallback((on: boolean) => {
    setState((prev) => ({
      ...prev,
      activeCategories: on ? new Set(ALL_CATEGORIES) : new Set(),
    }));
  }, []);

  const setMaxDistance = useCallback((maxDistanceM: number) => {
    const routeSettings = { maxDistanceM };
    routeSettingsRef.current = routeSettings;

    setState((prev) => {
      if (
        prev.stage !== "done" ||
        prev.traces.length === 0 ||
        rawElementsRef.current.length === 0
      ) {
        return { ...prev, routeSettings };
      }

      const allTraceSimplified = prev.traces.map((t) => t.simplified);
      const allTraceOriginal = prev.traces.map((t) => t.original);
      const pois = processElements(
        rawElementsRef.current,
        allTraceSimplified,
        maxDistanceM,
        50,
        allTraceOriginal,
      );

      return {
        ...prev,
        routeSettings,
        pois,
        progress: `Found ${pois.length} POIs within ${maxDistanceM}m of your route${prev.traces.length > 1 ? "s" : ""}`,
      };
    });
  }, []);

  // Filtered POIs based on active categories
  const filteredPois = state.pois.filter((p) =>
    state.activeCategories.has(p.category),
  );

  // -----------------------------------------------------------------------
  // Main pipeline – processes one or more GPX files
  // -----------------------------------------------------------------------
  const processFiles = useCallback(
    async (files: File[]) => {
      const log = dlog("pipeline");
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      // Snapshot active categories at the moment of upload
      const selectedCategories = [...activeCatsRef.current];

      try {
        // Stage 1: Parse all GPX files
        update({ stage: "parsing", error: null, progress: `Reading ${files.length} GPX file${files.length > 1 ? "s" : ""}...` });

        const endParse = log.time("GPX parsing");
        const traces: TraceData[] = [];
        for (let i = 0; i < files.length; i++) {
          const text = await files[i].text();
          const trace = parseGpx(text, i);
          // Use filename (without extension) as fallback name
          if (!trace.name) {
            trace.name = files[i].name.replace(/\.gpx$/i, "");
          }
          log.info(`Parsed "${trace.name}": ${trace.original.length} pts → ${trace.simplified.length} simplified, ${(trace.totalDistanceM / 1000).toFixed(1)} km`, {
            name: trace.name,
            originalPoints: trace.original.length,
            simplifiedPoints: trace.simplified.length,
            distanceKm: Math.round(trace.totalDistanceM / 100) / 10,
          });
          traces.push(trace);
        }
        endParse();

        const totalPoints = traces.reduce((sum, t) => sum + t.original.length, 0);
        const totalSimplified = traces.reduce((sum, t) => sum + t.simplified.length, 0);
        const totalKm = traces.reduce((sum, t) => sum + t.totalDistanceM, 0) / 1000;

        update({
          stage: "simplifying",
          traces,
          progress: `Parsed ${totalPoints} points across ${traces.length} trace${traces.length > 1 ? "s" : ""}, simplified to ${totalSimplified}. Total: ${totalKm.toFixed(1)} km`,
        });

        if (ctrl.signal.aborted) return;

        // Stage 2: Query Overpass using simplified points from ALL traces
        const allSimplified = traces.flatMap((t) => t.simplified);

        update({
          stage: "querying",
          progress: `Querying OpenStreetMap for ${selectedCategories.length} categories...`,
          progressRatio: 0,
          warning: null,
        });

        const endQuery = log.time("Overpass querying");
        const queryResult: QueryAllPoisResult = await queryAllPois(
          allSimplified,
          1000,
          selectedCategories,
          (p: QueryProgress) => {
            const retryLabel = p.retryRound > 0 ? ` (retry ${p.retryRound}, ${p.retryingCount} chunks)` : "";
            update({
              progress: `Querying Overpass... (${p.completedChunks}/${p.totalChunks} chunks)${retryLabel}`,
              progressRatio: p.totalChunks > 0 ? p.completedChunks / p.totalChunks : null,
            });
          },
        );
        const rawElements = queryResult.elements;
        endQuery();

        if (ctrl.signal.aborted) return;

        // Stage 3: Process & filter POIs — distance is min over all traces
        update({
          stage: "processing",
          progress: `Processing ${rawElements.length} raw elements...`,
        });

        const endProcess = log.time("POI processing");
        const allTraceSimplified = traces.map((t) => t.simplified);
        const allTraceOriginal = traces.map((t) => t.original);
        rawElementsRef.current = rawElements;
        const pois = processElements(
          rawElements,
          allTraceSimplified,
          routeSettingsRef.current.maxDistanceM,
          50,
          allTraceOriginal,
        );
        endProcess();

        log.info(`Pipeline complete: ${pois.length} POIs from ${rawElements.length} raw elements`, {
          rawElements: rawElements.length,
          filteredPois: pois.length,
          maxDistanceM: routeSettingsRef.current.maxDistanceM,
        });

        if (ctrl.signal.aborted) return;

        // Build warning if some chunks failed
        const chunkWarning = queryResult.failedChunks > 0
          ? `${queryResult.failedChunks}/${queryResult.totalChunks} Overpass chunks failed — results may be incomplete for parts of the route.`
          : null;

        update({
          stage: "done",
          pois,
          progress: `Found ${pois.length} POIs along your route${traces.length > 1 ? "s" : ""}`,
          progressRatio: null,
          warning: chunkWarning,
        });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        const message =
          err instanceof Error ? err.message : "Unknown error occurred";
        log.error(`Pipeline error: ${message}`);
        // Keep traces visible on the map so the user can see what was loaded
        // and retry without re-uploading. Stage goes to "error" but traces persist.
        update({ stage: "error", error: message, progress: "", progressRatio: null });
      }
    },
    [update],
  );

  // -----------------------------------------------------------------------
  // Retry Overpass query after an error (reuses already-parsed traces)
  // -----------------------------------------------------------------------
  const retryQuery = useCallback(async () => {
    const log = dlog("pipeline");
    const currentTraces = (state as AppState).traces;
    if (currentTraces.length === 0) {
      log.warn("retryQuery called but no traces loaded");
      return;
    }

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    const selectedCategories = [...activeCatsRef.current];

    try {
      const allSimplified = currentTraces.flatMap((t) => t.simplified);
      update({
        stage: "querying",
        error: null,
        progress: `Retrying Overpass query for ${selectedCategories.length} categories...`,
        progressRatio: 0,
        warning: null,
      });

      log.info("Retrying Overpass query", { traces: currentTraces.length, simplifiedPoints: allSimplified.length });

      const queryResult: QueryAllPoisResult = await queryAllPois(
        allSimplified,
        1000,
        selectedCategories,
        (p: QueryProgress) => {
          const retryLabel = p.retryRound > 0 ? ` (retry ${p.retryRound}, ${p.retryingCount} chunks)` : "";
          update({
            progress: `Querying Overpass... (${p.completedChunks}/${p.totalChunks} chunks)${retryLabel}`,
            progressRatio: p.totalChunks > 0 ? p.completedChunks / p.totalChunks : null,
          });
        },
      );
      const rawElements = queryResult.elements;

      if (ctrl.signal.aborted) return;

      update({
        stage: "processing",
        progress: `Processing ${rawElements.length} raw elements...`,
      });

      const allTraceSimplified = currentTraces.map((t) => t.simplified);
      const allTraceOriginal = currentTraces.map((t) => t.original);
      rawElementsRef.current = rawElements;
      const pois = processElements(
        rawElements,
        allTraceSimplified,
        routeSettingsRef.current.maxDistanceM,
        50,
        allTraceOriginal,
      );

      if (ctrl.signal.aborted) return;

      // Build warning if some chunks failed
      const chunkWarning = queryResult.failedChunks > 0
        ? `${queryResult.failedChunks}/${queryResult.totalChunks} Overpass chunks failed — results may be incomplete for parts of the route.`
        : null;

      update({
        stage: "done",
        pois,
        progress: `Found ${pois.length} POIs along your route${currentTraces.length > 1 ? "s" : ""}`,
        progressRatio: null,
        warning: chunkWarning,
      });
    } catch (err) {
      if (ctrl.signal.aborted) return;
      const message = err instanceof Error ? err.message : "Unknown error occurred";
      log.error(`Retry failed: ${message}`);
      update({ stage: "error", error: message, progress: "", progressRatio: null });
    }
  }, [state, update]);

  return {
    state,
    filteredPois,
    processFiles,
    retryQuery,
    reset,
    restoreState,
    toggleCategory,
    setAllCategories,
    setMaxDistance,
  };
}
