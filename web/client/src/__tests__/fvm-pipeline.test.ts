// ---------------------------------------------------------------------------
// FVM — pipeline integration, stability checks, reference snapshots
// (split from fvm.test.ts)
// ---------------------------------------------------------------------------
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { enrichBatch, enrichPoi, isGenericPoiName } from "../lib/enrichment/enricher";
import { buildStructuredContent } from "../lib/enrichment/structured";
import { getEnrichabilityPolicy } from "../lib/poi-config";
import type { EnrichmentStructuredContent, SearchSnippet } from "../types";
import { makePoi, makeSnippets } from "./fvm-helpers";

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
// N. Perf And Stability Checks (structural, not load)
// ===========================================================================

describe("FVM-N: Stability Checks", () => {
  it("N3: buildStructuredContent handles empty inputs gracefully", () => {
    const poi = makePoi();
    const emptyEnrichment = {
      rating: null,
      reviewCount: null,
      hours: null,
      description: null,
      priceLevel: null,
      locality: null,
    };
    // Should not throw
    const structured = buildStructuredContent(poi, emptyEnrichment, [], null, "en");
    expect(structured).toBeDefined();
    expect(structured.headline).not.toBeNull();
    expect(structured.practicalities).toEqual(expect.any(Array));
    expect(structured.cautions).toEqual(expect.any(Array));
    expect(structured.unknowns).toEqual(expect.any(Array));
    expect(structured.sourceRollup).toEqual(expect.any(Array));
  });

  it("N5: duplicate snippets in buildStructuredContent produce deduplicated sourceRollup", () => {
    const poi = makePoi();
    const enrichment = {
      rating: null,
      reviewCount: null,
      hours: null,
      description: null,
      priceLevel: null,
      locality: null,
    };
    const dupeSnippets: SearchSnippet[] = [
      {
        title: "Same source",
        url: "https://www.google.com/maps/place/test",
        content: "Review 1",
        engine: "google",
      },
      {
        title: "Same source again",
        url: "https://www.google.com/maps/place/test2",
        content: "Review 2",
        engine: "google",
      },
    ];
    const structured = buildStructuredContent(poi, enrichment, dupeSnippets, null, "en");
    // Both are from google_maps platform -> should be grouped into one digest
    const googleDigests = structured.sourceRollup.filter((d) => d.platform === "google_maps");
    expect(googleDigests).toHaveLength(1);
  });
});

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
        {
          title: "Google result",
          url: "https://google.com/maps/place/test",
          content: "Great restaurant near route",
          engine: "google",
          score: 1,
        },
        {
          title: "Yelp result",
          url: "https://yelp.com/biz/test",
          content: "Good food and atmosphere",
          engine: "bing",
          score: 0.8,
        },
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
    expect(result.description).not.toBeNull();
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
        return new Response(
          JSON.stringify({
            results: [
              {
                title: "Result",
                url: "https://example.com",
                content: "Content here",
                engine: "google",
              },
            ],
            query: "test",
          }),
          {
            status: 200,
            headers: { "Content-Type": "application/json" },
          },
        );
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
        return new Response(
          JSON.stringify({
            results: [
              { title: "R", url: "https://g.com", content: "Review text", engine: "google" },
            ],
            query: "q",
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
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
// FVM-N: Additional Stability Checks
// ===========================================================================

describe("FVM-N: Additional Stability Checks", () => {
  it("N-noWebGPU: absence of WebGPU keeps useful behavior (deterministic fallback)", () => {
    // Simulate no WebGPU: isEngineReady returns false, structured content still built
    const poi = makePoi({ category: "Restaurant or Bar" });
    const enrichment = {
      rating: 4.0,
      reviewCount: 30,
      hours: "10-22",
      description: null,
      priceLevel: 2,
      locality: "Grenoble",
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
      rating: 3.5,
      reviewCount: 15,
      hours: "11-21",
      description: "Average brasserie",
      priceLevel: 1,
      locality: "Montélimar",
    };
    const snippets: SearchSnippet[] = [
      {
        engine: "google",
        title: "G",
        url: "https://google.com/maps/test",
        content: "Good cheap food",
      },
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
        rating: 4.0,
        reviewCount: 20,
        hours: "9-18",
        description: "Test summary",
        priceLevel: 2,
        locality: "Lyon",
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
      rating: 4.4,
      reviewCount: 250,
      hours: "Tue-Sat 12:00-14:00, 19:00-22:00",
      description:
        "Bouchon lyonnais traditionnel avec portions genereuses et selection de vins locaux.",
      priceLevel: 2,
      locality: "Lyon",
    };
    const snippets: SearchSnippet[] = [
      {
        engine: "google",
        title: "Google Maps",
        url: "https://google.com/maps/place/le-petit-bouchon",
        content: "4.4 stars (250 reviews). Traditional Lyonnaise cuisine, terrace, cash only.",
      },
      {
        engine: "bing",
        title: "TripAdvisor",
        url: "https://tripadvisor.fr/le-petit-bouchon",
        content: "Excellent bouchon, must try quenelles and tablier de sapeur. Menu 22€.",
      },
      {
        engine: "duckduckgo",
        title: "Yelp",
        url: "https://yelp.fr/biz/le-petit-bouchon",
        content: "Authentic Lyon experience. Book ahead for Friday dinner.",
      },
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
      rating: 4.7,
      reviewCount: 35,
      hours: "Tue-Sun 6:30-13:00",
      description: "Village bakery, great bread, closed Mondays.",
      priceLevel: 1,
      locality: "Saint-Agrève",
    };
    const snippets: SearchSnippet[] = [
      {
        engine: "google",
        title: "Google",
        url: "https://google.com/maps/bakery",
        content: "4.7/5 (35 reviews). Best bread in the area. Opens early.",
      },
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
      rating: 4.0,
      reviewCount: 60,
      hours: "Apr-Oct",
      description: "Riverside camping, quiet, basic facilities.",
      priceLevel: 1,
      locality: "Ardèche",
    };
    const snippets: SearchSnippet[] = [
      {
        engine: "google",
        title: "Google",
        url: "https://google.com/maps/camping",
        content: "4.0/5 (60 reviews). Riverside camping.",
      },
      {
        engine: "bing",
        title: "Booking",
        url: "https://booking.com/camping-oliviers",
        content: "Rated 7.5/10 on Booking. Pitch from 12€. Check-in 15:00.",
      },
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
      rating: 4.6,
      reviewCount: 80,
      hours: "Mon-Sat 9:00-18:00",
      description: "Well-equipped bike shop with repair service. Quick turnaround.",
      priceLevel: 2,
      locality: "Aubenas",
    };
    const snippets: SearchSnippet[] = [
      {
        engine: "google",
        title: "Google",
        url: "https://google.com/maps/cycles",
        content: "4.6/5 (80 reviews). Full repair service, spare parts.",
      },
      {
        engine: "bing",
        title: "Yelp",
        url: "https://yelp.fr/biz/cycles",
        content: "Great bike shop, fixed my derailleur in 30 min.",
      },
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
      rating: null,
      reviewCount: null,
      hours: null,
      description: null,
      priceLevel: null,
      locality: "Unknown village",
    };
    const snippets: SearchSnippet[] = [
      {
        engine: "google",
        title: "Facebook",
        url: "https://facebook.com/snackducoin",
        content: "Snack du Coin page.",
      },
    ];
    const structured = buildStructuredContent(poi, enrichment, snippets, null, "en");
    expect(structured.cautions.length).toBeGreaterThan(0);
    // Only social source -> reliability caution
    expect(structured.cautions.some((c) => c.includes("social") || c.includes("reliability"))).toBe(
      true,
    );
    expect(structured.sourceConfirmation).toBe("none");
  });

  it("L6: contradictory case with hours and rating divergences", () => {
    const poi = makePoi({
      name: "Café Ambivalent",
      category: "Restaurant or Bar",
      tags: { amenity: "cafe" },
    });
    const enrichment = {
      rating: 3.5,
      reviewCount: 40,
      hours: "8:00-20:00",
      description: "Mixed reviews",
      priceLevel: 1,
      locality: "Privas",
    };
    const snippets: SearchSnippet[] = [
      {
        engine: "google",
        title: "Google",
        url: "https://google.com/maps/cafe",
        content: "4.5/5 stars. Open 8h00-20h00",
      },
      {
        engine: "bing",
        title: "TripAdvisor",
        url: "https://tripadvisor.fr/cafe",
        content: "2.1/5 stars. Open 9h00-18h00. Terrible service.",
      },
      {
        engine: "duckduckgo",
        title: "Blog",
        url: "https://blog.com/cafe",
        content: "Permanently closed according to locals.",
      },
      {
        engine: "google",
        title: "Other",
        url: "https://review.com/cafe",
        content: "Excellent coffee, open daily.",
      },
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
      rating: null,
      reviewCount: null,
      hours: null,
      description: null,
      priceLevel: null,
      locality: "Somewhere",
    };
    const snippets: SearchSnippet[] = [
      {
        engine: "google",
        title: "Random blog",
        url: "https://random.com/1",
        content: "List of restaurants in France",
      },
      {
        engine: "bing",
        title: "Another blog",
        url: "https://random.com/2",
        content: "Top 10 places to eat",
      },
      {
        engine: "duckduckgo",
        title: "Directory",
        url: "https://random.com/3",
        content: "Business directory listing",
      },
    ];
    const structured = buildStructuredContent(poi, enrichment, snippets, null, "en");
    // Should still produce output, not crash
    expect(structured.headline).not.toBeNull();
    expect(structured.cautions.length).toBeGreaterThan(0);
    // No reputation platforms -> caution about reliability
    expect(structured.cautions.some((c) => c.toLowerCase().includes("rating"))).toBe(true);
  });
});
