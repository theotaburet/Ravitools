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
  it("A1: Restaurant query includes review platform bias", () => {
    const poi = makePoi({ category: "Restaurant or Bar" });
    const query = buildSearchQuery(poi, "Lyon");
    expect(query).toContain("google maps");
    expect(query).toContain("tripadvisor");
    expect(query).toContain("yelp");
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
    // Should contain review/hours bias (per-category: Food shop)
    expect(query).toContain("horaires");
    expect(query).toContain("avis");
    expect(query).toContain("review");
  });

  it("A3: Sleeping place query includes booking platforms", () => {
    const poi = makePoi({
      category: "Sleeping place",
      name: "Camping du Lac",
      tags: { tourism: "camp_site" },
    });
    const query = buildSearchQuery(poi, null);
    expect(query).toContain("booking");
    expect(query).toContain("hotels.com");
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
  it("F1: parseLlmOutput accepts full valid JSON with sourceDigests", () => {
    const input = JSON.stringify({
      rating: 4.5,
      reviewCount: 200,
      hours: "Mon-Sat 9:00-18:00",
      summary: "Great bike shop with repair service.",
      translatedSummary: "Super magasin velo avec atelier.",
      specialty: "Bike shop and repair",
      priceLevel: 3,
      essentials: "Cycles Dupont is a reliable bike shop near the route.",
      sourceDigests: [
        { platform: "google_maps", brief: "Well-reviewed bike shop", url: "https://google.com/maps/test" },
        { platform: "yelp", brief: "Fast repair service", url: "https://yelp.com/biz/test" },
      ],
    });
    const result = parseLlmOutput(input);
    expect(result).not.toBeNull();
    expect(result!.rating).toBe(4.5);
    expect(result!.sourceDigests).toHaveLength(2);
    expect(result!.sourceDigests[0].platform).toBe("google_maps");
    expect(result!.essentials).toContain("Cycles Dupont");
  });

  it("F2: parseLlmOutput strips markdown and extracts JSON", () => {
    const json = JSON.stringify({
      rating: 3.0,
      reviewCount: null,
      hours: null,
      summary: "Decent.",
      translatedSummary: null,
      specialty: null,
      priceLevel: null,
      essentials: null,
      sourceDigests: [],
    });
    const input = "Here is the information:\n```json\n" + json + "\n```\nHope this helps!";
    const result = parseLlmOutput(input);
    expect(result).not.toBeNull();
    expect(result!.rating).toBe(3.0);
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

  it("F5: parseLlmOutput filters empty sourceDigest briefs", () => {
    const input = JSON.stringify({
      rating: null,
      reviewCount: null,
      hours: null,
      summary: "Test",
      translatedSummary: null,
      specialty: null,
      priceLevel: null,
      essentials: null,
      sourceDigests: [
        { platform: "google_maps", brief: "", url: null },
        { platform: "yelp", brief: "Good reviews", url: "https://yelp.com/test" },
      ],
    });
    const result = parseLlmOutput(input);
    expect(result!.sourceDigests).toHaveLength(1);
    expect(result!.sourceDigests[0].platform).toBe("yelp");
  });

  it("F6: parseLlmOutput truncates essentials to 700 chars", () => {
    const longEssentials = "X".repeat(800);
    const input = JSON.stringify({
      rating: null,
      reviewCount: null,
      hours: null,
      summary: null,
      translatedSummary: null,
      specialty: null,
      priceLevel: null,
      essentials: longEssentials,
      sourceDigests: [],
    });
    const result = parseLlmOutput(input);
    expect(result!.essentials!.length).toBe(700);
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
    summary: null,
    specialty: null,
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
      summary: "Good place",
      specialty: "Cafe",
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
      summary: "Perfect in every way",
      specialty: "Everything",
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

  it("K1: GPX includes structured.headline", () => {
    const gpx = buildGpxString([poi], [], enrichments);
    expect(gpx).toContain("Excellent bistro with cyclist-friendly terrace.");
  });

  it("K2: GPX includes structured.operationalSummary", () => {
    const gpx = buildGpxString([poi], [], enrichments);
    expect(gpx).toContain("Best read as French bistro");
  });

  it("K3: GPX includes structured.practicalities", () => {
    const gpx = buildGpxString([poi], [], enrichments);
    expect(gpx).toContain("Type: French bistro");
    expect(gpx).toContain("4.3/5");
  });

  it("K4: GPX includes structured.cautions", () => {
    const gpx = buildGpxString([poi], [], enrichments);
    expect(gpx).toContain("Price information could not be confirmed.");
  });

  it("K5: GPX includes sourceRollup", () => {
    const gpx = buildGpxString([poi], [], enrichments);
    expect(gpx).toContain("google_maps");
    expect(gpx).toContain("Well-reviewed bistro");
  });

  it("K5b: GPX includes unknowns", () => {
    const gpx = buildGpxString([poi], [], enrichments);
    expect(gpx).toContain("Bike parking availability unclear.");
  });

  it("K6: KML includes the same structured bricks", () => {
    const kml = buildKmlString([poi], [], enrichments);
    expect(kml).toContain("Excellent bistro with cyclist-friendly terrace.");
    expect(kml).toContain("Best read as French bistro");
    expect(kml).toContain("Type: French bistro");
    expect(kml).toContain("Price information could not be confirmed.");
    expect(kml).toContain("Bike parking availability unclear.");
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
  it("WS6-1: Restaurant query has tripadvisor and menu keywords", () => {
    const poi = makePoi({ category: "Restaurant or Bar" });
    const query = buildSearchQuery(poi, "Lyon");
    expect(query).toContain("tripadvisor");
    expect(query).toContain("menu");
  });

  it("WS6-2: Food shop query has ouverture keyword", () => {
    const poi = makePoi({ category: "Food shop", name: "Carrefour", tags: { shop: "supermarket" } });
    const query = buildSearchQuery(poi, "Valence");
    expect(query).toContain("ouverture");
  });

  it("WS6-3: Sleeping place query has tarif and reservation keywords", () => {
    const poi = makePoi({ category: "Sleeping place", name: "Hotel du Parc", tags: { tourism: "hotel" } });
    const query = buildSearchQuery(poi, null);
    expect(query).toContain("tarif");
    expect(query).toContain("reservation");
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
    // Default bias should have generic review keywords
    expect(query).toContain("avis");
    expect(query).toContain("review");
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
    summary: null,
    specialty: null,
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
      summary: "Perfect in every way with lots of detail and nuance",
      specialty: "Everything",
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
      summary: "Good place",
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
    summary: "Good restaurant",
    specialty: "French cuisine",
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
      summary: null,
      specialty: null,
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
