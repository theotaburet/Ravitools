// ---------------------------------------------------------------------------
// CategoryFilter component test (M3 key component tests)
// Focus: checkbox toggle, select-all, and the 150ms distance-slider debounce.
// State is injected/observed through a jotai store.
// ---------------------------------------------------------------------------

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CategoryFilter } from "../components/CategoryFilter";
import { POI_CATEGORIES } from "../lib/poi-config";
import { activeCategoriesAtom, routeSettingsAtom } from "../state/route";
import type { PoiCategory } from "../types";

afterEach(cleanup);

const essentialFirst = POI_CATEGORIES.filter((c) => c.defaultEnabled !== false)[0].category;

function renderFilter(maxDistanceM = 500) {
  const store = createStore();
  store.set(activeCategoriesAtom, new Set<PoiCategory>());
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
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(store.get(activeCategoriesAtom).has(essentialFirst)).toBe(true);
  });

  it("selects every category when nothing is selected yet", () => {
    const { store } = renderFilter();
    // R34/R43: the collapse toggle is now also a button — target the All/None one
    fireEvent.click(screen.getByRole("button", { name: /all/i }));
    expect(store.get(activeCategoriesAtom).size).toBe(POI_CATEGORIES.length);
  });

  it("debounces the distance slider: display updates now, commit fires after 150ms", () => {
    vi.useFakeTimers();
    try {
      const { store } = renderFilter(500);
      const slider = screen.getByRole("slider");

      fireEvent.change(slider, { target: { value: "1200" } });

      expect(screen.getByText("1200m")).toBeTruthy(); // immediate display
      expect(store.get(routeSettingsAtom).maxDistanceM).toBe(500); // not yet committed

      vi.advanceTimersByTime(150);
      expect(store.get(routeSettingsAtom).maxDistanceM).toBe(1200);
    } finally {
      vi.useRealTimers();
    }
  });
});
