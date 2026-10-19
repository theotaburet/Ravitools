// CategoryFilter component test
// Focus: checkbox toggle, family toggles, all/none, hours filters, and the 150ms distance-slider debounce.
// State is injected/observed through a jotai store.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CategoryFilter } from "../components/CategoryFilter";
import { POI_CATEGORIES } from "../lib/poi-config";
import { activeCategoriesAtom, hoursFiltersAtom, routeSettingsAtom } from "../state/route";
import type { PoiCategory } from "../types";

afterEach(cleanup);

const essentialFirst = POI_CATEGORIES.filter((c) => c.defaultEnabled !== false)[0].category;

function renderFilter(maxDistanceM = 500, active: PoiCategory[] = []) {
  const store = createStore();
  store.set(activeCategoriesAtom, new Set<PoiCategory>(active));
  store.set(routeSettingsAtom, { maxDistanceM });
  return {
    store,
    ...render(
      <Provider store={store}>
        <CategoryFilter />
      </Provider>,
    ),
  };
}

describe("CategoryFilter", () => {
  it("toggles the category in state when a checkbox is clicked", () => {
    const { store } = renderFilter();
    fireEvent.click(screen.getByRole("checkbox", { name: new RegExp(`^${essentialFirst}`) }));
    expect(store.get(activeCategoriesAtom).has(essentialFirst)).toBe(true);
  });

  it("turns an hours filter on and off", () => {
    const { store } = renderFilter();
    const sunday = screen.getByRole("checkbox", { name: "Open Sunday" });
    fireEvent.click(sunday);
    expect([...store.get(hoursFiltersAtom)]).toEqual(["sunday"]);
    fireEvent.click(sunday);
    expect(store.get(hoursFiltersAtom).size).toBe(0);
  });

  it("selects every category when nothing is selected yet", () => {
    const { store } = renderFilter();
    fireEvent.click(screen.getByRole("button", { name: "All" }));
    expect(store.get(activeCategoriesAtom).size).toBe(POI_CATEGORIES.length);
  });

  it("clears every category in one tap while any is on", () => {
    const { store } = renderFilter(500, ["Food shop"]);
    fireEvent.click(screen.getByRole("button", { name: "None" }));
    expect(store.get(activeCategoriesAtom).size).toBe(0);
  });

  it("turns a whole family on, then off, from its toggle", () => {
    const { store } = renderFilter();
    const water = screen.getByRole("button", { name: "Water" });
    expect(water.getAttribute("aria-pressed")).toBe("false");

    fireEvent.click(water);
    expect([...store.get(activeCategoriesAtom)].sort()).toEqual(["Restroom", "Water"]);
    expect(water.getAttribute("aria-pressed")).toBe("true");

    fireEvent.click(water);
    expect(store.get(activeCategoriesAtom).size).toBe(0);
  });

  it("shows a family partly on as mixed, and a tap turns all of it on", () => {
    const { store } = renderFilter(500, ["Water", "Food shop"]);
    const water = screen.getByRole("button", { name: "Water" });
    expect(water.getAttribute("aria-pressed")).toBe("mixed");

    fireEvent.click(water);
    expect([...store.get(activeCategoriesAtom)].sort()).toEqual(["Food shop", "Restroom", "Water"]);
  });

  it("debounces the distance slider: display updates now, commit fires after 150ms", () => {
    vi.useFakeTimers();
    try {
      const { store } = renderFilter(500);
      const slider = screen.getByRole("slider");

      fireEvent.change(slider, { target: { value: "1200" } });

      expect(screen.getByText("1200 m")).toBeTruthy(); // immediate display
      expect(store.get(routeSettingsAtom).maxDistanceM).toBe(500); // not yet committed

      vi.advanceTimersByTime(150);
      expect(store.get(routeSettingsAtom).maxDistanceM).toBe(1200);
    } finally {
      vi.useRealTimers();
    }
  });
});
