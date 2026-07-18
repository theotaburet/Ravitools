// ---------------------------------------------------------------------------
// EnrichmentPanel component test (M3 key component tests)
// Focus: the stage state machine drives which block renders + the searxng gate.
// Asserts on stable structure (classNames) rather than translatable copy.
// State is injected through a jotai store (job atom + POIs for poiCount).
// ---------------------------------------------------------------------------

import { cleanup, render } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnrichmentPanel } from "../components/EnrichmentPanel";
import { enrichmentJobAtom } from "../state/enrichment";
import { activeCategoriesAtom, poisAtom } from "../state/route";
import type { EnrichmentJobState, POI, PoiCategory } from "../types";

afterEach(cleanup);
beforeEach(() => {
  // The panel's mount effect fetches /api/health — keep it quiet and stable.
  globalThis.fetch = vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ services: { searxng: "ok" } }),
  }) as unknown as typeof fetch;
});

function makeJob(over: Partial<EnrichmentJobState> = {}): EnrichmentJobState {
  return {
    stage: "idle",
    total: 0,
    completed: 0,
    errorCount: 0,
    skippedCount: 0,
    currentPoiName: null,
    currentPoiId: null,
    activePoiIds: new Set<string>(),
    modelLoadProgress: 0,
    webGpuAvailable: true,
    searxngAvailable: true,
    targetLanguage: "en",
    error: null,
    phase: "idle",
    etaSeconds: null,
    ...over,
  };
}

const poi = (id: string): POI =>
  ({ id, category: "Water", name: id, distanceToTrace: 10 }) as unknown as POI;

function renderPanel(job: Partial<EnrichmentJobState> = {}, poiCount = 5) {
  const store = createStore();
  store.set(enrichmentJobAtom, makeJob(job));
  store.set(
    poisAtom,
    Array.from({ length: poiCount }, (_, i) => poi(`p${i}`)),
  );
  store.set(activeCategoriesAtom, new Set<PoiCategory>(["Water" as PoiCategory]));
  return render(
    <Provider store={store}>
      <EnrichmentPanel />
    </Provider>,
  );
}

describe("EnrichmentPanel", () => {
  it("renders nothing when there are no POIs", () => {
    const { container } = renderPanel({}, 0);
    expect(container.firstChild).toBeNull();
  });

  it("idle: enables the start button when SearXNG is available", () => {
    const { container } = renderPanel({ stage: "idle", searxngAvailable: true });
    const start = container.querySelector(".neo-btn-primary.w-full") as HTMLButtonElement;
    expect(start).toBeTruthy();
    expect(start.disabled).toBe(false);
  });

  it("idle: disables the start button when SearXNG is unavailable", () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      json: () => Promise.resolve({ services: { searxng: "error" } }),
    }) as unknown as typeof fetch;
    const { container } = renderPanel({ stage: "idle", searxngAvailable: false });
    const start = container.querySelector(".neo-btn-primary.w-full") as HTMLButtonElement;
    expect(start.disabled).toBe(true);
  });

  it("loading-model: shows a progress bar", () => {
    const { container } = renderPanel({ stage: "loading-model", modelLoadProgress: 0.4 });
    expect(container.querySelector(".progress-bar-fill")).toBeTruthy();
  });

  it("shows the scraper-blocked hint when a scrape was blocked", () => {
    const { container, getByText } = renderPanel({
      stage: "running",
      total: 5,
      googleFallbackStats: {
        counts: { queued: 0, running: 0, done: 0, error: 1, blocked: 1 },
        jobs: [],
      },
    });
    // Red-bordered notice carrying the blocked copy
    expect(getByText(/blocked/i)).toBeTruthy();
    expect(container.textContent).toMatch(/blocked/i);
  });
});
