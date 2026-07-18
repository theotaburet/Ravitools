// ---------------------------------------------------------------------------
// Route state atoms test (M2/T4): pipeline state machine + filtering.
// Mocks the three pure pipeline stages (parse / query / process) so we can
// drive transitions without GPX files, the network, or the DOM.
// ---------------------------------------------------------------------------

import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { POI, TraceData } from "../types";

const parseGpx = vi.fn();
const queryAllPois = vi.fn();
const processElements = vi.fn();

vi.mock("../lib/gpx-parser", () => ({ parseGpx: (...a: unknown[]) => parseGpx(...a) }));
vi.mock("../lib/overpass", () => ({ queryAllPois: (...a: unknown[]) => queryAllPois(...a) }));
vi.mock("../lib/poi-processor", () => ({
  processElements: (...a: unknown[]) => processElements(...a),
}));
vi.mock("../lib/debug-log", () => ({
  dlog: () => ({
    time: () => () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}));

import {
  filteredPoisAtom,
  poisAtom,
  processFilesAtom,
  resetRouteAtom,
  restoreRouteAtom,
  routeErrorAtom,
  routeWarningAtom,
  setMaxDistanceAtom,
  stageAtom,
  toggleCategoryAtom,
  tracesAtom,
} from "../state/route";

const trace: TraceData = {
  name: "Route",
  original: [{ lat: 0, lon: 0 }],
  simplified: [{ lat: 0, lon: 0 }],
  totalDistanceM: 1000,
} as unknown as TraceData;

const poi = (id: string, category: string): POI =>
  ({ id, category, name: id, distanceToTrace: 10 }) as unknown as POI;

function gpxFile(): File {
  // jsdom's File has no .text() here; the pipeline only needs .text() + .name.
  return { name: "route.gpx", text: () => Promise.resolve("<gpx></gpx>") } as unknown as File;
}

let store: ReturnType<typeof createStore>;

beforeEach(() => {
  vi.clearAllMocks();
  parseGpx.mockReturnValue({ ...trace });
  queryAllPois.mockResolvedValue({ elements: [{ id: 1 }], failedChunks: 0, totalChunks: 5 });
  processElements.mockReturnValue([poi("a", "Water")]);
  store = createStore();
  // Clear module-level pipeline context (rawElements / restoredPois)
  store.set(resetRouteAtom);
});

describe("route state pipeline", () => {
  it("runs parse → query → process → done", async () => {
    await store.set(processFilesAtom, [gpxFile()]);
    expect(store.get(stageAtom)).toBe("done");
    expect(store.get(poisAtom)).toHaveLength(1);
    expect(store.get(routeWarningAtom)).toBeNull();
  });

  it("surfaces a warning when some Overpass chunks fail", async () => {
    queryAllPois.mockResolvedValue({ elements: [], failedChunks: 2, totalChunks: 5 });
    await store.set(processFilesAtom, [gpxFile()]);
    expect(store.get(stageAtom)).toBe("done");
    expect(store.get(routeWarningAtom)).toMatch(/chunks failed/i);
  });

  it("keeps the parsed traces visible when the query errors out", async () => {
    queryAllPois.mockRejectedValue(new Error("overpass down"));
    await store.set(processFilesAtom, [gpxFile()]);
    expect(store.get(stageAtom)).toBe("error");
    expect(store.get(routeErrorAtom)).toBe("overpass down");
    expect(store.get(tracesAtom)).toHaveLength(1); // not re-uploaded to retry
  });

  it("re-filters POIs when a category is toggled off", () => {
    store.set(restoreRouteAtom, {
      traces: [trace],
      pois: [poi("a", "Water"), poi("b", "Restaurant or Bar")],
      activeCategories: new Set(["Water", "Restaurant or Bar"]) as Set<POI["category"]>,
      routeSettings: { maxDistanceM: 1500 },
    });
    expect(store.get(filteredPoisAtom)).toHaveLength(2);

    store.set(toggleCategoryAtom, "Water" as POI["category"]);
    expect(store.get(filteredPoisAtom).map((p) => p.id)).toEqual(["b"]);
  });
});

// ---------------------------------------------------------------------------
// R19: the distance slider must keep working after a session restore
// (no raw Overpass elements — refilter from the restored POI superset)
// ---------------------------------------------------------------------------

describe("setMaxDistance after restore (R19)", () => {
  it("re-filters restored POIs when the slider moves", () => {
    const near = { ...poi("near", "Water"), distanceToTrace: 100 } as POI;
    const far = { ...poi("far", "Water"), distanceToTrace: 900 } as POI;
    store.set(restoreRouteAtom, {
      traces: [trace],
      pois: [near, far],
      activeCategories: new Set(["Water"]) as Set<POI["category"]>,
      routeSettings: { maxDistanceM: 1000 },
    });

    store.set(setMaxDistanceAtom, 200);
    expect(store.get(poisAtom).map((p) => p.id)).toEqual(["near"]);

    // back up within the restored radius: the far POI reappears
    store.set(setMaxDistanceAtom, 1000);
    expect(store.get(poisAtom)).toHaveLength(2);
  });
});
