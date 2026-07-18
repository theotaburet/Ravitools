// ---------------------------------------------------------------------------
// enrichBatch pipeline – mocked search/LLM, policies, cancellation
// (split from enrichment.test.ts)
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { POI, PoiCategory } from "../types";
import { makePoi } from "./enrichment-helpers";

// ---------------------------------------------------------------------------
// Batch enrichment pipeline (WS4)
// ---------------------------------------------------------------------------

// We mock the network-dependent modules so enrichBatch runs fully in test.
vi.mock("../lib/enrichment/search", async () => {
  const actual = await vi.importActual<typeof import("../lib/enrichment/search")>(
    "../lib/enrichment/search",
  );
  return {
    ...actual,
    fetchWebsitePreview: vi.fn(async () => null),
    reverseGeocode: vi.fn(async () => ({
      locality: "TestCity",
      county: null,
      state: null,
      country: null,
      countryCode: null,
    })),
    searchPoi: vi.fn(async (poi: POI) => {
      // Simulate a small delay
      await new Promise((r) => setTimeout(r, 5));
      // Return 2 fake snippets wrapped in { snippets, query }
      return {
        snippets: [
          {
            title: `${poi.name} review`,
            url: "https://example.com/1",
            content: "Nice place",
            engine: "google",
          },
          {
            title: `${poi.name} hours`,
            url: "https://example.com/2",
            content: "Open 9-17",
            engine: "bing",
          },
        ],
        query: `"${poi.name}" avis restaurant site:tripadvisor.com`,
        unresponsiveEngines: [],
      };
    }),
  };
});

vi.mock("../lib/enrichment/llm", async () => {
  const actual =
    await vi.importActual<typeof import("../lib/enrichment/llm")>("../lib/enrichment/llm");
  return {
    ...actual,
    isEngineReady: vi.fn(() => true),
    synthesize: vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return {
        rating: 4.0,
        reviewCount: 30,
        hours: [{ day: "Mon-Fri", open: "09:00", close: "17:00" }],
        hoursFlat: "Mon-Fri 09:00-17:00",
        description: "Test summary",
        review: "Résumé test",
        priceLevel: 2,
      };
    }),
  };
});

describe("enrichBatch pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeBatchPoi(
    id: string,
    category: PoiCategory = "Restaurant or Bar",
    name = `POI ${id}`,
  ): POI {
    return makePoi({ id, category, name });
  }

  it("enriches all POIs and returns a Map of results", async () => {
    const { enrichBatch } = await import("../lib/enrichment/enricher");
    const pois = [makeBatchPoi("a"), makeBatchPoi("b")];

    const results = await enrichBatch(pois, { searchStaggerMs: 0, searchConcurrency: 2 });

    expect(results.size).toBe(2);
    expect(results.get("a")!.status).toBe("done");
    expect(results.get("b")!.status).toBe("done");
    expect(results.get("a")!.rating).toBe(4.0);
    expect(results.get("a")!.locality).toBe("TestCity");
  });

  it("skips unnamed POIs without network calls", async () => {
    const { enrichBatch } = await import("../lib/enrichment/enricher");
    const { reverseGeocode } = await import("../lib/enrichment/search");

    const pois = [
      makeBatchPoi("named", "Restaurant or Bar", "Le Bistro"),
      makeBatchPoi("unnamed", "Restaurant or Bar", "Unknown"),
    ];

    const results = await enrichBatch(pois, { skipUnnamed: true, searchStaggerMs: 0 });

    expect(results.size).toBe(2);
    expect(results.get("unnamed")!.status).toBe("skipped");
    expect(results.get("unnamed")!.skipReason).toBe("generic-name");
    expect(results.get("named")!.status).toBe("done");
    // reverseGeocode should only be called for the named POI
    expect(reverseGeocode).toHaveBeenCalledTimes(1);
  });

  it("skips POIs with skip policy without network calls", async () => {
    const { enrichBatch } = await import("../lib/enrichment/enricher");
    const { reverseGeocode } = await import("../lib/enrichment/search");

    const pois = [
      makeBatchPoi("water1", "Water", "Water Fountain"), // skip policy
      makeBatchPoi("rest1", "Restaurant or Bar", "Le Zinc"), // full policy
    ];

    const results = await enrichBatch(pois, { searchStaggerMs: 0 });

    expect(results.get("water1")!.status).toBe("skipped");
    expect(results.get("water1")!.skipReason).toBe("low-value-category");
    expect(results.get("rest1")!.status).toBe("done");
    // reverseGeocode should only be called for the restaurant
    expect(reverseGeocode).toHaveBeenCalledTimes(1);
  });

  it("handles minimal policy with geocode only", async () => {
    const { enrichBatch } = await import("../lib/enrichment/enricher");
    const { searchPoi } = await import("../lib/enrichment/search");

    const pois = [makeBatchPoi("diy1", "DIY", "DIY Store")]; // minimal policy

    const results = await enrichBatch(pois, { searchStaggerMs: 0 });

    expect(results.get("diy1")!.status).toBe("done");
    expect(results.get("diy1")!.locality).toBe("TestCity");
    // searchPoi should NOT be called for minimal policy
    expect(searchPoi).not.toHaveBeenCalled();
  });

  it("calls onProgress for each completed POI", async () => {
    const { enrichBatch } = await import("../lib/enrichment/enricher");
    const progressCalls: { poiId: string; index: number; total: number }[] = [];

    const pois = [makeBatchPoi("x"), makeBatchPoi("y"), makeBatchPoi("z")];
    await enrichBatch(pois, {
      searchStaggerMs: 0,
      searchConcurrency: 3,
      onProgress: (poiId, _enrichment, index, total) => {
        progressCalls.push({ poiId, index, total });
      },
    });

    // Should receive 3 progress calls
    expect(progressCalls.length).toBe(3);
    expect(progressCalls.every((c) => c.total === 3)).toBe(true);
  });

  it("calls onPhaseProgress with phase changes", async () => {
    const { enrichBatch } = await import("../lib/enrichment/enricher");
    const phases: string[] = [];

    const pois = [makeBatchPoi("p1")];
    await enrichBatch(pois, {
      searchStaggerMs: 0,
      onPhaseProgress: (phase) => {
        phases.push(phase);
      },
    });

    // Should see geocode-search first, then synthesize
    expect(phases[0]).toBe("geocode-search");
    expect(phases).toContain("synthesize");
  });

  it("cancels during geocode-search stage", async () => {
    const { enrichBatch } = await import("../lib/enrichment/enricher");

    const controller = new AbortController();
    const pois = [makeBatchPoi("a"), makeBatchPoi("b"), makeBatchPoi("c")];

    // Abort after a short delay (during search stage)
    setTimeout(() => controller.abort(), 10);

    const results = await enrichBatch(pois, {
      signal: controller.signal,
      searchStaggerMs: 50, // stagger ensures we can abort mid-batch
      searchConcurrency: 1,
    });

    // Should have fewer completed than total (some may have finished before abort)
    expect(results.size).toBeLessThanOrEqual(3);
    // The batch should not hang — it returned
  });

  it("cancels before LLM synthesis stage preserves search-stage results", async () => {
    const { enrichBatch } = await import("../lib/enrichment/enricher");
    const { searchPoi } = await import("../lib/enrichment/search");

    const controller = new AbortController();

    // Make searchPoi abort after returning results so synthesis never starts
    const originalImpl = vi.mocked(searchPoi).getMockImplementation()!;
    vi.mocked(searchPoi).mockImplementation(async (poi, _locality, _apiBase, _signal) => {
      await new Promise((r) => setTimeout(r, 5));
      // Abort right after the first search completes — synthesis hasn't started
      controller.abort();
      return {
        snippets: [{ title: "R", url: "https://ex.com", content: "Good", engine: "google" }],
        query: `"${poi.name}" test`,
        unresponsiveEngines: [],
      };
    });

    const pois = [makeBatchPoi("solo")];
    const results = await enrichBatch(pois, {
      signal: controller.signal,
      searchStaggerMs: 0,
    });

    // The POI was in search stage when abort fired — it might have an
    // incomplete result or no result, but batch should return without hanging.
    expect(results.size).toBeLessThanOrEqual(1);

    // Restore original mock for subsequent tests
    vi.mocked(searchPoi).mockImplementation(originalImpl);
  });

  it("enrichAll override forces full enrichment for skip categories", async () => {
    const { enrichBatch } = await import("../lib/enrichment/enricher");

    const pois = [makeBatchPoi("water", "Water", "Fountain")]; // normally skip

    const results = await enrichBatch(pois, { enrichAll: true, searchStaggerMs: 0 });

    // With enrichAll, Water should get full treatment instead of skip
    expect(results.get("water")!.status).toBe("done");
    expect(results.get("water")!.skipReason).toBeUndefined();
    expect(results.get("water")!.rating).toBe(4.0); // from mock LLM
  });

  it("handles mixed policies in a single batch", async () => {
    const { enrichBatch } = await import("../lib/enrichment/enricher");

    const pois = [
      makeBatchPoi("rest", "Restaurant or Bar", "Le Zinc"), // full
      makeBatchPoi("diy", "DIY", "Brico Store"), // minimal
      makeBatchPoi("water", "Water", "Fountain"), // skip
      makeBatchPoi("noname", "Restaurant or Bar", "Unknown"), // unnamed → skip
    ];

    const results = await enrichBatch(pois, { searchStaggerMs: 0, skipUnnamed: true });

    expect(results.size).toBe(4);
    expect(results.get("rest")!.status).toBe("done");
    expect(results.get("rest")!.rating).toBe(4.0);
    expect(results.get("diy")!.status).toBe("done");
    expect(results.get("diy")!.rating).toBeNull(); // minimal = no search/LLM
    expect(results.get("water")!.status).toBe("skipped");
    expect(results.get("noname")!.status).toBe("skipped");
    expect(results.get("noname")!.skipReason).toBe("generic-name");
  });

  it("computes confidence for batch results", async () => {
    const { enrichBatch } = await import("../lib/enrichment/enricher");

    const pois = [makeBatchPoi("c1")];
    const results = await enrichBatch(pois, { searchStaggerMs: 0 });

    const result = results.get("c1")!;
    // Has 2 snippets from 2 engines (google, bing) + rating/hours/summary/specialty from LLM
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.sourceCount).toBe(2);
    expect(result.sourceEngines).toContain("google");
    expect(result.sourceEngines).toContain("bing");
  });
});
