// ---------------------------------------------------------------------------
// useRavitools – main application hook
// Orchestrates the full pipeline: upload → parse → simplify → query → process
// Supports multiple GPX files simultaneously
// ---------------------------------------------------------------------------

import { useState, useCallback, useRef } from "react";
import type { AppState, POI, PoiCategory, TraceData } from "../types";
import { parseGpx } from "../lib/gpx-parser";
import { queryAllPois } from "../lib/overpass";
import { processElements } from "../lib/poi-processor";
import { ALL_CATEGORIES, DEFAULT_CATEGORIES } from "../lib/poi-config";

const INITIAL_STATE: AppState = {
  stage: "idle",
  traces: [],
  pois: [],
  activeCategories: new Set(DEFAULT_CATEGORIES),
  error: null,
  progress: "",
};

export function useRavitools() {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);
  // Keep a ref to activeCategories so processFiles always reads the latest value
  const activeCatsRef = useRef<Set<PoiCategory>>(state.activeCategories);
  activeCatsRef.current = state.activeCategories;

  const update = useCallback(
    (partial: Partial<AppState>) =>
      setState((prev) => ({ ...prev, ...partial })),
    [],
  );

  // Reset
  const reset = useCallback(() => {
    abortRef.current?.abort();
    setState(INITIAL_STATE);
  }, []);

  // Restore state from a saved session
  const restoreState = useCallback(
    (restored: {
      traces: TraceData[];
      pois: POI[];
      activeCategories: Set<PoiCategory>;
    }) => {
      setState((prev) => ({
        ...prev,
        stage: "done" as const,
        traces: restored.traces,
        pois: restored.pois,
        activeCategories: restored.activeCategories,
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

  // Filtered POIs based on active categories
  const filteredPois = state.pois.filter((p) =>
    state.activeCategories.has(p.category),
  );

  // -----------------------------------------------------------------------
  // Main pipeline – processes one or more GPX files
  // -----------------------------------------------------------------------
  const processFiles = useCallback(
    async (files: File[]) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      // Snapshot active categories at the moment of upload
      const selectedCategories = [...activeCatsRef.current];

      try {
        // Stage 1: Parse all GPX files
        update({ stage: "parsing", error: null, progress: `Reading ${files.length} GPX file${files.length > 1 ? "s" : ""}...` });

        const traces: TraceData[] = [];
        for (let i = 0; i < files.length; i++) {
          const text = await files[i].text();
          const trace = parseGpx(text, i);
          // Use filename (without extension) as fallback name
          if (!trace.name) {
            trace.name = files[i].name.replace(/\.gpx$/i, "");
          }
          traces.push(trace);
        }

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
        });

        const rawElements = await queryAllPois(
          allSimplified,
          1000, // 1km corridor
          selectedCategories,
          (done, total) => {
            update({
              progress: `Querying Overpass... (${done + 1}/${total} chunks)`,
            });
          },
        );

        if (ctrl.signal.aborted) return;

        // Stage 3: Process & filter POIs — distance is min over all traces
        update({
          stage: "processing",
          progress: `Processing ${rawElements.length} raw elements...`,
        });

        const allTraceSimplified = traces.map((t) => t.simplified);
        const pois = processElements(rawElements, allTraceSimplified, 1500, 50);

        if (ctrl.signal.aborted) return;

        update({
          stage: "done",
          pois,
          progress: `Found ${pois.length} POIs along your route${traces.length > 1 ? "s" : ""}`,
        });
      } catch (err) {
        if (ctrl.signal.aborted) return;
        const message =
          err instanceof Error ? err.message : "Unknown error occurred";
        update({ stage: "error", error: message, progress: "" });
      }
    },
    [update],
  );

  return {
    state,
    filteredPois,
    processFiles,
    reset,
    restoreState,
    toggleCategory,
    setAllCategories,
  };
}
