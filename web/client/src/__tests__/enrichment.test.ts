// ---------------------------------------------------------------------------
// Tests for enrichment module (search, llm, enricher)
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { POI } from "../types";
import {
  buildGoogleMapsUrl,
  buildGoogleMapsDirectionsUrl,
  buildSearchQuery,
} from "../lib/enrichment/search";
import { isWebGpuAvailable } from "../lib/enrichment/llm";

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
          specialty: "French bistro",
          priceLevel: 2,
          googleMapsUrl: "https://www.google.com/maps/search/Le+Petit+Zinc",
          sourceUrls: ["https://example.com"],
          rawSnippets: [],
          enrichedAt: "2026-04-12T00:00:00Z",
          status: "done" as const,
          locality: "Tours",
        },
      ],
    ]);

    const gpx = buildGpxString([poi], null, enrichments);
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
          specialty: "Italian",
          priceLevel: null,
          googleMapsUrl: "https://www.google.com/maps/search/test",
          sourceUrls: [],
          rawSnippets: [],
          enrichedAt: "2026-04-12T00:00:00Z",
          status: "done" as const,
          locality: null,
        },
      ],
    ]);

    const kml = buildKmlString([poi], null, enrichments);
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
          specialty: "Cafe",
          priceLevel: 1,
          googleMapsUrl: "https://maps.google.com",
          sourceUrls: [],
          rawSnippets: [],
          enrichedAt: "2026-04-12T00:00:00Z",
          status: "done" as const,
          locality: "Paris",
        },
      ],
    ]);

    const geojson = buildGeoJsonObject([poi], enrichments);
    const props = geojson.features[0].properties!;
    expect(props.enrichment_rating).toBe(4.5);
    expect(props.enrichment_reviewCount).toBe(100);
    expect(props.enrichment_hours).toBe("24/7");
    expect(props.enrichment_summary).toBe("Always open.");
    expect(props.enrichment_specialty).toBe("Cafe");
    expect(props.enrichment_priceLevel).toBe(1);
    expect(props.enrichment_locality).toBe("Paris");
    expect(props.enrichment_googleMapsUrl).toBe("https://maps.google.com");
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
    const gpx = buildGpxString([poi], null);
    expect(gpx).toContain("Le Petit Zinc");
    expect(gpx).toContain("Restaurant or Bar");
  });
});
