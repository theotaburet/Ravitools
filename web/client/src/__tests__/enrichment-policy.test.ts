// ---------------------------------------------------------------------------
// Enrichment policy & scoring – enrichability, retryability, confidence
// (split from enrichment.test.ts)
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { getEnrichabilityPolicy } from "../lib/poi-config";
import type { PoiCategory } from "../types";

// ---------------------------------------------------------------------------
// Enrichability policy
// ---------------------------------------------------------------------------

describe("enrichability policy", () => {
  it("maps all 18 categories to a policy", () => {
    const allCategories: PoiCategory[] = [
      "Water",
      "Sleeping place",
      "Restroom",
      "Shelter",
      "Food shop",
      "Restaurant or Bar",
      "Gears",
      "DIY",
      "Laundry",
      "Medical",
      "Bank & ATM",
      "Post office",
      "Viewpoint",
      "Tourist info",
      "Charging",
      "Picnic",
      "Pharmacy",
      "Wifi",
    ];
    for (const cat of allCategories) {
      const policy = getEnrichabilityPolicy(cat);
      expect(["full", "minimal", "skip"]).toContain(policy);
    }
  });

  it("marks high-value categories as full", () => {
    expect(getEnrichabilityPolicy("Restaurant or Bar")).toBe("full");
    expect(getEnrichabilityPolicy("Food shop")).toBe("full");
    expect(getEnrichabilityPolicy("Sleeping place")).toBe("full");
    expect(getEnrichabilityPolicy("Gears")).toBe("full");
  });

  it("marks low-value categories as skip", () => {
    expect(getEnrichabilityPolicy("Water")).toBe("skip");
    expect(getEnrichabilityPolicy("Restroom")).toBe("skip");
    expect(getEnrichabilityPolicy("Shelter")).toBe("skip");
    expect(getEnrichabilityPolicy("Picnic")).toBe("skip");
  });

  it("marks moderate categories as minimal", () => {
    expect(getEnrichabilityPolicy("DIY")).toBe("minimal");
    expect(getEnrichabilityPolicy("Medical")).toBe("minimal");
    expect(getEnrichabilityPolicy("Laundry")).toBe("minimal");
    expect(getEnrichabilityPolicy("Bank & ATM")).toBe("minimal");
  });
});

// ---------------------------------------------------------------------------
// Enricher skip reason in EnrichedData
// ---------------------------------------------------------------------------

describe("EnrichedData skipReason field", () => {
  it("skipReason type accepts all defined reasons", () => {
    // This is a compile-time check; if it compiles, the type works
    const reasons: import("../types").SkipReason[] = [
      "unnamed",
      "low-value-category",
      "no-results",
      "rate-limited",
      "cancelled",
    ];
    expect(reasons).toHaveLength(5);
  });

  it("enrichment with skip reason has correct structure", () => {
    const data: import("../types").EnrichedData = {
      rating: null,
      reviewCount: null,
      hours: null,
      openingHours: null,
      description: null,
      review: null,
      priceLevel: null,
      googleMapsUrl: "https://maps.google.com",
      sourceUrls: [],
      rawSnippets: [],
      enrichedAt: "2026-04-13T00:00:00Z",
      status: "skipped",
      skipReason: "low-value-category",
      locality: null,
      sourceCount: 0,
      sourceEngines: [],
      confidence: 0,
    };
    expect(data.status).toBe("skipped");
    expect(data.skipReason).toBe("low-value-category");
  });
});

describe("isRetryableEnrichmentResult", () => {
  it("returns true for missing enrichment", async () => {
    const { isRetryableEnrichmentResult } = await import("../lib/enrichment/enricher");
    expect(isRetryableEnrichmentResult(undefined)).toBe(true);
  });

  it("returns true for error enrichments", async () => {
    const { isRetryableEnrichmentResult } = await import("../lib/enrichment/enricher");
    expect(isRetryableEnrichmentResult({ status: "error" })).toBe(true);
  });

  it("returns true for degraded no-results enrichments", async () => {
    const { isRetryableEnrichmentResult } = await import("../lib/enrichment/enricher");
    expect(
      isRetryableEnrichmentResult({
        status: "skipped",
        skipReason: "no-results",
        unresponsiveEngines: [["yandex", "CAPTCHA"]],
      }),
    ).toBe(true);
  });

  it("returns false for stable no-results enrichments", async () => {
    const { isRetryableEnrichmentResult } = await import("../lib/enrichment/enricher");
    expect(
      isRetryableEnrichmentResult({
        status: "skipped",
        skipReason: "no-results",
        unresponsiveEngines: [],
      }),
    ).toBe(false);
  });

  it("returns false for non-retryable skipped enrichments", async () => {
    const { isRetryableEnrichmentResult } = await import("../lib/enrichment/enricher");
    expect(
      isRetryableEnrichmentResult({
        status: "skipped",
        skipReason: "low-value-category",
      }),
    ).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Confidence scoring
// ---------------------------------------------------------------------------

describe("computeConfidence", () => {
  const baseEnrichment = {
    rating: null,
    reviewCount: null,
    hours: null,
    description: null,
    review: null,
  };

  function makeSnippets(count: number, engines: string[] = ["google"]): { engine: string }[] {
    const result: { engine: string }[] = [];
    for (let i = 0; i < count; i++) {
      result.push({ engine: engines[i % engines.length] });
    }
    return result;
  }

  it("returns 0 for no snippets", async () => {
    const { computeConfidence } = await import("../lib/enrichment/enricher");
    expect(computeConfidence({ ...baseEnrichment, rawSnippets: [] })).toBe(0);
  });

  it("returns > 0 for at least one snippet", async () => {
    const { computeConfidence } = await import("../lib/enrichment/enricher");
    const score = computeConfidence({ ...baseEnrichment, rawSnippets: makeSnippets(1) });
    expect(score).toBeGreaterThan(0);
  });

  it("increases with more snippets", async () => {
    const { computeConfidence } = await import("../lib/enrichment/enricher");
    const score1 = computeConfidence({ ...baseEnrichment, rawSnippets: makeSnippets(1) });
    const score3 = computeConfidence({ ...baseEnrichment, rawSnippets: makeSnippets(3) });
    const score5 = computeConfidence({ ...baseEnrichment, rawSnippets: makeSnippets(5) });
    expect(score3).toBeGreaterThan(score1);
    expect(score5).toBeGreaterThan(score3);
  });

  it("increases with engine diversity", async () => {
    const { computeConfidence } = await import("../lib/enrichment/enricher");
    const singleEngine = computeConfidence({
      ...baseEnrichment,
      rawSnippets: makeSnippets(4, ["google"]),
    });
    const multiEngine = computeConfidence({
      ...baseEnrichment,
      rawSnippets: makeSnippets(4, ["google", "bing"]),
    });
    expect(multiEngine).toBeGreaterThan(singleEngine);
  });

  it("increases with structured fields present", async () => {
    const { computeConfidence } = await import("../lib/enrichment/enricher");
    const noFields = computeConfidence({ ...baseEnrichment, rawSnippets: makeSnippets(3) });
    const withFields = computeConfidence({
      rating: 4.2,
      reviewCount: 50,
      hours: "9-17",
      description: "Good place",
      review: "Cafe",
      rawSnippets: makeSnippets(3),
    });
    expect(withFields).toBeGreaterThan(noFields);
  });

  it("never exceeds 1.0", async () => {
    const { computeConfidence } = await import("../lib/enrichment/enricher");
    const maxScore = computeConfidence({
      rating: 4.5,
      reviewCount: 200,
      hours: "24/7",
      description: "Great place",
      review: "Restaurant",
      rawSnippets: makeSnippets(20, ["google", "bing", "duckduckgo"]),
    });
    expect(maxScore).toBeLessThanOrEqual(1.0);
  });

  it("returns a number with at most 2 decimal places", async () => {
    const { computeConfidence } = await import("../lib/enrichment/enricher");
    const score = computeConfidence({ ...baseEnrichment, rawSnippets: makeSnippets(3) });
    expect(score).toBe(Math.round(score * 100) / 100);
  });
});

// ---------------------------------------------------------------------------
// R3: out-of-range JSON-LD rating must be dropped at deterministic ingest
// ---------------------------------------------------------------------------

describe("extractDeterministicRating (R3)", () => {
  it("drops an out-of-range structuredData rating (e.g. 9.2)", async () => {
    const { extractDeterministicRating } = await import("../lib/enrichment/enricher");
    const website = { structuredData: { rating: 9.2 } } as never;
    expect(extractDeterministicRating([], website)).toBeNull();
  });

  it("keeps an in-range structuredData rating", async () => {
    const { extractDeterministicRating } = await import("../lib/enrichment/enricher");
    const website = { structuredData: { rating: 4.6 } } as never;
    expect(extractDeterministicRating([], website)).toBe(4.6);
  });
});

// ---------------------------------------------------------------------------
// R16 (decision): Google fallback poll deadline must cover realistic job
// latency (serial queue + 4-12s pre-page sleep) — 90s, never back to 10s
// ---------------------------------------------------------------------------

describe("Google fallback deadline (R16)", () => {
  it("poll deadline is at least 60s", async () => {
    const { GOOGLE_FALLBACK_TIMEOUT_MS } = await import("../lib/enrichment/enricher");
    expect(GOOGLE_FALLBACK_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });
});
