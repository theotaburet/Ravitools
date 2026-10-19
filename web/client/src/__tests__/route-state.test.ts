// Route state atoms test: pipeline state machine + filtering.
// Mocks the three pure pipeline stages (parse / query / process) so we can
// drive transitions without GPX files, the network, or the DOM.

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
  enrichmentsAtom,
  filteredPoisAtom,
  hoursFiltersAtom,
  lockedTabsAtom,
  poisAtom,
  processFilesAtom,
  ravitoGapsAtom,
  resetRouteAtom,
  restoreRouteAtom,
  retryQueryAtom,
  routeErrorAtom,
  routeSettingsAtom,
  routeWarningAtom,
  setMaxDistanceAtom,
  stageAtom,
  toggleCategoryAtom,
  tracesAtom,
} from "../state/route";
import { activeTabAtom, gapThresholdKmAtom } from "../state/ui";

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

  // A category turned on after loading must have its POIs: they are already fetched
  it("queries every category, not only the active ones", async () => {
    await store.set(processFilesAtom, [gpxFile()]);
    expect(queryAllPois.mock.calls[0][2]).toBeUndefined();
  });

  // The distance slider must never promise POIs the query did not fetch
  it("queries as far as the distance setting reaches", async () => {
    await store.set(processFilesAtom, [gpxFile()]);
    expect(queryAllPois.mock.calls[0][1]).toBeGreaterThanOrEqual(
      store.get(routeSettingsAtom).maxDistanceM,
    );
  });

  it("surfaces a warning when some Overpass chunks fail", async () => {
    queryAllPois.mockResolvedValue({ elements: [], failedChunks: 2, totalChunks: 5 });
    await store.set(processFilesAtom, [gpxFile()]);
    expect(store.get(stageAtom)).toBe("done");
    expect(store.get(routeWarningAtom)).toMatch(/chunks failed/i);
  });

  // Overpass down on the whole route is not "0 POI": say so, keep the retry at hand
  it("turns a run where every chunk failed into an error", async () => {
    queryAllPois.mockResolvedValue({ elements: [], failedChunks: 5, totalChunks: 5 });
    await store.set(processFilesAtom, [gpxFile()]);
    expect(store.get(stageAtom)).toBe("error");
    expect(store.get(routeErrorAtom)).toMatch(/OpenStreetMap/);
    expect(store.get(tracesAtom)).toHaveLength(1);
  });

  // Tab 02 only when there is a list to read; otherwise the message stays in sight on 01
  it.each([
    ["a clean run with POIs", [poi("a", "Water")], 0, "poi"],
    ["0 POI", [], 0, "trace"],
    ["failed chunks", [poi("a", "Water")], 2, "trace"],
  ] as const)("ends %s on the right tab", async (_case, pois, failedChunks, tab) => {
    queryAllPois.mockResolvedValue({ elements: [], failedChunks, totalChunks: 5 });
    processElements.mockReturnValue([...pois]);
    await store.set(processFilesAtom, [gpxFile()]);
    expect(store.get(activeTabAtom)).toBe(tab);
  });

  it("brings an error back to tab 01, where it is shown", async () => {
    store.set(activeTabAtom, "poi");
    queryAllPois.mockRejectedValue(new Error("overpass down"));
    await store.set(processFilesAtom, [gpxFile()]);
    expect(store.get(activeTabAtom)).toBe("trace");
  });

  // "Add a GPX" (tab 01): the loaded traces stay, POIs come again for all of them
  it("appends traces and queries them all", async () => {
    await store.set(processFilesAtom, [gpxFile()]);
    await store.set(processFilesAtom, [gpxFile()], true);
    expect(store.get(tracesAtom)).toHaveLength(2);
    expect(parseGpx.mock.calls[1][1]).toBe(1); // the next trace colour
    expect(queryAllPois.mock.calls[1][0]).toHaveLength(2);
    expect(processElements.mock.calls[1][1]).toHaveLength(2);
  });

  it("keeps the parsed traces visible when the query errors out", async () => {
    queryAllPois.mockRejectedValue(new Error("overpass down"));
    await store.set(processFilesAtom, [gpxFile()]);
    expect(store.get(stageAtom)).toBe("error");
    expect(store.get(routeErrorAtom)).toBe("overpass down");
    expect(store.get(tracesAtom)).toHaveLength(1); // not re-uploaded to retry
  });

  it("a retry aborts the query in flight", async () => {
    queryAllPois.mockImplementationOnce(() => new Promise(() => {}));
    void store.set(processFilesAtom, [gpxFile()]);
    await vi.waitFor(() => expect(queryAllPois).toHaveBeenCalledTimes(1));

    await store.set(retryQueryAtom);
    expect((queryAllPois.mock.calls[0][4] as AbortSignal).aborted).toBe(true);
    expect(store.get(stageAtom)).toBe("done");
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

  // "Open on Sunday": a fountain without hours stays (on the map, in the export); only what
  // its known hours say closed goes. Enriched hours win over OSM ones
  it("hides the POIs whose known hours say closed on Sunday", () => {
    const withHours = (id: string, category: string, opening_hours?: string): POI =>
      ({ ...poi(id, category), tags: opening_hours ? { opening_hours } : {} }) as POI;
    store.set(restoreRouteAtom, {
      traces: [trace],
      pois: [
        withHours("open", "Food shop", "Mo-Su 08:00-19:00"),
        withHours("closed", "Food shop", "Mo-Sa 08:00-19:00; Su off"),
        withHours("fountain", "Water"),
      ],
      activeCategories: new Set(["Food shop", "Water"]) as Set<POI["category"]>,
      routeSettings: { maxDistanceM: 1500 },
    });
    store.set(hoursFiltersAtom, new Set(["sunday"] as const));
    expect(store.get(filteredPoisAtom).map((p) => p.id)).toEqual(["open", "fountain"]);

    store.set(
      enrichmentsAtom,
      new Map([["open", { hours: "Mo-Sa 08:00-19:00, Su closed" } as never]]),
    );
    expect(store.get(filteredPoisAtom).map((p) => p.id)).toEqual(["fountain"]);
  });
});

// Enrich and Export have nothing to work on without POIs

describe("tabs that need POIs", () => {
  it("are locked until the pipeline is done with POIs", async () => {
    expect(store.get(lockedTabsAtom)).toEqual(["enrich", "export"]);
    await store.set(processFilesAtom, [gpxFile()]);
    expect(store.get(lockedTabsAtom)).toEqual([]);
  });

  it("are locked while a run is in flight", async () => {
    queryAllPois.mockImplementationOnce(() => new Promise(() => {}));
    void store.set(processFilesAtom, [gpxFile()]);
    await vi.waitFor(() => expect(queryAllPois).toHaveBeenCalledTimes(1));
    expect(store.get(lockedTabsAtom)).toEqual(["enrich", "export"]);
  });

  it("are locked when no POI passes the filters", async () => {
    await store.set(processFilesAtom, [gpxFile()]);
    store.set(toggleCategoryAtom, "Water" as POI["category"]);
    expect(store.get(lockedTabsAtom)).toEqual(["enrich", "export"]);
  });
});

// The distance slider must keep working after a session restore
// (no raw Overpass elements: refilter from the restored POI superset)

describe("setMaxDistance after restore", () => {
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

describe("stretches without water or food", () => {
  it("are found per trace from every POI, whatever the filters", () => {
    const store = createStore();
    const along = (id: string, category: string, m: number): POI =>
      ({ ...poi(id, category), traceId: "t1", alongTraceDistance: m }) as POI;
    store.set(tracesAtom, [{ ...trace, id: "t1", totalDistanceM: 10_000 }]);
    store.set(poisAtom, [along("w", "Water", 2000), along("f", "Food shop", 9000)]);
    store.set(toggleCategoryAtom, "Water"); // hidden from the list, still water on the road
    store.set(gapThresholdKmAtom, 5);

    expect(store.get(ravitoGapsAtom).get("t1")).toEqual({
      water: [{ startM: 2000, endM: 10_000 }],
      food: [{ startM: 0, endM: 9000 }],
    });
  });
});
