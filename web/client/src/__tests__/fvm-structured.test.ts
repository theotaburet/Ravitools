// FVM: structured content, LLM contract, confidence, divergences
// (split from fvm.test.ts)
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { computeConfidence } from "../lib/enrichment/confidence";
import { buildSystemPrompt, parseLlmOutput } from "../lib/enrichment/llm";
import { buildSearchQuery } from "../lib/enrichment/query-builder";
import {
  buildDivergences,
  buildStructuredContent,
  determineSourceConfirmation,
} from "../lib/enrichment/structured";
import { getOfficialWebsiteUrl } from "../lib/enrichment/websites";
import { t } from "../lib/i18n";
import { ENRICHMENT_CONTRACTS, getEnrichmentContract } from "../lib/poi-config";
import type { SearchSnippet } from "../types";
import { makePoi, makeSnippets } from "./fvm-helpers";

// --- D. Structured Output Core ---

describe("FVM-D: Structured Output Core", () => {
  const richEnrichment = {
    rating: 4.3,
    reviewCount: 120,
    hours: "Mon-Sat 12:00-14:00, 19:00-22:00",
    description: "Excellent bistrot avec terrasse accueillante pour les cyclistes.",
    priceLevel: 2,
    locality: "Lyon",
  };

  const snippets: SearchSnippet[] = [
    {
      title: "Google Review",
      url: "https://www.google.com/maps/place/test",
      content: "Great food and service",
      engine: "google",
    },
    {
      title: "TripAdvisor",
      url: "https://www.tripadvisor.fr/test",
      content: "Lovely terrace for cyclists",
      engine: "bing",
    },
    {
      title: "Yelp review",
      url: "https://www.yelp.fr/biz/test",
      content: "Good value French bistro",
      engine: "duckduckgo",
    },
  ];

  it("D4: produces cautions when info is missing", () => {
    const poi = makePoi();
    const poorEnrichment = {
      rating: null,
      reviewCount: null,
      hours: null,
      description: null,
      priceLevel: null,
      locality: null,
    };
    const structured = buildStructuredContent(poi, poorEnrichment, [], null, "en");
    expect(structured.cautions.length).toBeGreaterThan(0);
    expect(structured.cautions.length).toBeLessThanOrEqual(3);
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
});

// --- E. Category-Specific Structured Rules (contracts exist) ---

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

  it("E4: each contract has banned patterns", () => {
    for (const [, contract] of Object.entries(ENRICHMENT_CONTRACTS)) {
      if (!contract) continue;
      expect(contract.bannedPatterns.length).toBeGreaterThan(0);
    }
  });

  it("each contract has a weak source caution in both languages", () => {
    for (const category of Object.keys(ENRICHMENT_CONTRACTS)) {
      const key = `caution.weakSource.${category}`;
      expect(t(key, "en")).not.toBe(key);
      expect(t(key, "fr")).not.toBe(t(key, "en"));
    }
  });

  it("E9: Restaurant contract bans marketing language", () => {
    const contract = getEnrichmentContract("Restaurant or Bar")!;
    const bannedText = contract.bannedPatterns.join(" ").toLowerCase();
    expect(bannedText).toContain("marketing");
  });

  it("E11: each full category degrades with no sources (cautions appear)", () => {
    for (const category of ["Restaurant or Bar", "Food shop", "Sleeping place", "Gears"] as const) {
      const poi = makePoi({ category, name: `Test ${category}` });
      const emptyEnrichment = {
        rating: null,
        reviewCount: null,
        hours: null,
        description: null,
        priceLevel: null,
        locality: null,
      };
      const structured = buildStructuredContent(poi, emptyEnrichment, [], null, "en");
      expect(structured.cautions.length).toBeGreaterThan(0);
    }
  });
});

// --- F. LLM Output Contract (extends existing parseLlmOutput tests) ---

describe("FVM-F: LLM Output Contract", () => {
  it("parseLlmOutput accepts full valid JSON with new compact format", () => {
    const input = JSON.stringify({
      rating: 4.5,
      reviewCount: 200,
      hours: [{ day: "Mon-Sat", open: "9:00", close: "18:00" }],
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

  it("parseLlmOutput rejects completely invalid output", () => {
    expect(parseLlmOutput("I cannot find any information about this place.")).toBeNull();
    expect(parseLlmOutput("")).toBeNull();
    expect(parseLlmOutput("Sorry, I don't have enough data.")).toBeNull();
  });

  it("parseLlmOutput clamps rating to 1-5 range", () => {
    const tooHigh = JSON.stringify({ rating: 10 });
    expect(parseLlmOutput(tooHigh)!.rating).toBeNull();
    const tooLow = JSON.stringify({ rating: 0 });
    expect(parseLlmOutput(tooLow)!.rating).toBeNull();
    const valid = JSON.stringify({ rating: 4.5 });
    expect(parseLlmOutput(valid)!.rating).toBe(4.5);
  });

  it("parseLlmOutput truncates description to 180 chars", () => {
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

  it("parseLlmOutput truncates review to 180 chars", () => {
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

// --- G. Confidence And Coverage ---

describe("FVM-G: Confidence And Coverage", () => {
  const baseEnrichment = {
    rating: null,
    reviewCount: null,
    hours: null,
    description: null,
    review: null,
  };

  it("G1: confidence increases with more useful sources (below saturation)", () => {
    // sourceFactor = min(snippets/7, 0.7): saturates at ~5 snippets (5/7 ≈ 0.71 → capped 0.7)
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

// --- H. Contradictions And Missing Data ---

describe("FVM-H: Contradictions And Missing Data", () => {
  it("H1: missing hours produces explicit caution", () => {
    const poi = makePoi();
    const enrichment = {
      rating: 4.0,
      reviewCount: 20,
      hours: null,
      description: "Good",
      priceLevel: null,
      locality: null,
    };
    const snippets = makeSnippets(2);
    const structured = buildStructuredContent(poi, enrichment, snippets, null, "en");
    const hoursCaution = structured.cautions.find((c) => c.toLowerCase().includes("hour"));
    expect(hoursCaution).toBeDefined();
  });

  it("H2: missing rating produces explicit caution", () => {
    const poi = makePoi();
    const enrichment = {
      rating: null,
      reviewCount: null,
      hours: "9-17",
      description: "Decent",
      priceLevel: null,
      locality: null,
    };
    const snippets = makeSnippets(2);
    const structured = buildStructuredContent(poi, enrichment, snippets, null, "en");
    const ratingCaution = structured.cautions.find((c) => c.toLowerCase().includes("rating"));
    expect(ratingCaution).toBeDefined();
  });

  it("H3: rating without review count produces a caution", () => {
    const poi = makePoi();
    const enrichment = {
      rating: 4.5,
      reviewCount: null,
      hours: "10-20",
      description: "Nice",
      priceLevel: null,
      locality: null,
    };
    const snippets = makeSnippets(3);
    const structured = buildStructuredContent(poi, enrichment, snippets, null, "en");
    const volumeCaution = structured.cautions.find(
      (c) => c.toLowerCase().includes("volume") || c.toLowerCase().includes("review"),
    );
    expect(volumeCaution).toBeDefined();
  });

  it("H4: no sourceRollup produces a caution about weak coverage", () => {
    const poi = makePoi();
    const enrichment = {
      rating: null,
      reviewCount: null,
      hours: null,
      description: null,
      priceLevel: null,
      locality: null,
    };
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
    const enrichment = {
      rating: null,
      reviewCount: null,
      hours: null,
      description: null,
      priceLevel: null,
      locality: null,
    };
    const structured = buildStructuredContent(poi, enrichment, [], null, "en");
    const officialDigest = structured.sourceRollup.find((d) => d.platform === "official_website");
    expect(officialDigest).toBeUndefined();
  });
});

// --- Category-Specific LLM Prompt Hardening ---

describe("Category-Specific LLM Prompts", () => {
  it("Restaurant prompt carries the banned list but no priority phrases (the 3B model echoes them)", () => {
    const prompt = buildSystemPrompt("en", "Restaurant or Bar");
    expect(prompt).toContain("NEVER include in your output");
    expect(prompt).not.toContain("Cuisine type");
    expect(prompt).not.toContain("terrace");
  });

  it("prompt shows no example values the model could copy (no HH:MM times)", () => {
    expect(buildSystemPrompt("en", "Food shop")).not.toMatch(/\d{1,2}:\d{2}/);
  });

  it("Restaurant prompt bans marketing language", () => {
    const prompt = buildSystemPrompt("en", "Restaurant or Bar");
    expect(prompt).toContain("Marketing language");
  });

  it("Food shop prompt bans invented hours and keeps no priority wording", () => {
    const prompt = buildSystemPrompt("en", "Food shop");
    expect(prompt).toContain("Invented hours from chain typical schedules");
    expect(prompt).not.toContain("resupply");
  });

  it("Sleeping place prompt bans assumed booking requirements", () => {
    const prompt = buildSystemPrompt("en", "Sleeping place");
    expect(prompt).toContain("Assumed booking requirements");
    expect(prompt).not.toContain("Check-in");
  });

  it("Sleeping place prompt bans invented amenity lists", () => {
    const prompt = buildSystemPrompt("en", "Sleeping place");
    expect(prompt).toContain("Invented amenity lists");
  });

  it("Gears prompt bans assumed repair capability", () => {
    const prompt = buildSystemPrompt("en", "Gears");
    expect(prompt).toContain("Assumed repair capability from shop type");
  });

  it("Gears prompt carries no valuable-signal wording the model could echo", () => {
    const prompt = buildSystemPrompt("en", "Gears");
    expect(prompt).not.toContain("Spare parts");
  });

  it("unknown category does not inject contract block", () => {
    const prompt = buildSystemPrompt("en", "Water");
    expect(prompt).not.toContain("Category-specific instructions");
    expect(prompt).not.toContain("Priority fields for essentials");
  });

  it("no category does not inject contract block", () => {
    const prompt = buildSystemPrompt("en");
    expect(prompt).not.toContain("Category-specific instructions");
  });

  it("French language prompt requests French translatedSummary", () => {
    const prompt = buildSystemPrompt("fr", "Restaurant or Bar");
    expect(prompt).toContain("French");
  });

  it("English language prompt requests English translatedSummary", () => {
    const prompt = buildSystemPrompt("en", "Restaurant or Bar");
    expect(prompt).toContain("English");
  });

  it("contract banned patterns appear in NEVER section", () => {
    const prompt = buildSystemPrompt("en", "Food shop");
    expect(prompt).toContain("NEVER include");
    expect(prompt).toContain("Assumed product range");
  });
});

// --- Richer Confidence Formula ---

describe("Richer Confidence Formula", () => {
  const baseEnrichment = {
    rating: null,
    reviewCount: null,
    hours: null,
    description: null,
    review: null,
  };

  it("official website boosts confidence", () => {
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

  it("longer snippet content increases quality factor", () => {
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

  it("snippets from diverse domains increase confidence", () => {
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

  it("confidence still 0 with no snippets", () => {
    expect(computeConfidence({ ...baseEnrichment, rawSnippets: [] })).toBe(0);
  });

  it("all factors combined never exceed 1.0", () => {
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

  it("structured fields each add incremental confidence", () => {
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

// --- Contradiction Confidence Penalty ---

describe("Contradiction Confidence Penalty", () => {
  const baseEnrichment = {
    rating: 4.0,
    reviewCount: 50,
    hours: "9:00-18:00",
    description: "Good restaurant",
    review: "French cuisine",
  };

  it("divergences reduce confidence score", () => {
    const noDivergences = computeConfidence({
      ...baseEnrichment,
      rawSnippets: makeSnippets(5),
    });
    const withDivergences = computeConfidence({
      ...baseEnrichment,
      rawSnippets: makeSnippets(5),
      structured: { divergences: ["Sources report different opening hours: verify locally."] },
    });
    expect(withDivergences).toBeLessThan(noDivergences);
  });

  it("multiple divergences reduce confidence more", () => {
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

  it("contradiction penalty capped at 0.15", () => {
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

  it("confidence never goes below 0 from penalty", () => {
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

  it("empty divergences array has no penalty", () => {
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

// --- Direct Divergence Detection Tests ---

describe("Divergence Detection (buildDivergences)", () => {
  it("detects hours contradictions from different patterns", () => {
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "A", url: "https://a.com", content: "Open 9h00-17h00 weekdays" },
      { engine: "bing", title: "B", url: "https://b.com", content: "Hours: 10h00-18h00 daily" },
    ];
    const divergences = buildDivergences(snippets, "en");
    expect(divergences.some((d) => d.includes("hours"))).toBe(true);
  });

  it("no hours divergence when patterns agree", () => {
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "A", url: "https://a.com", content: "Open 9h00-17h00" },
      { engine: "bing", title: "B", url: "https://b.com", content: "Horaires: 9h00-17h00" },
    ];
    const divergences = buildDivergences(snippets, "en");
    expect(divergences.some((d) => d.includes("hours"))).toBe(false);
  });

  it("detects rating spread >= 1.0", () => {
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "A", url: "https://a.com", content: "Rated 4.5/5 on Google" },
      { engine: "bing", title: "B", url: "https://b.com", content: "Only 3.2/5 stars" },
    ];
    const divergences = buildDivergences(snippets, "en");
    expect(divergences.some((d) => d.includes("Rating varies"))).toBe(true);
  });

  it("no rating divergence when spread < 1.0", () => {
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "A", url: "https://a.com", content: "4.2/5 stars" },
      { engine: "bing", title: "B", url: "https://b.com", content: "4.5/5 stars" },
    ];
    const divergences = buildDivergences(snippets, "en");
    expect(divergences.some((d) => d.includes("Rating varies"))).toBe(false);
  });

  it("detects closure contradiction with positive signals", () => {
    const snippets: SearchSnippet[] = [
      {
        engine: "google",
        title: "Closed",
        url: "https://a.com",
        content: "Permanently closed since 2024",
      },
      {
        engine: "bing",
        title: "Review",
        url: "https://b.com",
        content: "Excellent food, open daily",
      },
    ];
    const divergences = buildDivergences(snippets, "en");
    expect(divergences.some((d) => d.includes("closed"))).toBe(true);
  });

  it("closure without positive signal still warns", () => {
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "Closed", url: "https://a.com", content: "Fermé définitivement" },
      { engine: "bing", title: "Info", url: "https://b.com", content: "No recent updates" },
    ];
    const divergences = buildDivergences(snippets, "en");
    expect(divergences.some((d) => d.toLowerCase().includes("clos"))).toBe(true);
  });

  it("no divergences for clean, consistent snippets", () => {
    const snippets: SearchSnippet[] = [
      { engine: "google", title: "A", url: "https://a.com", content: "Nice bakery in town center" },
      { engine: "bing", title: "B", url: "https://b.com", content: "Great bread and pastries" },
    ];
    const divergences = buildDivergences(snippets, "en");
    expect(divergences).toHaveLength(0);
  });

  it("divergences capped at 3", () => {
    const snippets: SearchSnippet[] = [
      {
        engine: "google",
        title: "A",
        url: "https://a.com",
        content: "Open 9h00-17h00. Rating 4.8/5 stars. Permanently closed.",
      },
      {
        engine: "bing",
        title: "B",
        url: "https://b.com",
        content: "Open 11h00-22h00. Only 2.1/5 stars. Excellent restaurant, highly recommended.",
      },
    ];
    const divergences = buildDivergences(snippets, "en");
    expect(divergences.length).toBeLessThanOrEqual(3);
  });
});

// --- Source Confirmation Tests ---

describe("Source Confirmation (determineSourceConfirmation)", () => {
  it("returns 'both' when official + review platforms present", () => {
    const rollup = [
      { platform: "official_website" as const, brief: "Official", url: "https://example.com" },
      { platform: "google_maps" as const, brief: "Google Maps", url: "https://maps.google.com" },
    ];
    expect(determineSourceConfirmation(rollup)).toBe("both");
  });

  it("returns 'official' when only official present", () => {
    const rollup = [
      { platform: "official_website" as const, brief: "Official", url: "https://example.com" },
    ];
    expect(determineSourceConfirmation(rollup)).toBe("official");
  });

  it("returns 'reviews-only' when only review platforms present", () => {
    const rollup = [
      { platform: "tripadvisor" as const, brief: "Tripadvisor", url: "https://tripadvisor.com" },
      { platform: "yelp" as const, brief: "Yelp", url: "https://yelp.com" },
    ];
    expect(determineSourceConfirmation(rollup)).toBe("reviews-only");
  });

  it("returns 'none' when only social/other platforms", () => {
    const rollup = [
      { platform: "facebook" as const, brief: "Facebook", url: "https://facebook.com" },
      { platform: "instagram" as const, brief: "Instagram", url: "https://instagram.com" },
    ];
    expect(determineSourceConfirmation(rollup)).toBe("none");
  });

  it("returns 'none' when empty", () => {
    expect(determineSourceConfirmation([])).toBe("none");
  });

  it("booking counts as review platform", () => {
    const rollup = [{ platform: "booking" as const, brief: "Booking", url: "https://booking.com" }];
    expect(determineSourceConfirmation(rollup)).toBe("reviews-only");
  });

  it("official + booking = both", () => {
    const rollup = [
      { platform: "official_website" as const, brief: "Official", url: "https://hotel.com" },
      { platform: "booking" as const, brief: "Booking", url: "https://booking.com" },
    ];
    expect(determineSourceConfirmation(rollup)).toBe("both");
  });
});

// --- Sleeping Place with Booking/Hotels.com ---

describe("Sleeping Place Booking Integration", () => {
  it("sleeping place search query includes booking bias", () => {
    const poi = makePoi({ name: "Hotel des Voyageurs", category: "Sleeping place" });
    const query = buildSearchQuery(poi, "Lyon", "fr");
    const lower = query.toLowerCase();
    expect(
      lower.includes("booking") ||
        lower.includes("hotels.com") ||
        lower.includes("tarif") ||
        lower.includes("reservation"),
    ).toBe(true);
  });

  it("sleeping place structured content with booking source", () => {
    const poi = makePoi({ name: "Camping Les Pins", category: "Sleeping place" });
    const snippets: SearchSnippet[] = [
      {
        engine: "google",
        title: "Booking",
        url: "https://booking.com/camping-les-pins",
        content: "Camping Les Pins. Rated 7.8/10 on Booking. Pitch from 15€/night. Check-in 14:00.",
      },
      {
        engine: "bing",
        title: "Google",
        url: "https://google.com/maps/camping",
        content: "Camping Les Pins. 4.1/5 stars (89 reviews). Open April to October.",
      },
    ];
    const enrichment = {
      rating: 4.1,
      reviewCount: 89,
      hours: "April-October",
      description: "Campsite near the route",
      priceLevel: 1,
      locality: "Ardèche",
    };
    const structured = buildStructuredContent(poi, enrichment, snippets, null, "en");
    expect(structured.sourceConfirmation).toBe("reviews-only");
    expect(structured.sourceRollup.some((d) => d.platform === "booking")).toBe(true);
  });

  it("sleeping place with official site + booking = both confirmation", () => {
    const poi = makePoi({ name: "Gîte du Col", category: "Sleeping place" });
    const snippets: SearchSnippet[] = [
      {
        engine: "google",
        title: "Booking",
        url: "https://booking.com/gite-du-col",
        content: "Rated 8.5/10. From 45€/night.",
      },
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
      description: null,
      priceLevel: null,
      locality: "Vercors",
    };
    const structured = buildStructuredContent(poi, enrichment, snippets, websitePreview, "en");
    expect(structured.sourceConfirmation).toBe("both");
    expect(structured.sourceRollup.some((d) => d.platform === "official_website")).toBe(true);
    expect(structured.sourceRollup.some((d) => d.platform === "booking")).toBe(true);
  });
});
