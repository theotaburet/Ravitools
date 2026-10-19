// TraceSummary: what step 01 produced, one card per trace with its own POI count, which selects it.

// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { TraceSummary } from "../components/TraceSummary";
import { activeCategoriesAtom, poisAtom, tracesAtom } from "../state/route";
import { gapThresholdKmAtom, selectedTraceIdAtom } from "../state/ui";
import type { POI, PoiCategory, TraceData } from "../types";

afterEach(cleanup);

function makeTrace(id: string, lat: number, name?: string): TraceData {
  return {
    id,
    original: [
      { lat, lon: 5, ele: 100 },
      { lat: lat + 0.01, lon: 5, ele: 200 },
    ],
    simplified: [{ lat, lon: 5 }],
    totalDistanceM: 1112,
    elevationGainM: 100,
    elevationLossM: 0,
    name,
    color: "#1a1a1a",
  };
}

const poi: POI = {
  id: "a",
  lat: 45.005,
  lon: 5,
  category: "Water",
  name: "Fontaine du col",
  icon: "faucet-drip",
  distanceToTrace: 10,
  alongTraceDistance: 500,
  traceId: "trace_1",
  tags: {},
};

function renderWith(traces: TraceData[]) {
  const store = createStore();
  store.set(tracesAtom, traces);
  store.set(poisAtom, [poi]);
  store.set(activeCategoriesAtom, new Set(["Water"] as PoiCategory[]));
  return {
    store,
    ...render(
      <Provider store={store}>
        <TraceSummary />
      </Provider>,
    ),
  };
}

describe("TraceSummary", () => {
  it("shows name, distance, elevation gain and POI count for one trace", () => {
    renderWith([makeTrace("trace_1", 45, "Col du Test")]);
    expect(screen.getByText("Col du Test")).toBeTruthy();
    expect(screen.getByText("1.1 KM · 100 M D+ · 1 POI")).toBeTruthy();
  });

  it("selects the trace on the map from its card, and unselects it", () => {
    const { store } = renderWith([
      makeTrace("trace_1", 45, "Col du Test"),
      makeTrace("trace_2", 46),
    ]);
    const card = screen.getByRole("button", { name: /Col du Test/ });
    fireEvent.click(card);
    expect(store.get(selectedTraceIdAtom)).toBe("trace_1");
    expect(card.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(card);
    expect(store.get(selectedTraceIdAtom)).toBeNull();
  });

  it("attributes each POI to its nearest trace and falls back to the trace id", () => {
    renderWith([makeTrace("trace_1", 45, "Col du Test"), makeTrace("trace_2", 46)]);
    expect(screen.getByText("trace_2")).toBeTruthy();
    const rows = screen.getAllByRole("listitem");
    expect(rows[0].textContent).toMatch(/1 POI/);
    expect(rows[1].textContent).toMatch(/0 POI/);
  });

  it("warns about stretches without food past the alert threshold, which can be changed", () => {
    const { store } = renderWith([makeTrace("trace_1", 45, "Col du Test")]);
    expect(screen.queryByText(/km without food/)).toBeNull(); // 1.1 km is under the 25 km default

    fireEvent.change(screen.getByRole("spinbutton", { name: /stretch without water or food/ }), {
      target: { value: "1" },
    });
    expect(store.get(gapThresholdKmAtom)).toBe(1);
    expect(screen.getByText("Stretches over 1 km without food: 1")).toBeTruthy();
    expect(screen.queryByText(/km without water/)).toBeNull(); // the fountain sits at 0.5 km
  });

  it("renders nothing without a trace", () => {
    const { container } = renderWith([]);
    expect(container.innerHTML).toBe("");
  });
});
