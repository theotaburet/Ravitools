// ---------------------------------------------------------------------------
// useRavitools hook test (M2/T4): pipeline state machine + filtering.
// Mocks the three pure pipeline stages (parse / query / process) so we can
// drive transitions without GPX files, the network, or the DOM.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { POI, TraceData } from "../types";

const parseGpx = vi.fn();
const queryAllPois = vi.fn();
const processElements = vi.fn();

vi.mock("../lib/gpx-parser", () => ({ parseGpx: (...a: unknown[]) => parseGpx(...a) }));
vi.mock("../lib/overpass", () => ({ queryAllPois: (...a: unknown[]) => queryAllPois(...a) }));
vi.mock("../lib/poi-processor", () => ({ processElements: (...a: unknown[]) => processElements(...a) }));
vi.mock("../lib/debug-log", () => ({
  dlog: () => ({ time: () => () => {}, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

import { useRavitools } from "../hooks/useRavitools";

const trace: TraceData = {
  name: "Route",
  original: [{ lat: 0, lon: 0 }],
  simplified: [{ lat: 0, lon: 0 }],
  totalDistanceM: 1000,
} as unknown as TraceData;

const poi = (id: string, category: string): POI =>
  ({ id, category, name: id, distanceToTrace: 10 }) as unknown as POI;

function gpxFile(): File {
  // jsdom's File has no .text() here; the hook only needs .text() + .name.
  return { name: "route.gpx", text: () => Promise.resolve("<gpx></gpx>") } as unknown as File;
}

beforeEach(() => {
  parseGpx.mockReturnValue({ ...trace });
  queryAllPois.mockResolvedValue({ elements: [{ id: 1 }], failedChunks: 0, totalChunks: 5 });
  processElements.mockReturnValue([poi("a", "Water")]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useRavitools", () => {
  it("runs parse → query → process → done", async () => {
    const { result } = renderHook(() => useRavitools());
    await act(async () => {
      await result.current.processFiles([gpxFile()]);
    });
    expect(result.current.state.stage).toBe("done");
    expect(result.current.state.pois).toHaveLength(1);
    expect(result.current.state.warning).toBeNull();
  });

  it("surfaces a warning when some Overpass chunks fail", async () => {
    queryAllPois.mockResolvedValue({ elements: [], failedChunks: 2, totalChunks: 5 });
    const { result } = renderHook(() => useRavitools());
    await act(async () => {
      await result.current.processFiles([gpxFile()]);
    });
    expect(result.current.state.stage).toBe("done");
    expect(result.current.state.warning).toMatch(/chunks failed/i);
  });

  it("keeps the parsed traces visible when the query errors out", async () => {
    queryAllPois.mockRejectedValue(new Error("overpass down"));
    const { result } = renderHook(() => useRavitools());
    await act(async () => {
      await result.current.processFiles([gpxFile()]);
    });
    expect(result.current.state.stage).toBe("error");
    expect(result.current.state.error).toBe("overpass down");
    expect(result.current.state.traces).toHaveLength(1); // not re-uploaded to retry
  });

  it("re-filters POIs when a category is toggled off", () => {
    const { result } = renderHook(() => useRavitools());
    act(() => {
      result.current.restoreState({
        traces: [trace],
        pois: [poi("a", "Water"), poi("b", "Restaurant or Bar")],
        activeCategories: new Set(["Water", "Restaurant or Bar"]) as Set<POI["category"]>,
        routeSettings: { maxDistanceM: 1500 },
      });
    });
    expect(result.current.filteredPois).toHaveLength(2);

    act(() => result.current.toggleCategory("Water" as POI["category"]));
    expect(result.current.filteredPois.map((p) => p.id)).toEqual(["b"]);
  });
});
