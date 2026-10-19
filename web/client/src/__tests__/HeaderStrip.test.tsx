// @vitest-environment jsdom
// --- Header strip: the counter of the selected trace, and the profile that centres the map ---

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { HeaderStrip } from "../components/HeaderStrip";
import { activeCategoriesAtom, poisAtom, tracesAtom } from "../state/route";
import { mapCenterAtom, selectedTraceIdAtom } from "../state/ui";
import type { PoiCategory, TraceData } from "../types";
import { makePoi } from "./enrichment-helpers";

afterEach(cleanup);

function makeTrace(id: string, totalDistanceM: number, elevationGainM: number, ele = true) {
  return {
    id,
    // ~1.1 km between points, up then down
    original: [
      { lat: 45, lon: 5, ele: ele ? 100 : undefined },
      { lat: 45.01, lon: 5, ele: ele ? 300 : undefined },
      { lat: 45.02, lon: 5, ele: ele ? 150 : undefined },
    ],
    simplified: [],
    totalDistanceM,
    elevationGainM,
    elevationLossM: 0,
    color: "#000",
  } as unknown as TraceData;
}

function renderStrip(traces: TraceData[]) {
  const store = createStore();
  store.set(tracesAtom, traces);
  store.set(poisAtom, [
    makePoi({ id: "a", category: "Water", traceId: "t1" }),
    makePoi({ id: "b", category: "Water", traceId: "t1" }),
    makePoi({ id: "c", category: "Water", traceId: "t2" }),
    makePoi({ id: "d", category: "Food shop", traceId: "t1" }), // filtered out
  ]);
  store.set(activeCategoriesAtom, new Set<PoiCategory>(["Water"]));
  return {
    store,
    ...render(
      <Provider store={store}>
        <HeaderStrip />
      </Provider>,
    ),
  };
}

const cell = (label: string) => screen.getByText(label).nextElementSibling?.textContent;

describe("HeaderStrip", () => {
  it("counts the first trace until another one is selected", () => {
    const { store } = renderStrip([makeTrace("t1", 12_345, 640), makeTrace("t2", 180_400, 2100)]);
    expect([cell("KM"), cell("D+"), cell("POI")]).toEqual(["12.3", "640", "2"]);

    act(() => store.set(selectedTraceIdAtom, "t2"));
    // Past 100 km the tenth is noise and costs width
    expect([cell("KM"), cell("D+"), cell("POI")]).toEqual(["180", "2100", "1"]);
  });

  it("centres the map on the kilometre picked on the profile", () => {
    const { store } = renderStrip([makeTrace("t1", 2224, 200)]);
    fireEvent.change(screen.getByRole("slider", { name: /Centre the map/ }), {
      target: { value: "1100" },
    });
    const centre = store.get(mapCenterAtom);
    expect(centre?.lon).toBe(5);
    expect(centre?.lat).toBeCloseTo(45.0099, 3);
  });

  it("keeps the counter for a trace without elevation, with no profile", () => {
    renderStrip([makeTrace("t1", 2224, 0, false)]);
    expect(cell("KM")).toBe("2.2");
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("renders nothing before a trace is loaded", () => {
    const { container } = renderStrip([]);
    expect(container.textContent).toBe("");
  });
});
