// ---------------------------------------------------------------------------
// Enrichment search helpers – Google Maps URL, search query, WebGPU
// (split from enrichment.test.ts)
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { isWebGpuAvailable } from "../lib/enrichment/llm";
import { buildGoogleMapsUrl, buildSearchQuery } from "../lib/enrichment/search";
import { makePoi } from "./enrichment-helpers";

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
    expect(query).toContain("avis restaurant horaires");
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
