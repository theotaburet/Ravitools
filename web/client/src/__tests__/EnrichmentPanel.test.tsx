// ---------------------------------------------------------------------------
// EnrichmentPanel component test (M3 key component tests)
// Focus: the stage state machine drives which block renders + the searxng gate.
// Asserts on stable structure (classNames) rather than translatable copy.
// ---------------------------------------------------------------------------

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { EnrichmentPanel } from "../components/EnrichmentPanel";
import type { EnrichedData, EnrichmentJobState } from "../types";

afterEach(cleanup);

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

function renderPanel(over: Partial<React.ComponentProps<typeof EnrichmentPanel>> = {}) {
  const props: React.ComponentProps<typeof EnrichmentPanel> = {
    job: makeJob(),
    poiCount: 5,
    enrichedCount: 0,
    pendingCount: 5,
    enrichments: new Map<string, EnrichedData>(),
    targetLanguage: "en",
    onLanguageChange: vi.fn(),
    enrichAll: false,
    onEnrichAllChange: vi.fn(),
    onStart: vi.fn(),
    onContinue: vi.fn(),
    onCancel: vi.fn(),
    onResumeAfterCaptcha: vi.fn(),
    ...over,
  };
  return render(<EnrichmentPanel {...props} />);
}

describe("EnrichmentPanel", () => {
  it("renders nothing when there are no POIs", () => {
    const { container } = renderPanel({ poiCount: 0 });
    expect(container.firstChild).toBeNull();
  });

  it("idle: enables the start button when SearXNG is available", () => {
    const { container } = renderPanel({ job: makeJob({ stage: "idle", searxngAvailable: true }) });
    const start = container.querySelector(".neo-btn-primary.w-full") as HTMLButtonElement;
    expect(start).toBeTruthy();
    expect(start.disabled).toBe(false);
  });

  it("idle: disables the start button when SearXNG is unavailable", () => {
    const { container } = renderPanel({ job: makeJob({ stage: "idle", searxngAvailable: false }) });
    const start = container.querySelector(".neo-btn-primary.w-full") as HTMLButtonElement;
    expect(start.disabled).toBe(true);
  });

  it("loading-model: shows a progress bar", () => {
    const { container } = renderPanel({
      job: makeJob({ stage: "loading-model", modelLoadProgress: 0.4 }),
    });
    expect(container.querySelector(".progress-bar-fill")).toBeTruthy();
  });

  it("shows the scraper-blocked hint when a scrape was blocked", () => {
    const { container, getByText } = renderPanel({
      job: makeJob({
        stage: "running",
        total: 5,
        googleFallbackStats: {
          counts: { queued: 0, running: 0, done: 0, error: 1, blocked: 1 },
          jobs: [],
        },
      }),
    });
    // Red-bordered notice carrying the blocked copy
    expect(getByText(/blocked/i)).toBeTruthy();
    expect(container.textContent).toMatch(/blocked/i);
  });
});
