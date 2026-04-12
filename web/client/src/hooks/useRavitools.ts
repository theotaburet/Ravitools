// ---------------------------------------------------------------------------
// useRavitools – main application hook
// Orchestrates the full pipeline: upload → parse → simplify → query → process
// ---------------------------------------------------------------------------

import { useState, useCallback, useRef } from "react";
import type { AppState, POI, PoiCategory, TraceData } from "../types";
import { parseGpx } from "../lib/gpx-parser";
import { queryAllPois } from "../lib/overpass";
import { processElements } from "../lib/poi-processor";
import { ALL_CATEGORIES, DEFAULT_CATEGORIES } from "../lib/poi-config";

const INITIAL_STATE: AppState = {
  stage: "idle",
  trace: null,
  pois: [],
  activeCategories: new Set(DEFAULT_CATEGORIES),
  error: null,
  progress: "",
};

export function useRavitools() {
  const [state, setState] = useState<AppState>(INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);
  // Keep a ref to activeCategories so processFile always reads the latest value
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
  // Main pipeline
  // -----------------------------------------------------------------------
  const processFile = useCallback(
    async (file: File) => {
      abortRef.current?.abort();
      const ctrl = new AbortController();
      abortRef.current = ctrl;

      // Snapshot active categories at the moment of upload
      const selectedCategories = [...activeCatsRef.current];

      try {
        // Stage 1: Parse GPX
        update({ stage: "parsing", error: null, progress: "Reading GPX file..." });
        const text = await file.text();
        const trace = parseGpx(text);
        update({
          stage: "simplifying",
          trace,
          progress: `Parsed ${trace.original.length} points, simplified to ${trace.simplified.length}. Total: ${(trace.totalDistanceM / 1000).toFixed(1)} km`,
        });

        if (ctrl.signal.aborted) return;

        // Stage 2: Query Overpass (only selected categories)
        update({
          stage: "querying",
          progress: `Querying OpenStreetMap for ${selectedCategories.length} categories...`,
        });

        const rawElements = await queryAllPois(
          trace.simplified,
          1000, // 1km corridor
          selectedCategories,
          (done, total) => {
            update({
              progress: `Querying Overpass... (${done + 1}/${total} chunks)`,
            });
          },
        );

        if (ctrl.signal.aborted) return;

        // Stage 3: Process & filter POIs
        update({
          stage: "processing",
          progress: `Processing ${rawElements.length} raw elements...`,
        });

        const pois = processElements(rawElements, trace.simplified, 1500, 50);

        if (ctrl.signal.aborted) return;

        update({
          stage: "done",
          pois,
          progress: `Found ${pois.length} POIs along your route`,
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
    processFile,
    reset,
    toggleCategory,
    setAllCategories,
  };
}
