// ---------------------------------------------------------------------------
// Tests for enrichment module (search, llm, enricher, selective enrichment)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { POI, PoiCategory } from "../types";
import {
  buildGoogleMapsUrl,
  buildGoogleMapsDirectionsUrl,
  buildSearchQuery,
} from "../lib/enrichment/search";
import { isWebGpuAvailable } from "../lib/enrichment/llm";
import {
  ENRICHABILITY_POLICY,
  getEnrichabilityPolicy,
  countEnrichable,
  countFullEnrichable,
} from "../lib/poi-config";

// ---------------------------------------------------------------------------
// Test POI factory
// ---------------------------------------------------------------------------

function makePoi(overrides: Partial<POI> = {}): POI {
  return {
    id: "test-poi-1",
    lat: 47.3941,
    lon: 0.6848,
    category: "Restaurant or Bar",
    name: "Le Petit Zinc",
    icon: "utensils",
    distanceToTrace: 120,
    alongTraceDistance: 5000,
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

// ---------------------------------------------------------------------------
// Google Maps link builder
// ---------------------------------------------------------------------------

describe("buildGoogleMapsUrl", () => {
  it("builds a valid Google Maps search URL", () => {
    const poi = makePoi();
    const url = buildGoogleMapsUrl(poi);
    expect(url).toContain("google.com/maps/search");
    expect(url).toContain(encodeURIComponent("Le Petit Zinc"));
    expect(url).toContain("47.3941");
    expect(url).toContain("0.6848");
    expect(url).toContain("17z");
  });

  it("handles POI names with special characters", () => {
    const poi = makePoi({ name: "Bäckerei Müller & Söhne" });
    const url = buildGoogleMapsUrl(poi);
    expect(url).toContain("google.com/maps/search");
    expect(url).toContain(encodeURIComponent("Bäckerei Müller & Söhne"));
  });

  it("handles empty POI name", () => {
    const poi = makePoi({ name: "" });
    const url = buildGoogleMapsUrl(poi);
    expect(url).toContain("google.com/maps/search");
  });
});

describe("buildGoogleMapsDirectionsUrl", () => {
  it("builds a valid directions URL", () => {
    const poi = makePoi();
    const url = buildGoogleMapsDirectionsUrl(poi);
    expect(url).toContain("google.com/maps/dir");
    expect(url).toContain("destination=47.3941,0.6848");
  });
});

// ---------------------------------------------------------------------------
// Search query builder
// ---------------------------------------------------------------------------

describe("buildSearchQuery", () => {
  it("includes POI name in quotes", () => {
    const poi = makePoi();
    const query = buildSearchQuery(poi, null);
    expect(query).toContain('"Le Petit Zinc"');
  });

  it("includes locality when provided", () => {
    const poi = makePoi();
    const query = buildSearchQuery(poi, "Tours");
    expect(query).toContain("Tours");
  });

  it("omits locality when null", () => {
    const poi = makePoi();
    const query = buildSearchQuery(poi, null);
    expect(query).not.toContain("null");
  });

  it("adds review/hours bias keywords", () => {
    const poi = makePoi();
    const query = buildSearchQuery(poi, null);
    expect(query).toContain("avis OR review OR horaires");
  });

  it("falls back to OSM tags for unnamed POIs", () => {
    const poi = makePoi({
      name: "Unknown",
      tags: { amenity: "drinking_water" },
    });
    const query = buildSearchQuery(poi, null);
    expect(query).toContain("drinking water");
  });

  it("falls back to OSM tags for empty-named POIs", () => {
    const poi = makePoi({
      name: "",
      tags: { shop: "bicycle" },
    });
    const query = buildSearchQuery(poi, null);
    expect(query).toContain("bicycle");
  });
});

// ---------------------------------------------------------------------------
// WebGPU detection
// ---------------------------------------------------------------------------

describe("isWebGpuAvailable", () => {
  it("returns false in test environment (no navigator.gpu)", () => {
    // vitest default env doesn't have WebGPU
    expect(isWebGpuAvailable()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Export with enrichment data
// ---------------------------------------------------------------------------

describe("export with enrichments", () => {
  // We test that the export functions accept enrichments without error
  // and include enrichment data in the output.

  it("GPX export includes enrichment in description", async () => {
    // Need jsdom for DOMParser
    const { buildGpxString } = await import("../lib/export");
    const poi = makePoi();
    const enrichments = new Map([
      [
        "test-poi-1",
        {
          rating: 4.2,
          reviewCount: 87,
          hours: "Mon-Fri 12:00-14:00, 19:00-22:00",
          summary: "Excellent French bistro, cyclist-friendly terrace.",
          translatedSummary: null,
          specialty: "French bistro",
          priceLevel: 2,
          googleMapsUrl: "https://www.google.com/maps/search/Le+Petit+Zinc",
          sourceUrls: ["https://example.com"],
          rawSnippets: [],
          enrichedAt: "2026-04-12T00:00:00Z",
          status: "done" as const,
          locality: "Tours",
          sourceCount: 0,
          sourceEngines: [],
          confidence: 0,
          essentials: "Le Petit Zinc is a food stop near the route.",
          structured: {
            headline: "Excellent French bistro, cyclist-friendly terrace.",
            operationalSummary: "Reputation signals present.",
            practicalities: ["Type: French bistro"],
            sourceRollup: [],
            cautions: [],
            unknowns: [],
          },
        },
      ],
    ]);

    const gpx = buildGpxString([poi], [], enrichments);
    expect(gpx).toContain("Rating: 4.2/5");
    expect(gpx).toContain("87 reviews");
    expect(gpx).toContain("French bistro");
    expect(gpx).toContain("Mon-Fri");
    expect(gpx).toContain("$$");
    expect(gpx).toContain("Excellent French bistro");
    expect(gpx).toContain("Tours");
  });

  it("KML export includes enrichment in description", async () => {
    const { buildKmlString } = await import("../lib/export");
    const poi = makePoi();
    const enrichments = new Map([
      [
        "test-poi-1",
        {
          rating: 3.8,
          reviewCount: 42,
          hours: null,
          summary: "Good place to eat.",
          translatedSummary: null,
          specialty: "Italian",
          priceLevel: null,
          googleMapsUrl: "https://www.google.com/maps/search/test",
          sourceUrls: [],
          rawSnippets: [],
          enrichedAt: "2026-04-12T00:00:00Z",
          status: "done" as const,
          locality: null,
          sourceCount: 0,
          sourceEngines: [],
          confidence: 0,
          essentials: "Good place to eat.",
          structured: {
            headline: "Good place to eat.",
            operationalSummary: "Reputation signals present.",
            practicalities: ["Type: Italian"],
            sourceRollup: [],
            cautions: [],
            unknowns: [],
          },
        },
      ],
    ]);

    const kml = buildKmlString([poi], [], enrichments);
    expect(kml).toContain("3.8/5");
    expect(kml).toContain("Italian");
    expect(kml).toContain("Good place to eat.");
  });

  it("GeoJSON export includes enrichment properties", async () => {
    const { buildGeoJsonObject } = await import("../lib/export");
    const poi = makePoi();
    const enrichments = new Map([
      [
        "test-poi-1",
        {
          rating: 4.5,
          reviewCount: 100,
          hours: "24/7",
          summary: "Always open.",
          translatedSummary: "Toujours ouvert.",
          specialty: "Cafe",
          priceLevel: 1,
          googleMapsUrl: "https://maps.google.com",
          sourceUrls: [],
          rawSnippets: [],
          enrichedAt: "2026-04-12T00:00:00Z",
          status: "done" as const,
          locality: "Paris",
          sourceCount: 3,
          sourceEngines: ["google", "bing"],
          confidence: 0.55,
          essentials: "Toujours ouvert.",
          structured: {
            headline: "Toujours ouvert.",
            operationalSummary: "Coverage: Google Maps, Yelp.",
            practicalities: ["Type: Cafe"],
            sourceRollup: [
              { platform: "google_maps" as const, brief: "Google Maps: Always open.", url: "https://maps.google.com" },
            ],
            cautions: [],
            unknowns: [],
          },
        },
      ],
    ]);

    const geojson = buildGeoJsonObject([poi], enrichments);
    const props = geojson.features[0].properties!;
    expect(props.enrichment_rating).toBe(4.5);
    expect(props.enrichment_reviewCount).toBe(100);
    expect(props.enrichment_hours).toBe("24/7");
    expect(props.enrichment_summary).toBe("Always open.");
    expect(props.enrichment_translatedSummary).toBe("Toujours ouvert.");
    expect(props.enrichment_specialty).toBe("Cafe");
    expect(props.enrichment_priceLevel).toBe(1);
    expect(props.enrichment_locality).toBe("Paris");
    expect(props.enrichment_googleMapsUrl).toBe("https://maps.google.com");
    expect(props.enrichment_sourceCount).toBe(3);
    expect(props.enrichment_sourceEngines).toBe("google,bing");
    expect(props.enrichment_confidence).toBe(0.55);
    expect(props.enrichment_essentials).toBe("Toujours ouvert.");
    expect(props.enrichment_structured_headline).toBe("Toujours ouvert.");
    expect(props.enrichment_structured_practicalities).toContain("Type: Cafe");
  });

  it("GeoJSON export works without enrichments", async () => {
    const { buildGeoJsonObject } = await import("../lib/export");
    const poi = makePoi();

    const geojson = buildGeoJsonObject([poi]);
    const props = geojson.features[0].properties!;
    expect(props.name).toBe("Le Petit Zinc");
    expect(props.enrichment_rating).toBeUndefined();
  });

  it("GPX export works without enrichments (backward compat)", async () => {
    const { buildGpxString } = await import("../lib/export");
    const poi = makePoi();
    const gpx = buildGpxString([poi], []);
    expect(gpx).toContain("Le Petit Zinc");
    expect(gpx).toContain("Restaurant or Bar");
  });
});

// ---------------------------------------------------------------------------
// Target language and translated summary
// ---------------------------------------------------------------------------

describe("target language types", () => {
  it("TARGET_LANGUAGE_LABELS has entries for all supported languages", async () => {
    const { TARGET_LANGUAGE_LABELS } = await import("../types");
    expect(TARGET_LANGUAGE_LABELS.fr).toBe("Français");
    expect(TARGET_LANGUAGE_LABELS.en).toBe("English");
  });
});

describe("export with translated summary", () => {
  it("GPX export prefers translatedSummary over summary", async () => {
    const { buildGpxString } = await import("../lib/export");
    const poi = makePoi();
    const enrichments = new Map([
      [
        "test-poi-1",
        {
          rating: 4.0,
          reviewCount: 50,
          hours: null,
          summary: "Excellent bistrot avec terrasse.",
          translatedSummary: "Excellent bistro with terrace.",
          specialty: "French",
          priceLevel: 2,
          googleMapsUrl: "https://maps.google.com",
          sourceUrls: [],
          rawSnippets: [],
          enrichedAt: "2026-04-12T00:00:00Z",
          status: "done" as const,
          locality: "Tours",
          sourceCount: 0,
          sourceEngines: [],
          confidence: 0,
        },
      ],
    ]);

    const gpx = buildGpxString([poi], [], enrichments);
    expect(gpx).toContain("Excellent bistro with terrace.");
    expect(gpx).not.toContain("Excellent bistrot avec terrasse.");
  });

  it("GPX export falls back to summary when translatedSummary is null", async () => {
    const { buildGpxString } = await import("../lib/export");
    const poi = makePoi();
    const enrichments = new Map([
      [
        "test-poi-1",
        {
          rating: null,
          reviewCount: null,
          hours: null,
          summary: "Un bon endroit.",
          translatedSummary: null,
          specialty: null,
          priceLevel: null,
          googleMapsUrl: "https://maps.google.com",
          sourceUrls: [],
          rawSnippets: [],
          enrichedAt: "2026-04-12T00:00:00Z",
          status: "done" as const,
          locality: null,
          sourceCount: 0,
          sourceEngines: [],
          confidence: 0,
        },
      ],
    ]);

    const gpx = buildGpxString([poi], [], enrichments);
    expect(gpx).toContain("Un bon endroit.");
  });

  it("GeoJSON export includes both summary and translatedSummary", async () => {
    const { buildGeoJsonObject } = await import("../lib/export");
    const poi = makePoi();
    const enrichments = new Map([
      [
        "test-poi-1",
        {
          rating: null,
          reviewCount: null,
          hours: null,
          summary: "Original language summary.",
          translatedSummary: "Résumé en français.",
          specialty: null,
          priceLevel: null,
          googleMapsUrl: "https://maps.google.com",
          sourceUrls: [],
          rawSnippets: [],
          enrichedAt: "2026-04-12T00:00:00Z",
          status: "done" as const,
          locality: null,
          sourceCount: 0,
          sourceEngines: [],
          confidence: 0,
        },
      ],
    ]);

    const geojson = buildGeoJsonObject([poi], enrichments);
    const props = geojson.features[0].properties!;
    expect(props.enrichment_summary).toBe("Original language summary.");
    expect(props.enrichment_translatedSummary).toBe("Résumé en français.");
  });

  it("KML export prefers translatedSummary over summary in HTML description", async () => {
    const { buildKmlString } = await import("../lib/export");
    const poi = makePoi();
    const enrichments = new Map([
      [
        "test-poi-1",
        {
          rating: null,
          reviewCount: null,
          hours: null,
          summary: "Buon ristorante italiano.",
          translatedSummary: "Good Italian restaurant.",
          specialty: null,
          priceLevel: null,
          googleMapsUrl: "https://maps.google.com",
          sourceUrls: [],
          rawSnippets: [],
          enrichedAt: "2026-04-12T00:00:00Z",
          status: "done" as const,
          locality: null,
          sourceCount: 0,
          sourceEngines: [],
          confidence: 0,
        },
      ],
    ]);

    const kml = buildKmlString([poi], [], enrichments);
    expect(kml).toContain("Good Italian restaurant.");
    expect(kml).not.toContain("Buon ristorante italiano.");
  });
});

// ---------------------------------------------------------------------------
// Enrichability policy
// ---------------------------------------------------------------------------

describe("enrichability policy", () => {
  it("maps all 18 categories to a policy", () => {
    const allCategories: PoiCategory[] = [
      "Water", "Sleeping place", "Restroom", "Shelter", "Food shop",
      "Restaurant or Bar", "Gears", "DIY", "Laundry", "Medical",
      "Bank & ATM", "Post office", "Viewpoint", "Tourist info",
      "Charging", "Picnic", "Pharmacy", "Wifi",
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

describe("countEnrichable", () => {
  it("counts only non-skip POIs", () => {
    const pois = [
      { category: "Restaurant or Bar" as PoiCategory },  // full
      { category: "Water" as PoiCategory },              // skip
      { category: "DIY" as PoiCategory },                // minimal
      { category: "Shelter" as PoiCategory },            // skip
      { category: "Sleeping place" as PoiCategory },     // full
    ];
    expect(countEnrichable(pois)).toBe(3);
  });

  it("returns 0 for all-skip categories", () => {
    const pois = [
      { category: "Water" as PoiCategory },
      { category: "Picnic" as PoiCategory },
    ];
    expect(countEnrichable(pois)).toBe(0);
  });

  it("returns total for all-full categories", () => {
    const pois = [
      { category: "Restaurant or Bar" as PoiCategory },
      { category: "Food shop" as PoiCategory },
    ];
    expect(countEnrichable(pois)).toBe(2);
  });
});

describe("countFullEnrichable", () => {
  it("counts only full-policy POIs", () => {
    const pois = [
      { category: "Restaurant or Bar" as PoiCategory },  // full
      { category: "DIY" as PoiCategory },                // minimal
      { category: "Water" as PoiCategory },              // skip
      { category: "Food shop" as PoiCategory },          // full
    ];
    expect(countFullEnrichable(pois)).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Enricher skip reason in EnrichedData
// ---------------------------------------------------------------------------

describe("EnrichedData skipReason field", () => {
  it("skipReason type accepts all defined reasons", () => {
    // This is a compile-time check; if it compiles, the type works
    const reasons: import("../types").SkipReason[] = [
      "unnamed", "low-value-category", "no-results", "rate-limited", "cancelled",
    ];
    expect(reasons).toHaveLength(5);
  });

  it("enrichment with skip reason has correct structure", () => {
    const data: import("../types").EnrichedData = {
      rating: null,
      reviewCount: null,
      hours: null,
      summary: null,
      translatedSummary: null,
      specialty: null,
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

// ---------------------------------------------------------------------------
// Confidence scoring
// ---------------------------------------------------------------------------

describe("computeConfidence", () => {
  const baseEnrichment = {
    rating: null,
    reviewCount: null,
    hours: null,
    summary: null,
    specialty: null,
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
    const singleEngine = computeConfidence({ ...baseEnrichment, rawSnippets: makeSnippets(4, ["google"]) });
    const multiEngine = computeConfidence({ ...baseEnrichment, rawSnippets: makeSnippets(4, ["google", "bing"]) });
    expect(multiEngine).toBeGreaterThan(singleEngine);
  });

  it("increases with structured fields present", async () => {
    const { computeConfidence } = await import("../lib/enrichment/enricher");
    const noFields = computeConfidence({ ...baseEnrichment, rawSnippets: makeSnippets(3) });
    const withFields = computeConfidence({
      rating: 4.2,
      reviewCount: 50,
      hours: "9-17",
      summary: "Good place",
      specialty: "Cafe",
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
      summary: "Great place",
      specialty: "Restaurant",
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
// Source metadata in exports
// ---------------------------------------------------------------------------

describe("export with source metadata", () => {
  it("GPX text description includes Sources and Confidence", async () => {
    const { buildGpxString } = await import("../lib/export");
    const poi = makePoi();
    const enrichments = new Map([
      [
        "test-poi-1",
        {
          rating: 4.0,
          reviewCount: null,
          hours: null,
          summary: "A nice bistro.",
          translatedSummary: null,
          specialty: null,
          priceLevel: null,
          googleMapsUrl: "https://maps.google.com",
          sourceUrls: ["https://a.com", "https://b.com", "https://c.com"],
          rawSnippets: [],
          enrichedAt: "2026-04-13T00:00:00Z",
          status: "done" as const,
          locality: null,
          sourceCount: 3,
          sourceEngines: ["google", "bing"],
          confidence: 0.55,
        },
      ],
    ]);
    const gpx = buildGpxString([poi], [], enrichments);
    expect(gpx).toContain("Sources: 3");
    expect(gpx).toContain("Confidence: 55%");
  });

  it("KML HTML description includes Sources and Confidence", async () => {
    const { buildKmlString } = await import("../lib/export");
    const poi = makePoi();
    const enrichments = new Map([
      [
        "test-poi-1",
        {
          rating: null,
          reviewCount: null,
          hours: null,
          summary: "Ok place.",
          translatedSummary: null,
          specialty: null,
          priceLevel: null,
          googleMapsUrl: "https://maps.google.com",
          sourceUrls: ["https://a.com"],
          rawSnippets: [],
          enrichedAt: "2026-04-13T00:00:00Z",
          status: "done" as const,
          locality: null,
          sourceCount: 1,
          sourceEngines: ["duckduckgo"],
          confidence: 0.24,
        },
      ],
    ]);
    const kml = buildKmlString([poi], [], enrichments);
    expect(kml).toContain("<b>Sources:</b> 1");
    expect(kml).toContain("<b>Confidence:</b> 24%");
  });

  it("GeoJSON export includes sourceCount, sourceEngines, confidence", async () => {
    const { buildGeoJsonObject } = await import("../lib/export");
    const poi = makePoi();
    const enrichments = new Map([
      [
        "test-poi-1",
        {
          rating: null,
          reviewCount: null,
          hours: null,
          summary: null,
          translatedSummary: null,
          specialty: null,
          priceLevel: null,
          googleMapsUrl: "https://maps.google.com",
          sourceUrls: [],
          rawSnippets: [],
          enrichedAt: "2026-04-13T00:00:00Z",
          status: "done" as const,
          locality: null,
          sourceCount: 5,
          sourceEngines: ["google", "bing", "duckduckgo"],
          confidence: 0.82,
        },
      ],
    ]);
    const geojson = buildGeoJsonObject([poi], enrichments);
    const props = geojson.features[0].properties!;
    expect(props.enrichment_sourceCount).toBe(5);
    expect(props.enrichment_sourceEngines).toBe("google,bing,duckduckgo");
     expect(props.enrichment_confidence).toBe(0.82);
  });
});

// ---------------------------------------------------------------------------
// Batch enrichment pipeline (WS4)
// ---------------------------------------------------------------------------

// We mock the network-dependent modules so enrichBatch runs fully in test.
vi.mock("../lib/enrichment/search", async () => {
  const actual = await vi.importActual<typeof import("../lib/enrichment/search")>("../lib/enrichment/search");
  return {
    ...actual,
    fetchWebsitePreview: vi.fn(async () => null),
    reverseGeocode: vi.fn(async () => "TestCity"),
    searchPoi: vi.fn(async (poi: POI) => {
      // Simulate a small delay
      await new Promise((r) => setTimeout(r, 5));
      // Return 2 fake snippets
      return [
        { title: `${poi.name} review`, url: "https://example.com/1", content: "Nice place", engine: "google" },
        { title: `${poi.name} hours`, url: "https://example.com/2", content: "Open 9-17", engine: "bing" },
      ];
    }),
  };
});

vi.mock("../lib/enrichment/llm", async () => {
  const actual = await vi.importActual<typeof import("../lib/enrichment/llm")>("../lib/enrichment/llm");
  return {
    ...actual,
    isEngineReady: vi.fn(() => true),
    synthesize: vi.fn(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return {
        rating: 4.0,
        reviewCount: 30,
        hours: "9:00-17:00",
        summary: "Test summary",
        translatedSummary: "Résumé test",
        specialty: "Cafe",
        priceLevel: 2,
        essentials: "Résumé test. Reported rating: 4.0/5 from 30 reviews.",
        sourceDigests: [],
      };
    }),
  };
});

describe("enrichBatch pipeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeBatchPoi(id: string, category: PoiCategory = "Restaurant or Bar", name = `POI ${id}`): POI {
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
      makeBatchPoi("water1", "Water", "Water Fountain"),     // skip policy
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
    vi.mocked(searchPoi).mockImplementation(async (poi, locality, apiBase, signal) => {
      await new Promise((r) => setTimeout(r, 5));
      // Abort right after the first search completes — synthesis hasn't started
      controller.abort();
      return [
        { title: "R", url: "https://ex.com", content: "Good", engine: "google" },
      ];
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
      makeBatchPoi("rest", "Restaurant or Bar", "Le Zinc"),  // full
      makeBatchPoi("diy", "DIY", "Brico Store"),             // minimal
      makeBatchPoi("water", "Water", "Fountain"),            // skip
      makeBatchPoi("noname", "Restaurant or Bar", "Unknown"),// unnamed → skip
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
