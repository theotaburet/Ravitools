// EnrichmentPanel component test
// Focus: the stage state machine drives which block renders + the searxng gate.
// Asserts on stable structure (classNames) rather than translatable copy.
// State is injected through a jotai store (job atom + POIs for poiCount).

import { cleanup, render } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { EnrichmentPanel } from "../components/EnrichmentPanel";
import type { LlmCapability } from "../lib/enrichment/capability";
import { enrichmentJobAtom, enrichmentsAtom, llmCapabilityAtom } from "../state/enrichment";
import { activeCategoriesAtom, poisAtom } from "../state/route";
import { selectedPoiIdAtom } from "../state/ui";
import type { EnrichedData, EnrichmentJobState, POI, PoiCategory } from "../types";

afterEach(cleanup);
beforeEach(() => {
  // The panel's mount effect fetches /api/health: keep it quiet and stable.
  globalThis.fetch = vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ services: { searxng: "ok" } }),
  }) as unknown as typeof fetch;
});

function makeJob(over: Partial<EnrichmentJobState> = {}): EnrichmentJobState {
  return {
    stage: "idle",
    total: 0,
    completed: 0,
    searched: 0,
    currentPoiName: null,
    currentPoiId: null,
    activePoiIds: new Set<string>(),
    modelLoadProgress: 0,
    llmActive: true,
    searxngAvailable: true,
    error: null,
    phase: "idle",
    etaSeconds: null,
    ...over,
  };
}

const poi = (id: string): POI =>
  ({
    id,
    category: "Water",
    name: id,
    distanceToTrace: 10,
    alongTraceDistance: 12_300,
    traceId: "trace_1",
  }) as unknown as POI;

function renderPanel(
  job: Partial<EnrichmentJobState> = {},
  poiCount = 5,
  cap: LlmCapability | null = null,
  enrichments: Record<string, Partial<EnrichedData>> = {},
) {
  const store = createStore();
  store.set(enrichmentJobAtom, makeJob(job));
  store.set(llmCapabilityAtom, cap);
  store.set(enrichmentsAtom, new Map(Object.entries(enrichments) as [string, EnrichedData][]));
  store.set(
    poisAtom,
    Array.from({ length: poiCount }, (_, i) => poi(`p${i}`)),
  );
  store.set(activeCategoriesAtom, new Set<PoiCategory>(["Water" as PoiCategory]));
  return {
    store,
    ...render(
      <Provider store={store}>
        <EnrichmentPanel />
      </Provider>,
    ),
  };
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

  it("warns when Google Maps changed its layout and hours could not be read", () => {
    const { container } = renderPanel({
      stage: "running",
      total: 5,
      googleFallbackStats: {
        counts: { queued: 0, running: 0, done: 3, error: 0, layoutIssues: 2 },
        jobs: [],
      },
    });
    expect(container.querySelector(".notice-danger")?.textContent).toMatch(/layout/i);
  });

  it("running: counts searched POIs while searching, finished ones while synthesizing", () => {
    const searching = renderPanel({
      stage: "running",
      phase: "geocode-search",
      total: 165,
      completed: 0,
      searched: 71,
    });
    expect(searching.container.textContent).toContain("71/165");
    cleanup();
    const synthesizing = renderPanel({
      stage: "running",
      phase: "synthesize",
      total: 165,
      completed: 94,
      searched: 165,
    });
    expect(synthesizing.container.textContent).toContain("94/165");
  });

  it("keeps the AI check to its verdict, the notes behind a closed 'see more'", () => {
    const { container } = renderPanel({}, 5, { level: "ready", reasons: [], modelSizeMb: 2500 });
    const more = container.querySelector<HTMLDetailsElement>(".llm-check details");
    expect(more?.open).toBe(false);
    expect(more?.textContent).toContain("2.5 GB");
    expect(more?.textContent).toMatch(/can be wrong/);
  });

  it("done: one bar in three zones, the skipped breakdown one click away", () => {
    const { container } = renderPanel({ stage: "done" }, 4, null, {
      p0: { status: "done" },
      p1: { status: "skipped", skipReason: "generic-name" },
      p2: { status: "error" },
    });
    const zones = [...container.querySelectorAll<HTMLElement>(".tally-bar > span")];
    // done and skipped fill the bar; what remains is the empty track
    expect(zones.map((z) => z.style.width)).toEqual(["25%", "25%"]);
    const tally = container.querySelector<HTMLDetailsElement>("details.tally");
    expect(tally?.open).toBe(false);
    expect(tally?.querySelector("summary")?.textContent).toMatch(
      /1 POIs enriched.*1 skipped.*2 remaining \(1 error\)/,
    );
    expect(tally?.querySelector(".tally-reasons")?.textContent).toContain("Generic name");
  });

  it("lists every skipped POI with what it was judged on, and shows it on the map on click", () => {
    const { container, store } = renderPanel({ stage: "done" }, 3, null, {
      p0: { status: "skipped", skipReason: "generic-name" },
      p1: { status: "skipped", skipReason: "no-results", searchQuery: '"p1" Lyon opening hours' },
    });
    const rows = [...container.querySelectorAll<HTMLButtonElement>(".tally-reasons button")];
    expect(rows.map((row) => row.textContent)).toEqual([
      expect.stringMatching(/p0.*Water.*km 12\.3/),
      expect.stringContaining('"p1" Lyon opening hours'),
    ]);
    rows[1].click();
    expect(store.get(selectedPoiIdAtom)).toBe("p1");
  });
});
