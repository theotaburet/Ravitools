// @vitest-environment jsdom
// --- POI detail: opens on the selected POI, walks the filtered list in route order, goes back ---

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { PoiDetail } from "../components/PoiDetail";
import { activeCategoriesAtom, poisAtom } from "../state/route";
import { selectedPoiIdAtom } from "../state/ui";
import type { PoiCategory } from "../types";
import { makePoi } from "./enrichment-helpers";

afterEach(cleanup);

// In route order, as the pipeline leaves them; the shop is filtered out
const POIS = [
  makePoi({
    id: "a",
    name: "Fontaine",
    category: "Water",
    alongTraceDistance: 1000,
    distanceToTrace: 40,
  }),
  makePoi({ id: "b", name: "Épicerie", category: "Food shop", alongTraceDistance: 3000 }),
  makePoi({ id: "c", name: "Source", category: "Water", alongTraceDistance: 5000 }),
];

function renderDetail(selected: string | null) {
  const store = createStore();
  store.set(poisAtom, POIS);
  store.set(activeCategoriesAtom, new Set<PoiCategory>(["Water"]));
  store.set(selectedPoiIdAtom, selected);
  return {
    store,
    ...render(
      <Provider store={store}>
        <PoiDetail />
      </Provider>,
    ),
  };
}

describe("PoiDetail", () => {
  it("renders nothing while no POI is selected", () => {
    const { container } = renderDetail(null);
    expect(container.textContent).toBe("");
  });

  it("opens on the selected POI with its heading focused and its place on the route", () => {
    renderDetail("a");
    const heading = screen.getByRole("heading", { name: "Fontaine" });
    expect(document.activeElement).toBe(heading);
    expect(screen.getByText(/KM 1\.0 · 40 M/)).toBeTruthy();
    expect(screen.getByText("1 / 2")).toBeTruthy();
  });

  it("walks the filtered list in route order with the next and previous buttons", () => {
    const { store } = renderDetail("a");
    const prev = screen.getByRole("button", { name: "Previous POI" });
    const next = screen.getByRole("button", { name: "Next POI" });
    expect(prev).toHaveProperty("disabled", true);

    fireEvent.click(next); // skips the filtered-out shop
    expect(store.get(selectedPoiIdAtom)).toBe("c");
    expect(next).toHaveProperty("disabled", true);

    fireEvent.click(prev);
    expect(store.get(selectedPoiIdAtom)).toBe("a");
  });

  it("goes back to the list by clearing the selection", () => {
    const { store } = renderDetail("c");
    fireEvent.click(screen.getByRole("button", { name: /List/ }));
    expect(store.get(selectedPoiIdAtom)).toBeNull();
  });
});
