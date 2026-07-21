// ---------------------------------------------------------------------------
// Roadbook smoke test — renders one section per trace with the POI table.
// The paper output is checked by eye (spec).
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { Roadbook } from "../components/Roadbook";
import { activeCategoriesAtom, poisAtom, tracesAtom } from "../state/route";
import type { POI, PoiCategory, TraceData } from "../types";

afterEach(cleanup);

const trace: TraceData = {
  id: "trace_1",
  original: [
    { lat: 45.0, lon: 5, ele: 100 },
    { lat: 45.01, lon: 5, ele: 200 },
  ],
  simplified: [{ lat: 45.0, lon: 5 }],
  totalDistanceM: 1112,
  elevationGainM: 100,
  elevationLossM: 0,
  name: "Col du Test",
  color: "#1a1a1a",
};

const poi: POI = {
  id: "a",
  lat: 45.005,
  lon: 5,
  category: "Water",
  name: "Fontaine du col",
  icon: "faucet-drip",
  distanceToTrace: 10,
  alongTraceDistance: 500,
  tags: { opening_hours: "Mo-Su 08:00-19:00" },
  style: {
    iconShape: "circle",
    borderColor: "#FFFFFF",
    borderWidth: "2",
    textColor: "#FFFFFF",
    backgroundColor: "#3B82F6",
  },
};

describe("Roadbook", () => {
  it("renders the trace header, profile and POI table", () => {
    const store = createStore();
    store.set(tracesAtom, [trace]);
    store.set(poisAtom, [poi]);
    store.set(activeCategoriesAtom, new Set(["Water"] as PoiCategory[]));

    render(
      <Provider store={store}>
        <Roadbook onClose={() => {}} />
      </Provider>,
    );

    expect(screen.getByText(/Col du Test/)).toBeTruthy();
    expect(screen.getByText("Fontaine du col")).toBeTruthy();
    expect(screen.getByText(/08:00-19:00/)).toBeTruthy();
    expect(screen.getByText("0.5")).toBeTruthy();
  });
});
