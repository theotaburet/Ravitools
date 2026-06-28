// ---------------------------------------------------------------------------
// CategoryFilter component test (M3 key component tests)
// Focus: checkbox toggle, select-all, and the 150ms distance-slider debounce.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { CategoryFilter } from "../components/CategoryFilter";
import { POI_CATEGORIES } from "../lib/poi-config";
import type { PoiCategory } from "../types";

afterEach(cleanup);

const essentialFirst = POI_CATEGORIES.filter((c) => c.defaultEnabled !== false)[0].category;

function renderFilter(over: Partial<React.ComponentProps<typeof CategoryFilter>> = {}) {
  const props = {
    activeCategories: new Set<PoiCategory>(),
    onToggle: vi.fn(),
    onSelectAll: vi.fn(),
    maxDistanceM: 500,
    onMaxDistanceChange: vi.fn(),
    pois: [],
    ...over,
  };
  return { props, ...render(<CategoryFilter {...props} />) };
}

describe("CategoryFilter", () => {
  it("calls onToggle with the category when a checkbox is clicked", () => {
    const { props } = renderFilter();
    fireEvent.click(screen.getAllByRole("checkbox")[0]);
    expect(props.onToggle).toHaveBeenCalledWith(essentialFirst);
  });

  it("calls onSelectAll(true) when nothing is selected yet", () => {
    const { props } = renderFilter();
    fireEvent.click(screen.getByRole("button"));
    expect(props.onSelectAll).toHaveBeenCalledWith(true);
  });

  it("debounces the distance slider: display updates now, commit fires after 150ms", () => {
    vi.useFakeTimers();
    try {
      const { props } = renderFilter({ maxDistanceM: 500 });
      const slider = screen.getByRole("slider");

      fireEvent.change(slider, { target: { value: "1200" } });

      expect(screen.getByText("1200m")).toBeTruthy(); // immediate display
      expect(props.onMaxDistanceChange).not.toHaveBeenCalled(); // not yet committed

      vi.advanceTimersByTime(150);
      expect(props.onMaxDistanceChange).toHaveBeenCalledWith(1200);
    } finally {
      vi.useRealTimers();
    }
  });
});
