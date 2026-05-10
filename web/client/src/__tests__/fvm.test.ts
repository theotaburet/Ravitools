// ---------------------------------------------------------------------------
// Feature Validation Matrix (FVM) tests – sections A through N
// Baseline tests on existing code before enrichment-graal changes.
// Only covers items NOT already tested in existing test files.
// ---------------------------------------------------------------------------
// @vitest-environment jsdom

import { describe, it, expect } from "vitest";
import type { POI, EnrichedData, SearchSnippet, EnrichmentStructuredContent } from "../types";
import { ENRICHMENT_LENGTH_TARGETS, ENRICHMENT_DISPLAY_ORDER } from "../types";
import {
  classifySourcePlatform,
  getOfficialWebsiteUrl,
  buildSearchQuery,
  isRejectedOfficialDomain,
  isOfficialDomainSnippet,
  normalizeUrlForDedup,
  cleanPoiNameForSearch,
} from "../lib/enrichment/search";
import { buildStructuredContent, buildEssentialsText, buildDivergences, determineSourceConfirmation } from "../lib/enrichment/structured";
import { parseLlmOutput, buildSystemPrompt } from "../lib/enrichment/llm";
import { computeConfidence, isGenericPoiName } from "../lib/enrichment/enricher";
import {
  ENRICHMENT_CONTRACTS,
  getEnrichmentContract,
  getEnrichabilityPolicy,
} from "../lib/poi-config";
import { buildGpxString, buildKmlString, buildGeoJsonObject } from "../lib/export";

// ---------------------------------------------------------------------------
// Shared POI factory
// ---------------------------------------------------------------------------

function makePoi(overrides: Partial<POI> = {}): POI {
  return {
    id: "fvm-poi-1",
    lat: 45.7640,
    lon: 4.8357,
    category: "Restaurant or Bar",
    name: "Chez Marcel",
    icon: "utensils",
    distanceToTrace: 200,
    alongTraceDistance: 12000,
    tags: { amenity: "restaurant", cuisine: "french" },
    style: {
      iconShape: "circle",
      borderColor: "#FFFFFF",
      borderWidth: "2",
      textColor: "#FFFFFF",
      backgroundColor: "#FF6B35",
    },
    ...overrides,
  };
}

function makeSnippets(count: number, opts?: Partial<SearchSnippet>): SearchSnippet[] {
  return Array.from({ length: count }, (_, i) => ({
    title: opts?.title ?? `Result ${i}`,
    url: opts?.url ?? `https://example-${i}.com`,
    content: opts?.content ?? `Content for result ${i}`,
    engine: opts?.engine ?? ["google", "bing", "duckduckgo"][i % 3],
    ...opts,
  }));
}

function makeBaseEnrichment(overrides: Partial<EnrichedData> = {}): EnrichedData {
  return {
    rating: null,
    reviewCount: null,
    hours: null,
    openingHours: null,
    description: null,
    review: null,
    summary: null,
    translatedSummary: null,
    specialty: null,
    priceLevel: null,
    googleMapsUrl: "https://www.google.com/maps/search/test",
    sourceUrls: [],
    rawSnippets: [],
    enrichedAt: "2026-04-13T00:00:00Z",
    status: "done",
    locality: null,
    sourceCount: 0,
    sourceEngines: [],
    confidence: 0,
    ...overrides,
  };
}

// ===========================================================================
// A. Source Discovery
// ===========================================================================

describe("FVM-A: Source Discovery", () => {
  it("A1: Restaurant query includes review and hours context keywords", () => {
    const poi = makePoi({ category: "Restaurant or Bar" });
    const query = buildSearchQuery(poi, "Lyon");
    expect(query).toContain("avis");
    expect(query).toContain("restaurant");
    expect(query).toContain("horaires");
    expect(query).toContain("Lyon");
  });

  it("A2: Food shop query includes resupply-relevant terms", () => {
    const poi = makePoi({
      category: "Food shop",
      name: "Carrefour Contact",
      tags: { shop: "supermarket" },
    });
    const query = buildSearchQuery(poi, "Valence");
    expect(query).toContain('"Carrefour Contact"');
    expect(query).toContain("Valence");
    // Should contain food shop context keywords
    expect(query).toContain("horaires");
    expect(query).toContain("magasin");
    expect(query).toContain("avis");
  });

  it("A3: Sleeping place query includes accommodation context", () => {
    const poi = makePoi({
      category: "Sleeping place",
      name: "Camping du Lac",
      tags: { tourism: "camp_site" },
    });
    const query = buildSearchQuery(poi, null);
    expect(query).toContain("avis");
    expect(query).toContain("hébergement");
    expect(query).toContain("tarif");
  });

  it("A4: Gears query uses POI name for bike shop search", () => {
    const poi = makePoi({
      category: "Gears",
      name: "Cycles Dupont",
      tags: { shop: "bicycle" },
    });
    const query = buildSearchQuery(poi, "Grenoble");
    expect(query).toContain('"Cycles Dupont"');
    expect(query).toContain("Grenoble");
  });

  it("A5: unnamed POI uses tag-based fallback", () => {
    const poi = makePoi({
      name: "",
      tags: { amenity: "restaurant" },
    });
    const query = buildSearchQuery(poi, null);
    expect(query).toContain("restaurant");
    expect(query).not.toContain('""'); // no empty quoted name
  });

  it("A5b: 'Unknown' named POI uses tag-based fallback", () => {
    const poi = makePoi({
      name: "Unknown",
      tags: { shop: "bicycle" },
    });
    const query = buildSearchQuery(poi, null);
    expect(query).toContain("bicycle");
  });

  it("A5c: non-Sleeping place does NOT include booking platforms", () => {
    const poi = makePoi({
      category: "Restaurant or Bar",
      name: "Le Comptoir",
    });
    const query = buildSearchQuery(poi, null);
    expect(query).not.toContain("booking OR");
  });
});

// ===========================================================================
// B. Source Parsing And Classification
// ===========================================================================

describe("FVM-B: Source Parsing And Classification", () => {
  it("B1: classifies Google Maps URL", () => {
    expect(classifySourcePlatform("https://www.google.com/maps/place/test")).toBe("google_maps");
    expect(classifySourcePlatform("https://maps.google.fr/maps?q=test")).toBe("google_maps");
  });

  it("B2: classifies Yelp URL", () => {
    expect(classifySourcePlatform("https://www.yelp.com/biz/chez-marcel")).toBe("yelp");
    expect(classifySourcePlatform("https://www.yelp.fr/biz/test")).toBe("yelp");
  });

  it("B3: classifies TripAdvisor URL", () => {
    expect(classifySourcePlatform("https://www.tripadvisor.com/Restaurant-test")).toBe("tripadvisor");
    expect(classifySourcePlatform("https://www.tripadvisor.fr/Hotel-test")).toBe("tripadvisor");
  });

  it("B4: classifies Facebook URL", () => {
    expect(classifySourcePlatform("https://www.facebook.com/chezmarcel")).toBe("facebook");
    expect(classifySourcePlatform("https://m.facebook.com/pages/test")).toBe("facebook");
  });

  it("B5: classifies Instagram URL", () => {
    expect(classifySourcePlatform("https://www.instagram.com/chezmarcel/")).toBe("instagram");
  });

  it("B6: classifies Booking.com URL", () => {
    expect(classifySourcePlatform("https://www.booking.com/hotel/fr/test.html")).toBe("booking");
  });

  it("B7: classifies Hotels.com URL", () => {
    expect(classifySourcePlatform("https://www.hotels.com/ho12345")).toBe("hotels_com");
    expect(classifySourcePlatform("https://fr.hotels.com/test")).toBe("hotels_com");
  });

  it("B8: classifies unknown domains as 'other'", () => {
    expect(classifySourcePlatform("https://www.pagesjaunes.fr/test")).toBe("other");
    expect(classifySourcePlatform("https://random-blog.com/review")).toBe("other");
    expect(classifySourcePlatform("https://en.wikipedia.org/wiki/test")).toBe("other");
  });

  it("B8b: handles malformed URLs gracefully", () => {
    expect(classifySourcePlatform("not-a-url")).toBe("other");
    expect(classifySourcePlatform("")).toBe("other");
  });
});

// ===========================================================================
// C. Official Website
// ===========================================================================

describe("FVM-C: Official Website", () => {
  it("C1: detects website tag", () => {
    const poi = makePoi({ tags: { amenity: "restaurant", website: "https://chez-marcel.fr" } });
    expect(getOfficialWebsiteUrl(poi)).toBe("https://chez-marcel.fr");
  });

  it("C2: detects contact:website tag", () => {
    const poi = makePoi({ tags: { amenity: "restaurant", "contact:website": "https://chez-marcel.fr" } });
    expect(getOfficialWebsiteUrl(poi)).toBe("https://chez-marcel.fr");
  });

  it("C3: normalizes bare domain without scheme", () => {
    const poi = makePoi({ tags: { amenity: "restaurant", website: "chez-marcel.fr" } });
    expect(getOfficialWebsiteUrl(poi)).toBe("https://chez-marcel.fr");
  });

  it("C3b: normalizes domain with path", () => {
    const poi = makePoi({ tags: { amenity: "restaurant", website: "chez-marcel.fr/menu" } });
    expect(getOfficialWebsiteUrl(poi)).toBe("https://chez-marcel.fr/menu");
  });

  it("C3c: preserves http:// URLs as-is", () => {
    const poi = makePoi({ tags: { amenity: "restaurant", website: "http://old-site.com" } });
    expect(getOfficialWebsiteUrl(poi)).toBe("http://old-site.com");
  });

  it("C4: returns null when no website tag exists", () => {
    const poi = makePoi({ tags: { amenity: "restaurant" } });
    expect(getOfficialWebsiteUrl(poi)).toBeNull();
  });

  it("C4b: returns null for empty website tag", () => {
    const poi = makePoi({ tags: { amenity: "restaurant", website: "" } });
    expect(getOfficialWebsiteUrl(poi)).toBeNull();
  });

  it("C4c: returns null for whitespace-only website tag", () => {
    const poi = makePoi({ tags: { amenity: "restaurant", website: "   " } });
    expect(getOfficialWebsiteUrl(poi)).toBeNull();
  });

  it("C7: official website enriches sourceRollup when present", () => {
    const poi = makePoi();
    const enrichment = { rating: null, reviewCount: null, hours: null, specialty: null, summary: null, translatedSummary: null, priceLevel: null, locality: null };
    const websitePreview = {
      url: "https://chez-marcel.fr",
      finalUrl: "https://chez-marcel.fr",
      title: "Chez Marcel - Restaurant Lyon",
      description: "Fine French dining in Lyon since 1952",
      excerpt: null,
      fetchedAt: "2026-04-13T00:00:00Z",
    };
    const structured = buildStructuredContent(poi, enrichment, [], websitePreview, "fr");
    const officialDigest = structured.sourceRollup.find((d) => d.platform === "official_website");
    expect(officialDigest).toBeDefined();
    expect(officialDigest!.brief).toContain("Fine French dining");
  });

  it("C8: official website does not clobber review platform sources", () => {
    const poi = makePoi();
    const enrichment = { rating: 4.2, reviewCount: 50, hours: "12-14, 19-22", specialty: "French", summary: "Great", translatedSummary: null, priceLevel: 2, locality: "Lyon" };
    const snippets: SearchSnippet[] = [
      { title: "Google review", url: "https://www.google.com/maps/place/chez-marcel", content: "Excellent restaurant", engine: "google" },
      { title: "TripAdvisor", url: "https://www.tripadvisor.fr/restaurant/chez-marcel", content: "Very good", engine: "google" },
    ];
    const websitePreview = {
      url: "https://chez-marcel.fr",
      finalUrl: "https://chez-marcel.fr",
      title: "Chez Marcel",
      description: "Our restaurant",
      excerpt: null,
      fetchedAt: "2026-04-13T00:00:00Z",
    };
    const structured = buildStructuredContent(poi, enrichment, snippets, websitePreview, "fr");
    // Should have Google Maps, TripAdvisor, AND official_website — not replace them
    const platforms = structured.sourceRollup.map((d) => d.platform);
    expect(platforms).toContain("google_maps");
    expect(platforms).toContain("tripadvisor");
    expect(platforms).toContain("official_website");
  });
});

// ===========================================================================
// D. Structured Output Core
// ===========================================================================

describe("FVM-D: Structured Output Core", () => {
  const richEnrichment = {
    rating: 4.3,
    reviewCount: 120,
    hours: "Mon-Sat 12:00-14:00, 19:00-22:00",
    specialty: "French bistro",
    summary: "Excellent bistro with cyclist-friendly terrace and generous portions.",
    translatedSummary: "Excellent bistrot avec terrasse accueillante pour les cyclistes.",
    priceLevel: 2,
    locality: "Lyon",
  };

  const snippets: SearchSnippet[] = [
    { title: "Google Review", url: "https://www.google.com/maps/place/test", content: "Great food and service", engine: "google" },
    { title: "TripAdvisor", url: "https://www.tripadvisor.fr/test", content: "Lovely terrace for cyclists", engine: "bing" },
    { title: "Yelp review", url: "https://www.yelp.fr/biz/test", content: "Good value French bistro", engine: "duckduckgo" },
  ];

  it("D1: produces a headline for a rich case", () => {
    const poi = makePoi();
    const structured = buildStructuredContent(poi, richEnrichment, snippets, null, "fr");
    expect(structured.headline).not.toBeNull();
    expect(structured.headline!.length).toBeGreaterThan(10);
    expect(structured.headline!.length).toBeLessThanOrEqual(ENRICHMENT_LENGTH_TARGETS.headlineList);
  });

  it("D2: produces an operationalSummary for a rich case", () => {
    const poi = makePoi();
    const structured = buildStructuredContent(poi, richEnrichment, snippets, null, "fr");
    expect(structured.operationalSummary).not.toBeNull();
    expect(structured.operationalSummary!.length).toBeGreaterThan(10);
    expect(structured.operationalSummary!.length).toBeLessThanOrEqual(ENRICHMENT_LENGTH_TARGETS.operationalSummary);
  });

  it("D3: produces ordered practicalities", () => {
    const poi = makePoi();
    const structured = buildStructuredContent(poi, richEnrichment, snippets, null, "fr");
    expect(structured.practicalities.length).toBeGreaterThan(0);
    expect(structured.practicalities.length).toBeLessThanOrEqual(ENRICHMENT_LENGTH_TARGETS.practicalitiesMax);
    // Should contain Type and Rating
    expect(structured.practicalities.some((p) => p.includes("French bistro"))).toBe(true);
    expect(structured.practicalities.some((p) => p.includes("4.3"))).toBe(true);
  });

  it("D4: produces cautions when info is missing", () => {
    const poi = makePoi();
    const poorEnrichment = { rating: null, reviewCount: null, hours: null, specialty: null, summary: null, translatedSummary: null, priceLevel: null, locality: null };
    const structured = buildStructuredContent(poi, poorEnrichment, [], null, "en");
    expect(structured.cautions.length).toBeGreaterThan(0);
    expect(structured.cautions.length).toBeLessThanOrEqual(ENRICHMENT_LENGTH_TARGETS.cautionsMax);
  });

  it("D5: produces stable sourceRollup from snippets", () => {
    const poi = makePoi();
    const structured = buildStructuredContent(poi, richEnrichment, snippets, null, "en");
    expect(structured.sourceRollup.length).toBeGreaterThan(0);
    // Each digest has a platform and brief
    for (const digest of structured.sourceRollup) {
      expect(digest.platform).toBeTruthy();
      expect(digest.brief.length).toBeGreaterThan(0);
    }
  });

  it("D6: buildEssentialsText composes from structured", () => {
    const poi = makePoi();
    const structured = buildStructuredContent(poi, richEnrichment, snippets, null, "en");
    const essentials = buildEssentialsText(structured);
    expect(essentials).not.toBeNull();
    expect(essentials!.length).toBeGreaterThan(10);
    expect(essentials!.length).toBeLessThanOrEqual(ENRICHMENT_LENGTH_TARGETS.essentialsExport);
  });

  it("D7: buildEssentialsText remains concise and within limits", () => {
    const structured: EnrichmentStructuredContent = {
      headline: "A".repeat(300),
      operationalSummary: "B".repeat(200),
      practicalities: ["Fact 1", "Fact 2", "Fact 3", "Fact 4", "Fact 5"],
      sourceRollup: [],
      cautions: ["Caution 1", "Caution 2"],
      unknowns: ["Unknown 1"],
      divergences: [],
      sourceConfirmation: "none",
    };
    const essentials = buildEssentialsText(structured);
    expect(essentials).not.toBeNull();
    expect(essentials!.length).toBeLessThanOrEqual(ENRICHMENT_LENGTH_TARGETS.essentialsExport);
  });

  it("D8: unknowns are included in structured output", () => {
    const poi = makePoi();
    // Specialty is null but sources exist -> should trigger an unknown
    const partialEnrichment = { rating: 4.0, reviewCount: 10, hours: "9-17", specialty: null, summary: "Good", translatedSummary: null, priceLevel: null, locality: null };
    const structured = buildStructuredContent(poi, partialEnrichment, snippets, null, "en");
    expect(structured.unknowns.length).toBeGreaterThan(0);
    expect(structured.unknowns.length).toBeLessThanOrEqual(ENRICHMENT_LENGTH_TARGETS.unknownsMax);
  });

  it("D9: empty snippets produce a fallback headline", () => {
    const poi = makePoi();
    const emptyEnrichment = { rating: null, reviewCount: null, hours: null, specialty: null, summary: null, translatedSummary: null, priceLevel: null, locality: null };
    const structured = buildStructuredContent(poi, emptyEnrichment, [], null, "en");
    expect(structured.headline).not.toBeNull();
    // Should be the category-inferred lead
    expect(structured.headline).toContain("Chez Marcel");
    expect(structured.headline).toContain("food stop");
  });
});

// ===========================================================================
// E. Category-Specific Structured Rules (contracts exist)
// ===========================================================================

describe("FVM-E: Category-Specific Contracts", () => {
  it("E1: contracts exist for all 4 full categories", () => {
    expect(getEnrichmentContract("Restaurant or Bar")).not.toBeNull();
    expect(getEnrichmentContract("Food shop")).not.toBeNull();
    expect(getEnrichmentContract("Sleeping place")).not.toBeNull();
    expect(getEnrichmentContract("Gears")).not.toBeNull();
  });

  it("E2: contracts do not exist for non-full categories", () => {
    expect(getEnrichmentContract("Water")).toBeNull();
    expect(getEnrichmentContract("Restroom")).toBeNull();
    expect(getEnrichmentContract("DIY")).toBeNull();
    expect(getEnrichmentContract("Laundry")).toBeNull();
  });

  it("E3: each contract has non-empty priorities", () => {
    for (const [, contract] of Object.entries(ENRICHMENT_CONTRACTS)) {
      if (!contract) continue;
      expect(contract.priorities.length).toBeGreaterThan(0);
    }
  });

  it("E4: each contract has banned patterns", () => {
    for (const [, contract] of Object.entries(ENRICHMENT_CONTRACTS)) {
      if (!contract) continue;
      expect(contract.bannedPatterns.length).toBeGreaterThan(0);
    }
  });

  it("E5: each contract has weak source formulations", () => {
    for (const [, contract] of Object.entries(ENRICHMENT_CONTRACTS)) {
      if (!contract) continue;
      expect(contract.weakSourceFormulations.length).toBeGreaterThan(0);
    }
  });

  it("E6: each contract has silence conditions", () => {
    for (const [, contract] of Object.entries(ENRICHMENT_CONTRACTS)) {
      if (!contract) continue;
      expect(contract.silenceConditions.length).toBeGreaterThan(0);
    }
  });

  it("E7: Sleeping place contract mentions booking-related signals", () => {
    const contract = getEnrichmentContract("Sleeping place")!;
    const allText = [...contract.priorities, ...contract.valuableSignals].join(" ").toLowerCase();
    expect(allText).toContain("booking");
  });

  it("E8: Gears contract mentions repair-related signals", () => {
    const contract = getEnrichmentContract("Gears")!;
    const allText = [...contract.priorities, ...contract.valuableSignals].join(" ").toLowerCase();
    expect(allText).toContain("repair");
  });

  it("E9: Restaurant contract bans marketing language", () => {
    const contract = getEnrichmentContract("Restaurant or Bar")!;
    const bannedText = contract.bannedPatterns.join(" ").toLowerCase();
    expect(bannedText).toContain("marketing");
  });

  it("E10: Food shop contract prioritizes opening hours", () => {
    const contract = getEnrichmentContract("Food shop")!;
    const priorityText = contract.priorities.join(" ").toLowerCase();
    expect(priorityText).toContain("hours");
  });

  it("E11: each full category degrades with no sources (cautions appear)", () => {
    for (const category of ["Restaurant or Bar", "Food shop", "Sleeping place", "Gears"] as const) {
      const poi = makePoi({ category, name: `Test ${category}` });
      const emptyEnrichment = { rating: null, reviewCount: null, hours: null, specialty: null, summary: null, translatedSummary: null, priceLevel: null, locality: null };
      const structured = buildStructuredContent(poi, emptyEnrichment, [], null, "en");
      expect(structured.cautions.length).toBeGreaterThan(0);
    }
  });
});

// ===========================================================================
// F. LLM Output Contract (extends existing parseLlmOutput tests)
// ===========================================================================

describe("FVM-F: LLM Output Contract", () => {
  it("F1: parseLlmOutput accepts full valid JSON with new compact format", () => {
    const input = JSON.stringify({
      rating: 4.5,
      reviewCount: 200,
      hours: [
        { day: "Mon-Sat", open: "9:00", close: "18:00" },
      ],
      description: "Great bike shop with repair service.",
      review: "Cycles Dupont is a reliable bike shop near the route.",
      priceLevel: 3,
    });
    const result = parseLlmOutput(input);
    expect(result).not.toBeNull();
    expect(result!.rating).toBe(4.5);
    expect(result!.hours).toHaveLength(1);
    expect(result!.hoursFlat).toContain("Mon-Sat");
    expect(result!.description).toContain("bike shop");
    expect(result!.review).toContain("Cycles Dupont");
  });

  it("F2: parseLlmOutput strips markdown and extracts JSON", () => {
    const json = JSON.stringify({
      rating: 3.0,
      reviewCount: null,
      hours: null,
      description: "Decent.",
      review: null,
      priceLevel: null,
    });
    const input = "Here is the information:\n```json\n" + json + "\n```\nHope this helps!";
    const result = parseLlmOutput(input);
    expect(result).not.toBeNull();
    expect(result!.rating).toBe(3.0);
    expect(result!.description).toBe("Decent.");
  });

  it("F3: parseLlmOutput rejects completely invalid output", () => {
    expect(parseLlmOutput("I cannot find any information about this place.")).toBeNull();
    expect(parseLlmOutput("")).toBeNull();
    expect(parseLlmOutput("Sorry, I don't have enough data.")).toBeNull();
  });

  it("F4: parseLlmOutput clamps rating to 1-5 range", () => {
    const tooHigh = JSON.stringify({ rating: 10 });
    expect(parseLlmOutput(tooHigh)!.rating).toBeNull();
    const tooLow = JSON.stringify({ rating: 0 });
    expect(parseLlmOutput(tooLow)!.rating).toBeNull();
    const valid = JSON.stringify({ rating: 4.5 });
    expect(parseLlmOutput(valid)!.rating).toBe(4.5);
  });

  it("F5: parseLlmOutput truncates description to 180 chars", () => {
    const longDescription = "X".repeat(400);
    const input = JSON.stringify({
      rating: null,
      reviewCount: null,
      hours: null,
      description: longDescription,
      review: null,
      priceLevel: null,
    });
    const result = parseLlmOutput(input);
    expect(result!.description!.length).toBe(180);
  });

  it("F6: parseLlmOutput truncates review to 180 chars", () => {
    const longReview = "Y".repeat(400);
    const input = JSON.stringify({
      rating: null,
      reviewCount: null,
      hours: null,
      description: null,
      review: longReview,
      priceLevel: null,
    });
    const result = parseLlmOutput(input);
    expect(result!.review!.length).toBe(180);
  });
});

// ===========================================================================
// G. Confidence And Coverage
// ===========================================================================

describe("FVM-G: Confidence And Coverage", () => {
  const baseEnrichment = {
    rating: null,
    reviewCount: null,
    hours: null,
    description: null,
    review: null,
  };

  it("G1: confidence increases with more useful sources (below saturation)", () => {
    // sourceFactor = min(snippets/7, 0.7) — saturates at ~5 snippets (5/7 ≈ 0.71 → capped 0.7)
    const score1 = computeConfidence({ ...baseEnrichment, rawSnippets: makeSnippets(1) });
    const score2 = computeConfidence({ ...baseEnrichment, rawSnippets: makeSnippets(2) });
    const score4 = computeConfidence({ ...baseEnrichment, rawSnippets: makeSnippets(4) });
    expect(score2).toBeGreaterThan(score1);
    expect(score4).toBeGreaterThan(score2);
  });

  it("G1b: confidence saturates beyond snippet cap (monotonic non-decreasing)", () => {
    const score5 = computeConfidence({ ...baseEnrichment, rawSnippets: makeSnippets(5) });
    const score7 = computeConfidence({ ...baseEnrichment, rawSnippets: makeSnippets(7) });
    const score10 = computeConfidence({ ...baseEnrichment, rawSnippets: makeSnippets(10) });
    expect(score7).toBeGreaterThanOrEqual(score5);
    expect(score10).toBeGreaterThanOrEqual(score7);
  });

  it("G2: confidence increases with engine diversity", () => {
    const sameEngine = computeConfidence({
      ...baseEnrichment,
      rawSnippets: Array.from({ length: 4 }, () => ({ engine: "google" })),
    });
    const diverseEngines = computeConfidence({
      ...baseEnrichment,
      rawSnippets: [
        { engine: "google" },
        { engine: "bing" },
        { engine: "duckduckgo" },
        { engine: "brave" },
      ],
    });
    expect(diverseEngines).toBeGreaterThan(sameEngine);
  });

  it("G3: confidence drops without structured fields", () => {
    const withFields = computeConfidence({
      rating: 4.0,
      reviewCount: 50,
      hours: "9-17",
      description: "Good place",
      review: "Cafe review",
      rawSnippets: makeSnippets(3),
    });
    const withoutFields = computeConfidence({
      ...baseEnrichment,
      rawSnippets: makeSnippets(3),
    });
    expect(withFields).toBeGreaterThan(withoutFields);
  });

  it("G4: confidence is exactly 0 without snippets", () => {
    expect(computeConfidence({ ...baseEnrichment, rawSnippets: [] })).toBe(0);
  });

  it("G5: confidence never exceeds 1.0 even with maximum inputs", () => {
    const maxScore = computeConfidence({
      rating: 5.0,
      reviewCount: 1000,
      hours: "24/7",
      description: "Perfect in every way",
      review: "Everything",
      rawSnippets: makeSnippets(20),
    });
    expect(maxScore).toBeLessThanOrEqual(1.0);
    expect(maxScore).toBeGreaterThan(0.5);
  });
});

// ===========================================================================
// H. Contradictions And Missing Data
// ===========================================================================

describe("FVM-H: Contradictions And Missing Data", () => {
  it("H1: missing hours produces explicit caution", () => {
    const poi = makePoi();
    const enrichment = { rating: 4.0, reviewCount: 20, hours: null, specialty: "Bistro", summary: "Good", translatedSummary: null, priceLevel: null, locality: null };
    const snippets = makeSnippets(2);
    const structured = buildStructuredContent(poi, enrichment, snippets, null, "en");
    const hoursCaution = structured.cautions.find((c) => c.toLowerCase().includes("hour"));
    expect(hoursCaution).toBeDefined();
  });

  it("H2: missing rating produces explicit caution", () => {
    const poi = makePoi();
    const enrichment = { rating: null, reviewCount: null, hours: "9-17", specialty: "Cafe", summary: "Decent", translatedSummary: null, priceLevel: null, locality: null };
    const snippets = makeSnippets(2);
    const structured = buildStructuredContent(poi, enrichment, snippets, null, "en");
    const ratingCaution = structured.cautions.find((c) => c.toLowerCase().includes("rating"));
    expect(ratingCaution).toBeDefined();
  });

  it("H3: rating without review count produces a caution", () => {
    const poi = makePoi();
    const enrichment = { rating: 4.5, reviewCount: null, hours: "10-20", specialty: null, summary: "Nice", translatedSummary: null, priceLevel: null, locality: null };
    const snippets = makeSnippets(3);
    const structured = buildStructuredContent(poi, enrichment, snippets, null, "en");
    const volumeCaution = structured.cautions.find((c) => c.toLowerCase().includes("volume") || c.toLowerCase().includes("review"));
    expect(volumeCaution).toBeDefined();
  });

  it("H4: no sourceRollup produces a caution about weak coverage", () => {
    const poi = makePoi();
    const enrichment = { rating: null, reviewCount: null, hours: null, specialty: null, summary: null, translatedSummary: null, priceLevel: null, locality: null };
    const structured = buildStructuredContent(poi, enrichment, [], null, "en");
    // With contract-aware cautions, the first caution uses the category's weak source formulation
    expect(structured.cautions.length).toBeGreaterThan(0);
    const firstCaution = structured.cautions[0].toLowerCase();
    // Should warn about limited coverage, regardless of exact wording
    expect(firstCaution).toMatch(/limited|no identifiable|few reviews|no.*platform/);
  });

  it("H5: no official website does not produce false positive signal", () => {
    const poi = makePoi({ tags: { amenity: "restaurant" } });
    // No website tag => getOfficialWebsiteUrl returns null
    expect(getOfficialWebsiteUrl(poi)).toBeNull();
    // Building structured without website should not mention official_website in rollup
    const enrichment = { rating: null, reviewCount: null, hours: null, specialty: null, summary: null, translatedSummary: null, priceLevel: null, locality: null };
    const structured = buildStructuredContent(poi, enrichment, [], null, "en");
    const officialDigest = structured.sourceRollup.find((d) => d.platform === "official_website");
    expect(officialDigest).toBeUndefined();
  });
});

// ===========================================================================
// I. Pipeline Integration (isGenericPoiName)
// ===========================================================================

describe("FVM-I: Pipeline Integration helpers", () => {
  it("I1: isGenericPoiName detects empty/unnamed", () => {
    expect(isGenericPoiName("")).toBe(true);
    expect(isGenericPoiName(null)).toBe(true);
    expect(isGenericPoiName(undefined)).toBe(true);
    expect(isGenericPoiName("Unknown")).toBe(true);
    expect(isGenericPoiName("unnamed")).toBe(true);
  });

  it("I2: isGenericPoiName detects common generic names", () => {
    expect(isGenericPoiName("Toilets")).toBe(true);
    expect(isGenericPoiName("drinking water")).toBe(true);
    expect(isGenericPoiName("Shelter")).toBe(true);
    expect(isGenericPoiName("Picnic")).toBe(true);
    expect(isGenericPoiName("WC")).toBe(true);
  });

  it("I3: isGenericPoiName detects French generic names", () => {
    expect(isGenericPoiName("toilettes")).toBe(true);
    expect(isGenericPoiName("eau potable")).toBe(true);
    expect(isGenericPoiName("fontaine")).toBe(true);
    expect(isGenericPoiName("abri")).toBe(true);
  });

  it("I4: isGenericPoiName accepts real business names", () => {
    expect(isGenericPoiName("Le Petit Zinc")).toBe(false);
    expect(isGenericPoiName("Carrefour Contact")).toBe(false);
    expect(isGenericPoiName("Camping du Lac")).toBe(false);
    expect(isGenericPoiName("Cycles Dupont")).toBe(false);
  });

  it("I5: enrichability policy is skip for skip categories", () => {
    expect(getEnrichabilityPolicy("Water")).toBe("skip");
    expect(getEnrichabilityPolicy("Restroom")).toBe("skip");
    expect(getEnrichabilityPolicy("Shelter")).toBe("skip");
    expect(getEnrichabilityPolicy("Picnic")).toBe("skip");
  });

  it("I6: enrichability policy is full for full categories", () => {
    expect(getEnrichabilityPolicy("Restaurant or Bar")).toBe("full");
    expect(getEnrichabilityPolicy("Food shop")).toBe("full");
    expect(getEnrichabilityPolicy("Sleeping place")).toBe("full");
    expect(getEnrichabilityPolicy("Gears")).toBe("full");
  });
});

// ===========================================================================
// K. Export Validation
// ===========================================================================

describe("FVM-K: Export Validation", () => {
  const enrichedStructured: EnrichmentStructuredContent = {
    headline: "Excellent bistro with cyclist-friendly terrace.",
    operationalSummary: "Best read as French bistro. Hours available. Reputation signals present.",
    practicalities: ["Type: French bistro", "Reported rating: 4.3/5 (120 reviews)", "Hours: Mon-Sat 12-14, 19-22"],
    sourceRollup: [
      { platform: "google_maps", brief: "Google Maps: Well-reviewed bistro", url: "https://google.com/maps/test" },
      { platform: "tripadvisor", brief: "Tripadvisor: Great terrace", url: "https://tripadvisor.fr/test" },
    ],
    cautions: ["Price information could not be confirmed."],
    unknowns: ["Bike parking availability unclear."],
    divergences: [],
    sourceConfirmation: "both",
  };

  const enrichment = makeBaseEnrichment({
    rating: 4.3,
    reviewCount: 120,
    hours: "Mon-Sat 12:00-14:00, 19:00-22:00",
    description: "Excellent bistro with cyclist-friendly terrace, French cuisine.",
    review: "Well-reviewed bistro with great terrace, popular with cyclists.",
    summary: "Great bistro for cyclists.",
    translatedSummary: null,
    specialty: "French bistro",
    priceLevel: 2,
    locality: "Lyon",
    sourceCount: 3,
    sourceEngines: ["google", "bing"],
    confidence: 0.65,
    essentials: "Excellent bistro with cyclist-friendly terrace.",
    structured: enrichedStructured,
  });

  const poi = makePoi();
  const enrichments = new Map([["fvm-poi-1", enrichment]]);

  it("K1: GPX includes description", () => {
    const gpx = buildGpxString([poi], [], enrichments);
    expect(gpx).toContain("Excellent bistro with cyclist-friendly terrace");
  });

  it("K2: GPX no longer includes review (compact format moves it to KML)", () => {
    const gpx = buildGpxString([poi], [], enrichments);
    // review is intentionally dropped from the compact GPX <desc> to fit small screens.
    expect(gpx).not.toContain("Well-reviewed bistro with great terrace");
  });

  it("K3: GPX includes rating and price (compact star format)", () => {
    const gpx = buildGpxString([poi], [], enrichments);
    // Compact format: "★4.3" instead of "4.3/5"
    expect(gpx).toContain("★4.3");
    expect(gpx).toContain("$$");
  });

  it("K4: GPX includes structured.cautions", () => {
    const gpx = buildGpxString([poi], [], enrichments);
    expect(gpx).toContain("Price information could not be confirmed.");
  });

  it("K5: GPX no longer includes sourceRollup (compact format moves it to KML)", () => {
    const gpx = buildGpxString([poi], [], enrichments);
    // sourceRollup is intentionally dropped from compact GPX. It remains in KML <description>.
    expect(gpx).not.toContain("google_maps");
  });

  it("K5b: GPX no longer includes unknowns (compact format)", () => {
    const gpx = buildGpxString([poi], [], enrichments);
    // unknowns are no longer rendered in the compact export
    expect(gpx).not.toContain("Bike parking availability unclear.");
  });

  it("K6: KML includes compact structured fields", () => {
    const kml = buildKmlString([poi], [], enrichments);
    expect(kml).toContain("Excellent bistro with cyclist-friendly terrace");
    expect(kml).toContain("Well-reviewed bistro with great terrace");
    expect(kml).toContain("Price information could not be confirmed.");
    expect(kml).toContain("4.3/5");
  });

  it("K7: GeoJSON exposes enrichment_essentials", () => {
    const geojson = buildGeoJsonObject([poi], enrichments);
    const props = geojson.features[0].properties!;
    expect(props.enrichment_essentials).toBe("Excellent bistro with cyclist-friendly terrace.");
  });

  it("K8: GeoJSON exposes enrichment_structured_headline", () => {
    const geojson = buildGeoJsonObject([poi], enrichments);
    const props = geojson.features[0].properties!;
    expect(props.enrichment_structured_headline).toBe("Excellent bistro with cyclist-friendly terrace.");
  });

  it("K9: GeoJSON exposes enrichment_structured_operationalSummary", () => {
    const geojson = buildGeoJsonObject([poi], enrichments);
    const props = geojson.features[0].properties!;
    expect(props.enrichment_structured_operationalSummary).toContain("Best read as French bistro");
  });

  it("K10: GeoJSON exposes enrichment_structured_practicalities", () => {
    const geojson = buildGeoJsonObject([poi], enrichments);
    const props = geojson.features[0].properties!;
    expect(props.enrichment_structured_practicalities).toContain("French bistro");
    expect(props.enrichment_structured_practicalities).toContain("4.3");
  });

  it("K11: GeoJSON exposes enrichment_structured_cautions", () => {
    const geojson = buildGeoJsonObject([poi], enrichments);
    const props = geojson.features[0].properties!;
    expect(props.enrichment_structured_cautions).toContain("Price information could not be confirmed.");
  });

  it("K12: GeoJSON exposes enrichment_structured_sourceRollup", () => {
    const geojson = buildGeoJsonObject([poi], enrichments);
    const props = geojson.features[0].properties!;
    expect(props.enrichment_structured_sourceRollup).toContain("google_maps");
    expect(props.enrichment_structured_sourceRollup).toContain("Well-reviewed bistro");
  });

  it("K13: GeoJSON exposes enrichment_structured_unknowns", () => {
    const geojson = buildGeoJsonObject([poi], enrichments);
    const props = geojson.features[0].properties!;
    expect(props.enrichment_structured_unknowns).toContain("Bike parking availability unclear.");
  });
});

// ===========================================================================
// N. Perf And Stability Checks (structural, not load)
// ===========================================================================

describe("FVM-N: Stability Checks", () => {
  it("N1: ENRICHMENT_DISPLAY_ORDER covers all structured fields", () => {
    const expectedFields = ["headline", "operationalSummary", "practicalities", "cautions", "divergences", "unknowns", "sourceRollup", "sourceConfirmation"];
    for (const field of expectedFields) {
      expect((ENRICHMENT_DISPLAY_ORDER as readonly string[]).includes(field)).toBe(true);
    }
  });

  it("N2: ENRICHMENT_LENGTH_TARGETS has sensible values", () => {
    expect(ENRICHMENT_LENGTH_TARGETS.headlineMobile).toBeGreaterThan(50);
    expect(ENRICHMENT_LENGTH_TARGETS.headlineList).toBeGreaterThan(ENRICHMENT_LENGTH_TARGETS.headlineMobile);
    expect(ENRICHMENT_LENGTH_TARGETS.essentialsExport).toBeGreaterThan(ENRICHMENT_LENGTH_TARGETS.headlineList);
    expect(ENRICHMENT_LENGTH_TARGETS.practicalitiesMax).toBeGreaterThanOrEqual(3);
    expect(ENRICHMENT_LENGTH_TARGETS.cautionsMax).toBeGreaterThanOrEqual(2);
    expect(ENRICHMENT_LENGTH_TARGETS.unknownsMax).toBeGreaterThanOrEqual(1);
  });

  it("N3: buildStructuredContent handles empty inputs gracefully", () => {
    const poi = makePoi();
    const emptyEnrichment = { rating: null, reviewCount: null, hours: null, specialty: null, summary: null, translatedSummary: null, priceLevel: null, locality: null };
    // Should not throw
    const structured = buildStructuredContent(poi, emptyEnrichment, [], null, "en");
    expect(structured).toBeDefined();
    expect(structured.headline).not.toBeNull();
    expect(structured.practicalities).toEqual(expect.any(Array));
    expect(structured.cautions).toEqual(expect.any(Array));
    expect(structured.unknowns).toEqual(expect.any(Array));
    expect(structured.sourceRollup).toEqual(expect.any(Array));
  });

  it("N4: buildEssentialsText handles empty structured gracefully", () => {
    const emptyStructured: EnrichmentStructuredContent = {
      headline: null,
      operationalSummary: null,
      practicalities: [],
      sourceRollup: [],
      cautions: [],
      unknowns: [],
      divergences: [],
      sourceConfirmation: "none",
    };
    const essentials = buildEssentialsText(emptyStructured);
    // Should return null for completely empty input, not throw
    expect(essentials).toBeNull();
  });

  it("N5: duplicate snippets in buildStructuredContent produce deduplicated sourceRollup", () => {
    const poi = makePoi();
    const enrichment = { rating: null, reviewCount: null, hours: null, specialty: null, summary: null, translatedSummary: null, priceLevel: null, locality: null };
    const dupeSnippets: SearchSnippet[] = [
      { title: "Same source", url: "https://www.google.com/maps/place/test", content: "Review 1", engine: "google" },
      { title: "Same source again", url: "https://www.google.com/maps/place/test2", content: "Review 2", engine: "google" },
    ];
    const structured = buildStructuredContent(poi, enrichment, dupeSnippets, null, "en");
    // Both are from google_maps platform -> should be grouped into one digest
    const googleDigests = structured.sourceRollup.filter((d) => d.platform === "google_maps");
    expect(googleDigests).toHaveLength(1);
  });
});

// ===========================================================================
// WS5: Official Website Hardening
// ===========================================================================

describe("FVM-WS5: Official Website Hardening", () => {
  it("WS5-1: rejects Facebook URL as official website", () => {
    const poi = makePoi({ tags: { amenity: "restaurant", website: "https://www.facebook.com/chezmarcel" } });
    expect(getOfficialWebsiteUrl(poi)).toBeNull();
  });

  it("WS5-2: rejects Instagram URL as official website", () => {
    const poi = makePoi({ tags: { amenity: "restaurant", website: "https://instagram.com/chezmarcel" } });
    expect(getOfficialWebsiteUrl(poi)).toBeNull();
  });

  it("WS5-3: rejects TripAdvisor URL as official website", () => {
    const poi = makePoi({ tags: { amenity: "restaurant", website: "https://www.tripadvisor.fr/restaurant/test" } });
    expect(getOfficialWebsiteUrl(poi)).toBeNull();
  });

  it("WS5-4: rejects Booking.com URL as official website", () => {
    const poi = makePoi({ tags: { amenity: "restaurant", website: "https://www.booking.com/hotel/test" } });
    expect(getOfficialWebsiteUrl(poi)).toBeNull();
  });

  it("WS5-5: rejects PagesJaunes URL as official website", () => {
    const poi = makePoi({ tags: { amenity: "restaurant", website: "https://www.pagesjaunes.fr/test" } });
    expect(getOfficialWebsiteUrl(poi)).toBeNull();
  });

  it("WS5-6: rejects YouTube URL as official website", () => {
    const poi = makePoi({ tags: { amenity: "restaurant", website: "https://www.youtube.com/@chezmarcel" } });
    expect(getOfficialWebsiteUrl(poi)).toBeNull();
  });

  it("WS5-7: accepts real domain as official website", () => {
    const poi = makePoi({ tags: { amenity: "restaurant", website: "https://chez-marcel.fr" } });
    expect(getOfficialWebsiteUrl(poi)).toBe("https://chez-marcel.fr");
  });

  it("WS5-8: falls back to contact:website when website is social", () => {
    const poi = makePoi({ tags: { amenity: "restaurant", website: "https://facebook.com/test", "contact:website": "https://real-site.fr" } });
    expect(getOfficialWebsiteUrl(poi)).toBe("https://real-site.fr");
  });

  it("WS5-9: isRejectedOfficialDomain handles subdomains", () => {
    expect(isRejectedOfficialDomain("https://m.facebook.com/page")).toBe(true);
    expect(isRejectedOfficialDomain("https://fr.tripadvisor.com/test")).toBe(true);
    expect(isRejectedOfficialDomain("https://not-facebook.com/page")).toBe(false);
  });

  it("WS5-10: isRejectedOfficialDomain handles malformed URLs", () => {
    expect(isRejectedOfficialDomain("not-a-url")).toBe(false);
    expect(isRejectedOfficialDomain("")).toBe(false);
  });

  it("WS5-11: isOfficialDomainSnippet matches same domain", () => {
    expect(isOfficialDomainSnippet("https://chez-marcel.fr/menu", "https://chez-marcel.fr")).toBe(true);
    expect(isOfficialDomainSnippet("https://www.chez-marcel.fr/about", "https://chez-marcel.fr")).toBe(true);
  });

  it("WS5-12: isOfficialDomainSnippet rejects different domain", () => {
    expect(isOfficialDomainSnippet("https://google.com/maps/test", "https://chez-marcel.fr")).toBe(false);
  });

  it("WS5-13: isOfficialDomainSnippet returns false when no official URL", () => {
    expect(isOfficialDomainSnippet("https://chez-marcel.fr", null)).toBe(false);
  });
});

// ===========================================================================
// WS6: Per-Category Search Query Tuning
// ===========================================================================

describe("FVM-WS6: Per-Category Search Query Tuning", () => {
  it("WS6-1: Restaurant query has restaurant and horaires keywords", () => {
    const poi = makePoi({ category: "Restaurant or Bar" });
    const query = buildSearchQuery(poi, "Lyon");
    expect(query).toContain("avis");
    expect(query).toContain("restaurant");
    expect(query).toContain("horaires");
  });

  it("WS6-2: Food shop query has horaires and magasin keywords", () => {
    const poi = makePoi({ category: "Food shop", name: "Carrefour", tags: { shop: "supermarket" } });
    const query = buildSearchQuery(poi, "Valence");
    expect(query).toContain("horaires");
    expect(query).toContain("magasin");
  });

  it("WS6-3: Sleeping place query has tarif and hébergement keywords", () => {
    const poi = makePoi({ category: "Sleeping place", name: "Hotel du Parc", tags: { tourism: "hotel" } });
    const query = buildSearchQuery(poi, null);
    expect(query).toContain("tarif");
    expect(query).toContain("hébergement");
  });

  it("WS6-4: Gears query has réparation and atelier keywords", () => {
    const poi = makePoi({ category: "Gears", name: "VeloBike", tags: { shop: "bicycle" } });
    const query = buildSearchQuery(poi, "Grenoble");
    expect(query).toContain("réparation");
    expect(query).toContain("atelier");
  });

  it("WS6-5: unknown category falls back to default bias", () => {
    const poi = makePoi({ category: "DIY" as any, name: "Brico Depot", tags: { shop: "doityourself" } });
    const query = buildSearchQuery(poi, "Toulouse");
    // Default bias should have generic avis keyword
    expect(query).toContain("avis");
    expect(query).toContain("Toulouse");
  });

  it("WS6-6: cleanPoiNameForSearch removes parenthetical annotations", () => {
    expect(cleanPoiNameForSearch("Le Zinc (closed)")).toBe("Le Zinc");
    expect(cleanPoiNameForSearch("Carrefour (temporarily closed)")).toBe("Carrefour");
  });

  it("WS6-7: cleanPoiNameForSearch removes trailing closure annotations", () => {
    expect(cleanPoiNameForSearch("Le Zinc - fermé")).toBe("Le Zinc");
    expect(cleanPoiNameForSearch("Boulangerie – temporarily closed")).toBe("Boulangerie");
  });

  it("WS6-8: cleanPoiNameForSearch handles empty input", () => {
    expect(cleanPoiNameForSearch("")).toBe("");
    expect(cleanPoiNameForSearch("  ")).toBe("");
  });

  it("WS6-9: cleanPoiNameForSearch preserves normal names", () => {
    expect(cleanPoiNameForSearch("Chez Marcel")).toBe("Chez Marcel");
    expect(cleanPoiNameForSearch("Le Petit Zinc")).toBe("Le Petit Zinc");
  });
});

// ===========================================================================
// WS7: URL Normalization & Dedup
// ===========================================================================

describe("FVM-WS7: URL Normalization & Dedup", () => {
  it("WS7-1: strips utm tracking params", () => {
    const url = "https://example.com/page?utm_source=google&utm_medium=cpc&id=42";
    const normalized = normalizeUrlForDedup(url);
    expect(normalized).not.toContain("utm_source");
    expect(normalized).not.toContain("utm_medium");
    expect(normalized).toContain("id=42");
  });

  it("WS7-2: strips fbclid and gclid", () => {
    const url = "https://example.com/page?fbclid=abc123&gclid=def456";
    const normalized = normalizeUrlForDedup(url);
    expect(normalized).not.toContain("fbclid");
    expect(normalized).not.toContain("gclid");
  });

  it("WS7-3: normalizes www. prefix", () => {
    const url1 = normalizeUrlForDedup("https://www.example.com/page");
    const url2 = normalizeUrlForDedup("https://example.com/page");
    expect(url1).toBe(url2);
  });

  it("WS7-4: normalizes m. prefix", () => {
    const url1 = normalizeUrlForDedup("https://m.example.com/page");
    const url2 = normalizeUrlForDedup("https://example.com/page");
    expect(url1).toBe(url2);
  });

  it("WS7-5: strips trailing slash", () => {
    const url1 = normalizeUrlForDedup("https://example.com/page/");
    const url2 = normalizeUrlForDedup("https://example.com/page");
    expect(url1).toBe(url2);
  });

  it("WS7-6: preserves root path slash", () => {
    const normalized = normalizeUrlForDedup("https://example.com/");
    // Root path should still have / (it's the minimum path)
    expect(normalized).toContain("example.com");
  });

  it("WS7-7: handles malformed URLs gracefully", () => {
    expect(normalizeUrlForDedup("not-a-url")).toBe("not-a-url");
    expect(normalizeUrlForDedup("")).toBe("");
  });

  it("WS7-8: same page with/without tracking are equal after normalization", () => {
    const clean = normalizeUrlForDedup("https://www.yelp.com/biz/chez-marcel");
    const tracked = normalizeUrlForDedup("https://www.yelp.com/biz/chez-marcel?utm_source=google&ref=search");
    expect(clean).toBe(tracked);
  });
});

// ===========================================================================
// WS8: Category-Specific LLM Prompt Hardening
// ===========================================================================

describe("FVM-WS8: Category-Specific LLM Prompts", () => {
  it("WS8-1: Restaurant prompt includes cuisine and terrace priorities", () => {
    const prompt = buildSystemPrompt("en", "Restaurant or Bar");
    expect(prompt).toContain("Cuisine type");
    expect(prompt).toContain("terrace");
  });

  it("WS8-2: Restaurant prompt bans marketing language", () => {
    const prompt = buildSystemPrompt("en", "Restaurant or Bar");
    expect(prompt).toContain("Marketing language");
  });

  it("WS8-3: Food shop prompt prioritizes opening hours", () => {
    const prompt = buildSystemPrompt("en", "Food shop");
    expect(prompt).toContain("Opening hours");
    expect(prompt).toContain("resupply");
  });

  it("WS8-4: Sleeping place prompt includes booking and check-in", () => {
    const prompt = buildSystemPrompt("en", "Sleeping place");
    expect(prompt).toContain("Booking requirement");
    expect(prompt).toContain("Check-in");
  });

  it("WS8-5: Sleeping place prompt bans invented amenity lists", () => {
    const prompt = buildSystemPrompt("en", "Sleeping place");
    expect(prompt).toContain("Invented amenity lists");
  });

  it("WS8-6: Gears prompt includes repair service priority", () => {
    const prompt = buildSystemPrompt("en", "Gears");
    expect(prompt).toContain("bike repair");
  });

  it("WS8-7: Gears prompt includes valuable signals like spare parts", () => {
    const prompt = buildSystemPrompt("en", "Gears");
    expect(prompt).toContain("Spare parts");
  });

  it("WS8-8: unknown category does not inject contract block", () => {
    const prompt = buildSystemPrompt("en", "Water");
    expect(prompt).not.toContain("Category-specific instructions");
    expect(prompt).not.toContain("Priority fields for essentials");
  });

  it("WS8-9: no category does not inject contract block", () => {
    const prompt = buildSystemPrompt("en");
    expect(prompt).not.toContain("Category-specific instructions");
  });

  it("WS8-10: French language prompt requests French translatedSummary", () => {
    const prompt = buildSystemPrompt("fr", "Restaurant or Bar");
    expect(prompt).toContain("French");
  });

  it("WS8-11: English language prompt requests English translatedSummary", () => {
    const prompt = buildSystemPrompt("en", "Restaurant or Bar");
    expect(prompt).toContain("English");
  });

  it("WS8-12: contract banned patterns appear in NEVER section", () => {
    const prompt = buildSystemPrompt("en", "Food shop");
    expect(prompt).toContain("NEVER include");
    expect(prompt).toContain("Assumed product range");
  });
});

// ===========================================================================
// WS10: Richer Confidence Formula
// ===========================================================================

describe("FVM-WS10: Richer Confidence Formula", () => {
  const baseEnrichment = {
    rating: null,
    reviewCount: null,
    hours: null,
    description: null,
    review: null,
  };

  it("WS10-1: official website boosts confidence", () => {
    const withoutSite = computeConfidence({
      ...baseEnrichment,
      rawSnippets: makeSnippets(3),
    });
    const withSite = computeConfidence({
      ...baseEnrichment,
      rawSnippets: makeSnippets(3),
      officialWebsite: { url: "https://example.com" },
    });
    expect(withSite).toBeGreaterThan(withoutSite);
  });

  it("WS10-2: longer snippet content increases quality factor", () => {
    const shortSnippets = [
      { engine: "google", content: "Short", url: "https://a.com" },
      { engine: "bing", content: "Also short", url: "https://b.com" },
    ];
    const longSnippets = [
      { engine: "google", content: "A".repeat(200), url: "https://a.com" },
      { engine: "bing", content: "B".repeat(200), url: "https://b.com" },
    ];
    const scoreShort = computeConfidence({ ...baseEnrichment, rawSnippets: shortSnippets });
    const scoreLong = computeConfidence({ ...baseEnrichment, rawSnippets: longSnippets });
    expect(scoreLong).toBeGreaterThan(scoreShort);
  });

  it("WS10-3: snippets from diverse domains increase confidence", () => {
    const sameDomain = [
      { engine: "google", content: "Review 1", url: "https://google.com/a" },
      { engine: "google", content: "Review 2", url: "https://google.com/b" },
      { engine: "google", content: "Review 3", url: "https://google.com/c" },
    ];
    const diverseDomains = [
      { engine: "google", content: "Review 1", url: "https://google.com/a" },
      { engine: "google", content: "Review 2", url: "https://yelp.com/b" },
      { engine: "google", content: "Review 3", url: "https://tripadvisor.com/c" },
    ];
    const scoreSame = computeConfidence({ ...baseEnrichment, rawSnippets: sameDomain });
    const scoreDiverse = computeConfidence({ ...baseEnrichment, rawSnippets: diverseDomains });
    expect(scoreDiverse).toBeGreaterThan(scoreSame);
  });

  it("WS10-4: confidence still 0 with no snippets", () => {
    expect(computeConfidence({ ...baseEnrichment, rawSnippets: [] })).toBe(0);
  });

  it("WS10-5: all factors combined never exceed 1.0", () => {
    const maxScore = computeConfidence({
      rating: 5.0,
      reviewCount: 1000,
      hours: "24/7",
      description: "Perfect in every way with lots of detail and nuance",
      review: "Everything",
      rawSnippets: Array.from({ length: 20 }, (_, i) => ({
        engine: ["google", "bing", "duckduckgo", "brave"][i % 4],
        content: "X".repeat(300),
        url: `https://site-${i}.com/page`,
      })),
      officialWebsite: { url: "https://official.com" },
    });
    expect(maxScore).toBeLessThanOrEqual(1.0);
    expect(maxScore).toBeGreaterThan(0.7);
  });

  it("WS10-6: structured fields each add incremental confidence", () => {
    const base = computeConfidence({
      ...baseEnrichment,
      rawSnippets: makeSnippets(4),
    });
    const withRating = computeConfidence({
      ...baseEnrichment,
      rating: 4.0,
      rawSnippets: makeSnippets(4),
    });
    const withMore = computeConfidence({
      ...baseEnrichment,
      rating: 4.0,
      hours: "9-17",
      description: "Good place",
      rawSnippets: makeSnippets(4),
    });
    expect(withRating).toBeGreaterThan(base);
    expect(withMore).toBeGreaterThan(withRating);
  });
});

// ===========================================================================
// WS11: Contradiction Confidence Penalty
// ===========================================================================

describe("FVM-WS11: Contradiction Confidence Penalty", () => {
  const baseEnrichment = {
    rating: 4.0,
    reviewCount: 50,
    hours: "9:00-18:00",
    description: "Good restaurant",
    review: "French cuisine",
  };

  it("WS11-1: divergences reduce confidence score", () => {
    const noDivergences = computeConfidence({
      ...baseEnrichment,
      rawSnippets: makeSnippets(5),
    });
    const withDivergences = computeConfidence({
      ...baseEnrichment,
      rawSnippets: makeSnippets(5),
      structured: { divergences: ["Sources report different opening hours — verify locally."] },
    });
    expect(withDivergences).toBeLessThan(noDivergences);
  });

  it("WS11-2: multiple divergences reduce confidence more", () => {
    const oneDivergence = computeConfidence({
      ...baseEnrichment,
      rawSnippets: makeSnippets(5),
      structured: { divergences: ["Hours differ."] },
    });
    const threeDivergences = computeConfidence({
      ...baseEnrichment,
      rawSnippets: makeSnippets(5),
      structured: { divergences: ["Hours differ.", "Ratings vary.", "Closure signals detected."] },
    });
    expect(threeDivergences).toBeLessThan(oneDivergence);
  });

  it("WS11-3: contradiction penalty capped at 0.15", () => {
    const noPenalty = computeConfidence({
      ...baseEnrichment,
      rawSnippets: makeSnippets(5),
    });
    const maxPenalty = computeConfidence({
      ...baseEnrichment,
      rawSnippets: makeSnippets(5),
      structured: { divergences: ["A", "B", "C", "D", "E"] },
    });
    // 5 * 0.05 = 0.25, but cap is 0.15
    expect(noPenalty - maxPenalty).toBeLessThanOrEqual(0.16);
    expect(noPenalty - maxPenalty).toBeGreaterThanOrEqual(0.14);
  });

  it("WS11-4: confidence never goes below 0 from penalty", () => {
    const score = computeConfidence({
      rating: null,
      reviewCount: null,
      hours: null,
      description: null,
      review: null,
      rawSnippets: [{ engine: "google", content: "x", url: "https://a.com" }],
      structured: { divergences: ["A", "B", "C"] },
    });
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("WS11-5: empty divergences array has no penalty", () => {
    const noDivergences = computeConfidence({
      ...baseEnrichment,
      rawSnippets: makeSnippets(5),
    });
    const emptyDivergences = computeConfidence({
      ...baseEnrichment,
      rawSnippets: makeSnippets(5),
      structured: { divergences: [] },
    });
    expect(emptyDivergences).toBe(noDivergences);
  });
});

// ===========================================================================
// WS16: Direct Divergence Detection Tests
// ===========================================================================

describe("FVM-WS16: Divergence Detection (buildDivergences)", () => {
  const noEnrichment = { hours: null, rating: null };

  it("WS16-1: detects hours contradictions from different patterns", () => {
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "A", url: "https://a.com", content: "Open 9h00-17h00 weekdays" },
      { engine: "bing", title: "B", url: "https://b.com", content: "Hours: 10h00-18h00 daily" },
    ];
    const divergences = buildDivergences(snippets, noEnrichment);
    expect(divergences.some((d) => d.includes("hours"))).toBe(true);
  });

  it("WS16-2: no hours divergence when patterns agree", () => {
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "A", url: "https://a.com", content: "Open 9h00-17h00" },
      { engine: "bing", title: "B", url: "https://b.com", content: "Horaires: 9h00-17h00" },
    ];
    const divergences = buildDivergences(snippets, noEnrichment);
    expect(divergences.some((d) => d.includes("hours"))).toBe(false);
  });

  it("WS16-3: detects rating spread >= 1.0", () => {
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "A", url: "https://a.com", content: "Rated 4.5/5 on Google" },
      { engine: "bing", title: "B", url: "https://b.com", content: "Only 3.2/5 stars" },
    ];
    const divergences = buildDivergences(snippets, noEnrichment);
    expect(divergences.some((d) => d.includes("Rating varies"))).toBe(true);
  });

  it("WS16-4: no rating divergence when spread < 1.0", () => {
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "A", url: "https://a.com", content: "4.2/5 stars" },
      { engine: "bing", title: "B", url: "https://b.com", content: "4.5/5 stars" },
    ];
    const divergences = buildDivergences(snippets, noEnrichment);
    expect(divergences.some((d) => d.includes("Rating varies"))).toBe(false);
  });

  it("WS16-5: detects closure contradiction with positive signals", () => {
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "Closed", url: "https://a.com", content: "Permanently closed since 2024" },
      { engine: "bing", title: "Review", url: "https://b.com", content: "Excellent food, open daily" },
    ];
    const divergences = buildDivergences(snippets, noEnrichment);
    expect(divergences.some((d) => d.includes("closed"))).toBe(true);
  });

  it("WS16-6: closure without positive signal still warns", () => {
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "Closed", url: "https://a.com", content: "Fermé définitivement" },
      { engine: "bing", title: "Info", url: "https://b.com", content: "No recent updates" },
    ];
    const divergences = buildDivergences(snippets, noEnrichment);
    expect(divergences.some((d) => d.toLowerCase().includes("clos"))).toBe(true);
  });

  it("WS16-7: no divergences for clean, consistent snippets", () => {
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "A", url: "https://a.com", content: "Nice bakery in town center" },
      { engine: "bing", title: "B", url: "https://b.com", content: "Great bread and pastries" },
    ];
    const divergences = buildDivergences(snippets, noEnrichment);
    expect(divergences).toHaveLength(0);
  });

  it("WS16-8: divergences capped at 3", () => {
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "A", url: "https://a.com", content: "Open 9h00-17h00. Rating 4.8/5 stars. Permanently closed." },
      { engine: "bing", title: "B", url: "https://b.com", content: "Open 11h00-22h00. Only 2.1/5 stars. Excellent restaurant, highly recommended." },
    ];
    const divergences = buildDivergences(snippets, noEnrichment);
    expect(divergences.length).toBeLessThanOrEqual(3);
  });
});

// ===========================================================================
// WS16: Source Confirmation Tests
// ===========================================================================

describe("FVM-WS16: Source Confirmation (determineSourceConfirmation)", () => {
  it("WS16-SC1: returns 'both' when official + review platforms present", () => {
    const rollup = [
      { platform: "official_website" as const, brief: "Official", url: "https://example.com" },
      { platform: "google_maps" as const, brief: "Google Maps", url: "https://maps.google.com" },
    ];
    expect(determineSourceConfirmation(rollup)).toBe("both");
  });

  it("WS16-SC2: returns 'official' when only official present", () => {
    const rollup = [
      { platform: "official_website" as const, brief: "Official", url: "https://example.com" },
    ];
    expect(determineSourceConfirmation(rollup)).toBe("official");
  });

  it("WS16-SC3: returns 'reviews-only' when only review platforms present", () => {
    const rollup = [
      { platform: "tripadvisor" as const, brief: "Tripadvisor", url: "https://tripadvisor.com" },
      { platform: "yelp" as const, brief: "Yelp", url: "https://yelp.com" },
    ];
    expect(determineSourceConfirmation(rollup)).toBe("reviews-only");
  });

  it("WS16-SC4: returns 'none' when only social/other platforms", () => {
    const rollup = [
      { platform: "facebook" as const, brief: "Facebook", url: "https://facebook.com" },
      { platform: "instagram" as const, brief: "Instagram", url: "https://instagram.com" },
    ];
    expect(determineSourceConfirmation(rollup)).toBe("none");
  });

  it("WS16-SC5: returns 'none' when empty", () => {
    expect(determineSourceConfirmation([])).toBe("none");
  });

  it("WS16-SC6: booking counts as review platform", () => {
    const rollup = [
      { platform: "booking" as const, brief: "Booking", url: "https://booking.com" },
    ];
    expect(determineSourceConfirmation(rollup)).toBe("reviews-only");
  });

  it("WS16-SC7: official + booking = both", () => {
    const rollup = [
      { platform: "official_website" as const, brief: "Official", url: "https://hotel.com" },
      { platform: "booking" as const, brief: "Booking", url: "https://booking.com" },
    ];
    expect(determineSourceConfirmation(rollup)).toBe("both");
  });
});

// ===========================================================================
// WS16: Sleeping Place with Booking/Hotels.com
// ===========================================================================

describe("FVM-WS16: Sleeping Place Booking Integration", () => {
  it("WS16-SP1: sleeping place search query includes booking bias", () => {
    const poi = makePoi({ name: "Hotel des Voyageurs", category: "Sleeping place" });
    const query = buildSearchQuery(poi, "Lyon");
    const lower = query.toLowerCase();
    expect(lower.includes("booking") || lower.includes("hotels.com") || lower.includes("tarif") || lower.includes("reservation")).toBe(true);
  });

  it("WS16-SP2: sleeping place structured content with booking source", () => {
    const poi = makePoi({ name: "Camping Les Pins", category: "Sleeping place" });
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "Booking", url: "https://booking.com/camping-les-pins", content: "Camping Les Pins. Rated 7.8/10 on Booking. Pitch from 15€/night. Check-in 14:00." },
      { engine: "bing", title: "Google", url: "https://google.com/maps/camping", content: "Camping Les Pins. 4.1/5 stars (89 reviews). Open April to October." },
    ];
    const enrichment = {
      rating: 4.1,
      reviewCount: 89,
      hours: "April-October",
      specialty: "Campsite",
      summary: "Campsite near the route",
      translatedSummary: null,
      priceLevel: 1,
      locality: "Ardèche",
    };
    const structured = buildStructuredContent(poi, enrichment, snippets, null, "en");
    expect(structured.sourceConfirmation).toBe("reviews-only");
    expect(structured.sourceRollup.some((d) => d.platform === "booking")).toBe(true);
    expect(structured.practicalities.length).toBeGreaterThan(0);
  });

  it("WS16-SP3: sleeping place with official site + booking = both confirmation", () => {
    const poi = makePoi({ name: "Gîte du Col", category: "Sleeping place" });
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "Booking", url: "https://booking.com/gite-du-col", content: "Rated 8.5/10. From 45€/night." },
    ];
    const websitePreview = {
      url: "https://gite-du-col.fr",
      finalUrl: "https://gite-du-col.fr",
      title: "Gîte du Col - Hébergement cycliste",
      description: "Gîte avec local vélo sécurisé, petit-déjeuner inclus",
      excerpt: "Bienvenue au Gîte du Col",
      fetchedAt: new Date().toISOString(),
    };
    const enrichment = {
      rating: null,
      reviewCount: null,
      hours: null,
      specialty: "Gîte",
      summary: null,
      translatedSummary: null,
      priceLevel: null,
      locality: "Vercors",
    };
    const structured = buildStructuredContent(poi, enrichment, snippets, websitePreview, "en");
    expect(structured.sourceConfirmation).toBe("both");
    expect(structured.sourceRollup.some((d) => d.platform === "official_website")).toBe(true);
    expect(structured.sourceRollup.some((d) => d.platform === "booking")).toBe(true);
  });
});

// ===========================================================================
// FVM-I: Pipeline Integration (enrichPoi with mocked fetch)
// ===========================================================================

import { vi, beforeEach, afterEach } from "vitest";
import { enrichPoi, enrichBatch } from "../lib/enrichment/enricher";

describe("FVM-I: Pipeline Integration (enrichPoi)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function mockFetchResponses(options: {
    geocode?: object;
    search?: object;
    fetchPage?: object | null;
  }) {
    const geocodeResponse = options.geocode ?? {
      address: { city: "Lyon" },
      display_name: "Lyon, France",
    };
    const searchResponse = options.search ?? {
      results: [
        { title: "Google result", url: "https://google.com/maps/place/test", content: "Great restaurant near route", engine: "google", score: 1 },
        { title: "Yelp result", url: "https://yelp.com/biz/test", content: "Good food and atmosphere", engine: "bing", score: 0.8 },
      ],
      query: "test",
    };
    const fetchPageResponse = options.fetchPage !== undefined ? options.fetchPage : null;

    fetchMock.mockImplementation(async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes("/geocode")) {
        return new Response(JSON.stringify(geocodeResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("/search")) {
        return new Response(JSON.stringify(searchResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("/fetch-page")) {
        if (fetchPageResponse === null) {
          return new Response("Not found", { status: 404 });
        }
        return new Response(JSON.stringify(fetchPageResponse), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Unknown endpoint", { status: 404 });
    });
  }

  it("I-full-noLLM: enrichPoi full category produces structured output without LLM", async () => {
    const poi = makePoi({ category: "Restaurant or Bar", name: "Chez Marcel" });
    mockFetchResponses({});
    const result = await enrichPoi(poi, { apiBase: "" });
    expect(result.status).toBe("done");
    expect(result.locality).toBe("Lyon");
    expect(result.sourceCount).toBeGreaterThan(0);
    expect(result.structured).toBeDefined();
    expect(result.structured!.headline).not.toBeNull();
    expect(result.structured!.sourceRollup.length).toBeGreaterThan(0);
    expect(result.essentials).not.toBeNull();
    expect(result.confidence).toBeGreaterThan(0);
  });

  it("I-zero: enrichPoi degrades properly with zero search results", async () => {
    const poi = makePoi({ category: "Restaurant or Bar", name: "Le Fantome" });
    mockFetchResponses({
      search: { results: [], query: "test" },
    });
    const result = await enrichPoi(poi, { apiBase: "" });
    expect(result.status).toBe("skipped");
    expect(result.skipReason).toBe("no-results");
    expect(result.sourceCount).toBe(0);
    expect(result.confidence).toBe(0);
  });

  it("I-searchError: enrichPoi degrades on search error", async () => {
    const poi = makePoi({ category: "Restaurant or Bar", name: "Chez Error" });
    fetchMock.mockImplementation(async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes("/geocode")) {
        return new Response(JSON.stringify({ address: { city: "Lyon" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("/search")) {
        return new Response("Server error", { status: 400 });
      }
      return new Response("Not found", { status: 404 });
    });
    const result = await enrichPoi(poi, { apiBase: "" });
    // Search failure may yield error or degraded done with 0 sources
    expect(["error", "done"]).toContain(result.status);
    if (result.status === "error") {
      expect(result.error).toBeDefined();
    } else {
      expect(result.sourceCount).toBe(0);
    }
  }, 15000);

  it("I-websiteError: enrichPoi degrades on website fetch error", async () => {
    const poi = makePoi({
      category: "Restaurant or Bar",
      name: "Chez Marcel",
      tags: { amenity: "restaurant", website: "https://chez-marcel.fr" },
    });
    mockFetchResponses({
      fetchPage: null, // 404 on fetch-page
    });
    const result = await enrichPoi(poi, { apiBase: "" });
    // Should still succeed — website is non-critical
    expect(result.status).toBe("done");
    expect(result.officialWebsite).toBeNull();
    expect(result.sourceCount).toBeGreaterThan(0);
  });

  it("I-skip: enrichPoi respects skip policy", async () => {
    const poi = makePoi({ category: "Water", name: "Fontaine du village" });
    const result = await enrichPoi(poi, { apiBase: "" });
    expect(result.status).toBe("skipped");
    expect(result.skipReason).toBe("low-value-category");
    expect(fetchMock).not.toHaveBeenCalled(); // No network calls for skip
  });

  it("I-minimal: enrichPoi respects minimal policy", async () => {
    const poi = makePoi({ category: "Laundry", name: "Laverie Express" });
    mockFetchResponses({});
    const result = await enrichPoi(poi, { apiBase: "" });
    expect(result.status).toBe("done");
    expect(result.locality).toBe("Lyon");
    expect(result.sourceCount).toBe(0); // No search for minimal
    expect(result.confidence).toBe(0);
  });

  it("I-canonical: enrichPoi done result has canonical structured shape", async () => {
    const poi = makePoi({ category: "Food shop", name: "Carrefour Contact" });
    mockFetchResponses({});
    const result = await enrichPoi(poi, { apiBase: "" });
    expect(result.status).toBe("done");
    const s = result.structured!;
    // All 8 fields exist
    expect(s).toHaveProperty("headline");
    expect(s).toHaveProperty("operationalSummary");
    expect(s).toHaveProperty("practicalities");
    expect(s).toHaveProperty("sourceRollup");
    expect(s).toHaveProperty("cautions");
    expect(s).toHaveProperty("unknowns");
    expect(s).toHaveProperty("divergences");
    expect(s).toHaveProperty("sourceConfirmation");
    // Arrays are arrays
    expect(Array.isArray(s.practicalities)).toBe(true);
    expect(Array.isArray(s.sourceRollup)).toBe(true);
    expect(Array.isArray(s.cautions)).toBe(true);
    expect(Array.isArray(s.unknowns)).toBe(true);
    expect(Array.isArray(s.divergences)).toBe(true);
    // sourceConfirmation is a valid value
    expect(["official", "reviews-only", "both", "none"]).toContain(s.sourceConfirmation);
  });

  it("I-withWebsite: enrichPoi with official website produces sourceConfirmation", async () => {
    const poi = makePoi({
      category: "Restaurant or Bar",
      name: "Chez Marcel",
      tags: { amenity: "restaurant", website: "https://chez-marcel.fr" },
    });
    mockFetchResponses({
      fetchPage: {
        url: "https://chez-marcel.fr",
        finalUrl: "https://chez-marcel.fr",
        contentType: "text/html",
        title: "Chez Marcel",
        description: "Restaurant traditionnel",
        excerpt: "Bienvenue chez Marcel",
        fetchedAt: new Date().toISOString(),
      },
    });
    const result = await enrichPoi(poi, { apiBase: "" });
    expect(result.status).toBe("done");
    expect(result.officialWebsite).not.toBeNull();
    expect(result.structured!.sourceConfirmation).toBe("both");
  });
});

describe("FVM-I: enrichBatch mixed policies", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("I-batch: enrichBatch mixes full, minimal, skip correctly", async () => {
    fetchMock.mockImplementation(async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes("/geocode")) {
        return new Response(JSON.stringify({ address: { city: "Valence" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("/search")) {
        return new Response(JSON.stringify({
          results: [
            { title: "Result", url: "https://example.com", content: "Content here", engine: "google" },
          ],
          query: "test",
        }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("Not found", { status: 404 });
    });

    const pois = [
      makePoi({ id: "p1", category: "Restaurant or Bar", name: "Le Bistrot" }),
      makePoi({ id: "p2", category: "Water", name: "Fontaine" }),
      makePoi({ id: "p3", category: "Laundry", name: "Laverie" }),
      makePoi({ id: "p4", category: "Gears", name: "Cycles Pro" }),
    ];

    const results = await enrichBatch(pois, {
      apiBase: "",
      searchConcurrency: 1,
      searchStaggerMs: 0,
      skipUnnamed: false,
    });

    expect(results.size).toBe(4);

    // p1: full -> done (has search results)
    const r1 = results.get("p1")!;
    expect(r1.status).toBe("done");
    expect(r1.structured).toBeDefined();

    // p2: skip -> skipped
    const r2 = results.get("p2")!;
    expect(r2.status).toBe("skipped");
    expect(r2.skipReason).toBe("low-value-category");

    // p3: minimal -> done (geocode only)
    const r3 = results.get("p3")!;
    expect(r3.status).toBe("done");
    expect(r3.sourceCount).toBe(0);

    // p4: full -> done
    const r4 = results.get("p4")!;
    expect(r4.status).toBe("done");
    expect(r4.structured).toBeDefined();
  });

  it("I-batch-canonical: all done results from enrichBatch have canonical structure", async () => {
    fetchMock.mockImplementation(async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes("/geocode")) {
        return new Response(JSON.stringify({ address: { town: "Annonay" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("/search")) {
        return new Response(JSON.stringify({
          results: [
            { title: "R", url: "https://g.com", content: "Review text", engine: "google" },
          ],
          query: "q",
        }), { status: 200, headers: { "Content-Type": "application/json" } });
      }
      return new Response("", { status: 404 });
    });

    const pois = [
      makePoi({ id: "full1", category: "Restaurant or Bar", name: "Le Zinc" }),
      makePoi({ id: "full2", category: "Sleeping place", name: "Hotel Soleil" }),
    ];

    const results = await enrichBatch(pois, {
      apiBase: "",
      searchConcurrency: 1,
      searchStaggerMs: 0,
    });

    for (const [, enrichment] of results) {
      if (enrichment.status === "done" && enrichment.structured) {
        const s = enrichment.structured;
        expect(s).toHaveProperty("headline");
        expect(s).toHaveProperty("operationalSummary");
        expect(Array.isArray(s.practicalities)).toBe(true);
        expect(Array.isArray(s.sourceRollup)).toBe(true);
        expect(Array.isArray(s.cautions)).toBe(true);
        expect(Array.isArray(s.unknowns)).toBe(true);
        expect(Array.isArray(s.divergences)).toBe(true);
        expect(["official", "reviews-only", "both", "none"]).toContain(s.sourceConfirmation);
      }
    }
  });

  it("I-batch-cancellation: cancellation during enrichBatch stops processing", async () => {
    const controller = new AbortController();
    let callCount = 0;

    fetchMock.mockImplementation(async (url: string | URL) => {
      const urlStr = url.toString();
      if (urlStr.includes("/geocode")) {
        callCount++;
        if (callCount >= 2) controller.abort(); // Cancel after 2nd geocode call
        return new Response(JSON.stringify({ address: { city: "Lyon" } }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (urlStr.includes("/search")) {
        return new Response(JSON.stringify({ results: [], query: "q" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("", { status: 404 });
    });

    const pois = Array.from({ length: 10 }, (_, i) =>
      makePoi({ id: `cancel-${i}`, name: `POI ${i}`, category: "Restaurant or Bar" }),
    );

    const results = await enrichBatch(pois, {
      apiBase: "",
      signal: controller.signal,
      searchConcurrency: 1,
      searchStaggerMs: 0,
    });

    // Should have processed some but not all (cancellation happened)
    expect(results.size).toBeLessThan(10);
  });
});

// ===========================================================================
// FVM-C: Website Preview (fetchWebsitePreview with mocked fetch)
// ===========================================================================

import { fetchWebsitePreview } from "../lib/enrichment/search";

describe("FVM-C: Website Preview (fetchWebsitePreview)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("C-preview-ok: returns title, description, excerpt, finalUrl on success", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      url: "https://chez-marcel.fr",
      finalUrl: "https://chez-marcel.fr",
      contentType: "text/html",
      title: "Chez Marcel - Restaurant",
      description: "French cuisine since 1952",
      excerpt: "Welcome to Chez Marcel",
      fetchedAt: "2026-04-13T00:00:00Z",
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    const result = await fetchWebsitePreview("https://chez-marcel.fr", "");
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Chez Marcel - Restaurant");
    expect(result!.description).toBe("French cuisine since 1952");
    expect(result!.excerpt).toBe("Welcome to Chez Marcel");
    expect(result!.finalUrl).toBe("https://chez-marcel.fr");
    expect(result!.fetchedAt).toBeDefined();
  });

  it("C-preview-timeout: degrades on timeout (returns null)", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));

    const result = await fetchWebsitePreview("https://slow-site.com", "");
    expect(result).toBeNull();
  });

  it("C-preview-nonhtml: degrades on non-HTML (returns null)", async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({
      error: "Unsupported content type",
      contentType: "application/pdf",
    }), { status: 415 }));

    const result = await fetchWebsitePreview("https://example.com/document.pdf", "");
    expect(result).toBeNull();
  });

  it("C-preview-404: degrades on server error (returns null)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Not found", { status: 404 }));
    const result = await fetchWebsitePreview("https://dead-site.com", "");
    expect(result).toBeNull();
  });
});

// ===========================================================================
// FVM-N: Additional Stability Checks
// ===========================================================================

describe("FVM-N: Additional Stability Checks", () => {
  it("N-noWebGPU: absence of WebGPU keeps useful behavior (deterministic fallback)", () => {
    // Simulate no WebGPU: isEngineReady returns false, structured content still built
    const poi = makePoi({ category: "Restaurant or Bar" });
    const enrichment = {
      rating: 4.0, reviewCount: 30, hours: "10-22",
      specialty: "Pizzeria", summary: null, translatedSummary: null,
      priceLevel: 2, locality: "Grenoble",
    };
    const snippets = makeSnippets(3);
    const structured = buildStructuredContent(poi, enrichment, snippets, null, "en");
    // Without LLM, fallback produces headline from inferCategoryLead
    expect(structured.headline).not.toBeNull();
    expect(structured.practicalities.length).toBeGreaterThan(0);
    expect(structured.sourceRollup.length).toBeGreaterThan(0);
  });

  it("N-noOfficialSite: absence of official site keeps useful behavior", () => {
    const poi = makePoi({ category: "Restaurant or Bar", tags: { amenity: "restaurant" } });
    const enrichment = {
      rating: 3.5, reviewCount: 15, hours: "11-21",
      specialty: "Brasserie", summary: "Average brasserie", translatedSummary: null,
      priceLevel: 1, locality: "Montélimar",
    };
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "G", url: "https://google.com/maps/test", content: "Good cheap food" },
      { engine: "bing", title: "Y", url: "https://yelp.com/biz/test", content: "Average service" },
    ];
    const structured = buildStructuredContent(poi, enrichment, snippets, null, "en");
    expect(structured.sourceConfirmation).toBe("reviews-only");
    expect(structured.headline).not.toBeNull();
    expect(structured.sourceRollup.length).toBe(2);
  });

  it("N-batchStability: batch with mixed content doesn't corrupt final structure", () => {
    // Simulate building structured content for multiple different categories
    const categories = ["Restaurant or Bar", "Food shop", "Sleeping place", "Gears"] as const;
    const results: EnrichmentStructuredContent[] = [];
    for (const category of categories) {
      const poi = makePoi({ category, name: `Test ${category}` });
      const enrichment = {
        rating: 4.0, reviewCount: 20, hours: "9-18",
        specialty: "Test", summary: "Test summary", translatedSummary: null,
        priceLevel: 2, locality: "Lyon",
      };
      const snippets = makeSnippets(2);
      const structured = buildStructuredContent(poi, enrichment, snippets, null, "en");
      results.push(structured);
    }
    // Each result should be independent and have valid structure
    for (const s of results) {
      expect(s.headline).not.toBeNull();
      expect(s.practicalities.length).toBeGreaterThan(0);
      expect(Array.isArray(s.divergences)).toBe(true);
      expect(["official", "reviews-only", "both", "none"]).toContain(s.sourceConfirmation);
    }
  });
});

// ===========================================================================
// FVM-L: Non-Regression Reference Cases (deterministic snapshot tests)
// ===========================================================================

describe("FVM-L: Reference Case Snapshots", () => {
  it("L1: rich urban restaurant produces dense, actionable output", () => {
    const poi = makePoi({
      name: "Le Petit Bouchon",
      category: "Restaurant or Bar",
      tags: { amenity: "restaurant", cuisine: "french", phone: "+33 4 72 00 00 00" },
    });
    const enrichment = {
      rating: 4.4, reviewCount: 250, hours: "Tue-Sat 12:00-14:00, 19:00-22:00",
      specialty: "Lyonnaise bouchon",
      summary: "Traditional Lyonnaise bouchon with generous portions and local wine selection.",
      translatedSummary: "Bouchon lyonnais traditionnel avec portions genereuses et selection de vins locaux.",
      priceLevel: 2, locality: "Lyon",
    };
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "Google Maps", url: "https://google.com/maps/place/le-petit-bouchon", content: "4.4 stars (250 reviews). Traditional Lyonnaise cuisine, terrace, cash only." },
      { engine: "bing", title: "TripAdvisor", url: "https://tripadvisor.fr/le-petit-bouchon", content: "Excellent bouchon, must try quenelles and tablier de sapeur. Menu 22€." },
      { engine: "duckduckgo", title: "Yelp", url: "https://yelp.fr/biz/le-petit-bouchon", content: "Authentic Lyon experience. Book ahead for Friday dinner." },
    ];
    const structured = buildStructuredContent(poi, enrichment, snippets, null, "fr");
    expect(structured.headline).toContain("Bouchon lyonnais");
    expect(structured.practicalities.some((p) => p.includes("4.4"))).toBe(true);
    expect(structured.practicalities.some((p) => p.includes("250"))).toBe(true);
    expect(structured.practicalities.some((p) => p.includes("Tue-Sat"))).toBe(true);
    expect(structured.practicalities.some((p) => p.includes("+33"))).toBe(true);
    expect(structured.sourceRollup.length).toBe(3);
    expect(structured.sourceConfirmation).toBe("reviews-only");
    expect(structured.divergences).toHaveLength(0);
  });

  it("L2: rural bakery / food shop for resupply", () => {
    const poi = makePoi({
      name: "Boulangerie du Village",
      category: "Food shop",
      tags: { shop: "bakery" },
    });
    const enrichment = {
      rating: 4.7, reviewCount: 35, hours: "Tue-Sun 6:30-13:00",
      specialty: "Bakery", summary: "Village bakery, great bread, closed Mondays.",
      translatedSummary: null, priceLevel: 1, locality: "Saint-Agrève",
    };
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "Google", url: "https://google.com/maps/bakery", content: "4.7/5 (35 reviews). Best bread in the area. Opens early." },
    ];
    const structured = buildStructuredContent(poi, enrichment, snippets, null, "en");
    // headline is derived from enrichment.summary, not POI name
    expect(structured.headline).toContain("bakery");
    // Food shop contract cares about resupply — check cautions or practicalities instead
    expect(structured.practicalities.length).toBeGreaterThan(0);
    expect(structured.practicalities.some((p) => p.includes("6:30"))).toBe(true);
    expect(structured.sourceConfirmation).toBe("reviews-only");
  });

  it("L3: camping with Booking source", () => {
    const poi = makePoi({
      name: "Camping Les Oliviers",
      category: "Sleeping place",
      tags: { tourism: "camp_site" },
    });
    const enrichment = {
      rating: 4.0, reviewCount: 60, hours: "Apr-Oct",
      specialty: "Campsite", summary: "Riverside camping, quiet, basic facilities.",
      translatedSummary: null, priceLevel: 1, locality: "Ardèche",
    };
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "Google", url: "https://google.com/maps/camping", content: "4.0/5 (60 reviews). Riverside camping." },
      { engine: "bing", title: "Booking", url: "https://booking.com/camping-oliviers", content: "Rated 7.5/10 on Booking. Pitch from 12€. Check-in 15:00." },
    ];
    const websitePreview = {
      url: "https://camping-oliviers.fr",
      finalUrl: "https://camping-oliviers.fr",
      title: "Camping Les Oliviers",
      description: "Camping au bord de la rivière en Ardèche",
      excerpt: "Bienvenue au Camping Les Oliviers",
      fetchedAt: "2026-04-13T00:00:00Z",
    };
    const structured = buildStructuredContent(poi, enrichment, snippets, websitePreview, "en");
    expect(structured.sourceConfirmation).toBe("both");
    expect(structured.sourceRollup.some((d) => d.platform === "booking")).toBe(true);
    expect(structured.sourceRollup.some((d) => d.platform === "official_website")).toBe(true);
    expect(structured.practicalities.some((p) => p.includes("Apr-Oct"))).toBe(true);
  });

  it("L4: bike shop / repair shop", () => {
    const poi = makePoi({
      name: "Cycles Ardéchois",
      category: "Gears",
      tags: { shop: "bicycle", "service:bicycle:repair": "yes" },
    });
    const enrichment = {
      rating: 4.6, reviewCount: 80, hours: "Mon-Sat 9:00-18:00",
      specialty: "Bicycle shop and repair",
      summary: "Well-equipped bike shop with repair service. Quick turnaround.",
      translatedSummary: null, priceLevel: 2, locality: "Aubenas",
    };
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "Google", url: "https://google.com/maps/cycles", content: "4.6/5 (80 reviews). Full repair service, spare parts." },
      { engine: "bing", title: "Yelp", url: "https://yelp.fr/biz/cycles", content: "Great bike shop, fixed my derailleur in 30 min." },
    ];
    const structured = buildStructuredContent(poi, enrichment, snippets, null, "en");
    expect(structured.headline).toContain("bike");
    expect(structured.practicalities.some((p) => p.includes("4.6"))).toBe(true);
    expect(structured.sourceRollup.length).toBe(2);
  });

  it("L5: poor case without official site", () => {
    const poi = makePoi({
      name: "Snack du Coin",
      category: "Restaurant or Bar",
      tags: { amenity: "fast_food" },
    });
    const enrichment = {
      rating: null, reviewCount: null, hours: null,
      specialty: null, summary: null, translatedSummary: null,
      priceLevel: null, locality: "Unknown village",
    };
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "Facebook", url: "https://facebook.com/snackducoin", content: "Snack du Coin page." },
    ];
    const structured = buildStructuredContent(poi, enrichment, snippets, null, "en");
    expect(structured.cautions.length).toBeGreaterThan(0);
    // Only social source -> reliability caution
    expect(structured.cautions.some((c) => c.includes("social") || c.includes("reliability"))).toBe(true);
    expect(structured.sourceConfirmation).toBe("none");
  });

  it("L6: contradictory case with hours and rating divergences", () => {
    const poi = makePoi({
      name: "Café Ambivalent",
      category: "Restaurant or Bar",
      tags: { amenity: "cafe" },
    });
    const enrichment = {
      rating: 3.5, reviewCount: 40, hours: "8:00-20:00",
      specialty: "Café", summary: "Mixed reviews", translatedSummary: null,
      priceLevel: 1, locality: "Privas",
    };
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "Google", url: "https://google.com/maps/cafe", content: "4.5/5 stars. Open 8h00-20h00" },
      { engine: "bing", title: "TripAdvisor", url: "https://tripadvisor.fr/cafe", content: "2.1/5 stars. Open 9h00-18h00. Terrible service." },
      { engine: "duckduckgo", title: "Blog", url: "https://blog.com/cafe", content: "Permanently closed according to locals." },
      { engine: "google", title: "Other", url: "https://review.com/cafe", content: "Excellent coffee, open daily." },
    ];
    const structured = buildStructuredContent(poi, enrichment, snippets, null, "en");
    expect(structured.divergences.length).toBeGreaterThan(0);
    // Should detect hours contradiction (8h00-20h00 vs 9h00-18h00)
    expect(structured.divergences.some((d) => d.includes("hours"))).toBe(true);
    // Should detect rating contradiction (4.5 vs 2.1 -> spread 2.4)
    expect(structured.divergences.some((d) => d.includes("Rating"))).toBe(true);
    // Should detect closure contradiction
    expect(structured.divergences.some((d) => d.includes("closed"))).toBe(true);
    // operationalSummary should mention disagreements
    expect(structured.operationalSummary).toContain("disagreements");
  });

  it("L7: noisy search results with irrelevant content still produces safe output", () => {
    const poi = makePoi({
      name: "Chez Paul",
      category: "Restaurant or Bar",
      tags: { amenity: "restaurant" },
    });
    const enrichment = {
      rating: null, reviewCount: null, hours: null,
      specialty: null, summary: null, translatedSummary: null,
      priceLevel: null, locality: "Somewhere",
    };
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "Random blog", url: "https://random.com/1", content: "List of restaurants in France" },
      { engine: "bing", title: "Another blog", url: "https://random.com/2", content: "Top 10 places to eat" },
      { engine: "duckduckgo", title: "Directory", url: "https://random.com/3", content: "Business directory listing" },
    ];
    const structured = buildStructuredContent(poi, enrichment, snippets, null, "en");
    // Should still produce output, not crash
    expect(structured.headline).not.toBeNull();
    expect(structured.cautions.length).toBeGreaterThan(0);
    // No reputation platforms -> caution about reliability
    expect(structured.cautions.some((c) => c.toLowerCase().includes("rating"))).toBe(true);
  });
});

// ===========================================================================
// FVM-J: UI Rendering Verification (structural tests)
// ===========================================================================

describe("FVM-J: UI Rendering Verification", () => {
  it("J1: essentials is derived from structured (not old free-text fields)", () => {
    const poi = makePoi();
    const enrichment = {
      rating: 4.0, reviewCount: 50, hours: "9-17",
      specialty: "Bistro", summary: "Good restaurant",
      translatedSummary: null, priceLevel: 2, locality: "Lyon",
    };
    const snippets = makeSnippets(3);
    const structured = buildStructuredContent(poi, enrichment, snippets, null, "en");
    const essentials = buildEssentialsText(structured);
    // essentials should contain content from structured fields
    expect(essentials).not.toBeNull();
    if (structured.headline) expect(essentials).toContain(structured.headline);
    // Not just the old summary field
    expect(essentials!.length).toBeGreaterThan(50);
  });

  it("J2: structured cautions are surfaced in essentials", () => {
    const poi = makePoi();
    const poorEnrichment = {
      rating: null, reviewCount: null, hours: null,
      specialty: null, summary: null, translatedSummary: null,
      priceLevel: null, locality: null,
    };
    const structured = buildStructuredContent(poi, poorEnrichment, [], null, "en");
    const essentials = buildEssentialsText(structured);
    expect(essentials).not.toBeNull();
    expect(essentials).toContain("Cautions:");
  });

  it("J3: divergences are surfaced in essentials", () => {
    const poi = makePoi();
    const enrichment = {
      rating: 4.0, reviewCount: 20, hours: "9-17",
      specialty: "Cafe", summary: "Cafe", translatedSummary: null,
      priceLevel: null, locality: null,
    };
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "A", url: "https://a.com", content: "Open 9h00-17h00" },
      { engine: "bing", title: "B", url: "https://b.com", content: "Open 10h00-22h00" },
    ];
    const structured = buildStructuredContent(poi, enrichment, snippets, null, "en");
    if (structured.divergences.length > 0) {
      const essentials = buildEssentialsText(structured);
      expect(essentials).toContain("Divergences:");
    }
  });

  it("J4: ENRICHMENT_DISPLAY_ORDER has exactly 8 entries matching structured fields", () => {
    expect(ENRICHMENT_DISPLAY_ORDER).toHaveLength(8);
    const structuredKeys = ["headline", "operationalSummary", "practicalities", "cautions", "divergences", "unknowns", "sourceRollup", "sourceConfirmation"];
    for (const key of structuredKeys) {
      expect((ENRICHMENT_DISPLAY_ORDER as readonly string[])).toContain(key);
    }
  });
});
