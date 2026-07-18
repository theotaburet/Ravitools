// ---------------------------------------------------------------------------
// Enrichment data in exports – GPX/KML/GeoJSON, compact <desc> contract
// (split from enrichment.test.ts)
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { makePoi } from "./enrichment-helpers";

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
          openingHours: null,
          description: "Excellent French bistro, cyclist-friendly terrace.",
          review: "Le Petit Zinc is a food stop near the route.",
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
          structured: {
            headline: "Excellent French bistro, cyclist-friendly terrace.",
            operationalSummary: "Reputation signals present.",
            practicalities: ["Type: French bistro"],
            sourceRollup: [],
            cautions: [],
            unknowns: [],
            divergences: [],
            sourceConfirmation: "none" as const,
          },
        },
      ],
    ]);

    const gpx = buildGpxString([poi], [], enrichments);
    // Compact GPX <desc> format: header line "<Category> · ★<rating> (<reviews>) · $$ · km..."
    expect(gpx).toContain("★4.2 (87)");
    expect(gpx).toContain("$$");
    expect(gpx).toContain("Excellent French bistro");
    expect(gpx).toContain("Mon-Fri");
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
          openingHours: null,
          description: "Good Italian place to eat.",
          review: "Good place to eat.",
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
          structured: {
            headline: "Good place to eat.",
            operationalSummary: "Reputation signals present.",
            practicalities: ["Type: Italian"],
            sourceRollup: [],
            cautions: [],
            unknowns: [],
            divergences: [],
            sourceConfirmation: "none" as const,
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
          openingHours: null,
          description: "Always open.",
          review: "Toujours ouvert.",
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
          structured: {
            headline: "Toujours ouvert.",
            operationalSummary: "Coverage: Google Maps, Yelp.",
            practicalities: ["Type: Cafe"],
            sourceRollup: [
              {
                platform: "google_maps" as const,
                brief: "Google Maps: Always open.",
                url: "https://maps.google.com",
              },
            ],
            cautions: [],
            unknowns: [],
            divergences: [],
            sourceConfirmation: "none" as const,
          },
        },
      ],
    ]);

    const geojson = buildGeoJsonObject([poi], enrichments);
    const props = geojson.features[0].properties!;
    expect(props.enrichment_rating).toBe(4.5);
    expect(props.enrichment_reviewCount).toBe(100);
    expect(props.enrichment_hours).toBe("24/7");
    expect(props.enrichment_priceLevel).toBe(1);
    expect(props.enrichment_locality).toBe("Paris");
    expect(props.enrichment_googleMapsUrl).toBe("https://maps.google.com");
    expect(props.enrichment_sourceCount).toBe(3);
    expect(props.enrichment_sourceEngines).toBe("google,bing");
    expect(props.enrichment_confidence).toBe(0.55);
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
  it("GPX export outputs description", async () => {
    const { buildGpxString } = await import("../lib/export");
    const poi = makePoi();
    const enrichments = new Map([
      [
        "test-poi-1",
        {
          rating: 4.0,
          reviewCount: 50,
          hours: null,
          openingHours: null,
          description: "Excellent bistro with terrace.",
          review: null,
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

  it("GPX export outputs description when present", async () => {
    const { buildGpxString } = await import("../lib/export");
    const poi = makePoi();
    const enrichments = new Map([
      [
        "test-poi-1",
        {
          rating: null,
          reviewCount: null,
          hours: null,
          openingHours: null,
          description: "Un bon endroit.",
          review: null,
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

  it("KML export outputs description in HTML description", async () => {
    const { buildKmlString } = await import("../lib/export");
    const poi = makePoi();
    const enrichments = new Map([
      [
        "test-poi-1",
        {
          rating: null,
          reviewCount: null,
          hours: null,
          openingHours: null,
          description: "Good Italian restaurant.",
          review: null,
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
// Source metadata in exports
// ---------------------------------------------------------------------------

describe("export with source metadata", () => {
  it("GPX text description includes Sources and Confidence", async () => {
    const { buildGpxString, buildKmlString } = await import("../lib/export");
    const poi = makePoi();
    const enrichments = new Map([
      [
        "test-poi-1",
        {
          rating: 4.0,
          reviewCount: null,
          hours: null,
          openingHours: null,
          description: "A nice bistro.",
          review: null,
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
    // Compact GPX <desc> intentionally drops Sources/Confidence (kept in KML).
    const gpx = buildGpxString([poi], [], enrichments);
    expect(gpx).toContain("★4.0");
    expect(gpx).toContain("A nice bistro.");
    expect(gpx).not.toContain("Sources:");
    expect(gpx).not.toContain("Confidence:");
    // Verbose data remains in KML <description>.
    const kml = buildKmlString([poi], [], enrichments);
    expect(kml).toContain("Sources:");
    expect(kml).toContain("Confidence:");
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
          openingHours: null,
          description: "Ok place.",
          review: null,
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
          openingHours: null,
          description: null,
          review: null,
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
// Compact GPX <desc> format — offline GPS readability contract
// ---------------------------------------------------------------------------

describe("formatPoiDescriptionCompact", () => {
  it("produces a header with category, rating, price and distance", async () => {
    const { formatPoiDescriptionCompact } = await import("../lib/export");
    const poi = makePoi();
    const desc = formatPoiDescriptionCompact(poi, {
      rating: 4.5,
      reviewCount: 200,
      hours: null,
      openingHours: null,
      description: null,
      review: null,
      priceLevel: 3,
      googleMapsUrl: "https://maps.google.com",
      sourceUrls: [],
      rawSnippets: [],
      enrichedAt: "2026-05-10T00:00:00Z",
      status: "done",
      locality: null,
      sourceCount: 0,
      sourceEngines: [],
      confidence: 0,
    });
    const firstLine = desc.split("\n")[0];
    expect(firstLine).toContain("Restaurant or Bar");
    expect(firstLine).toContain("★4.5 (200)");
    expect(firstLine).toContain("$$$");
    expect(firstLine).toContain("km 5.0");
    expect(firstLine).toContain("120m");
  });

  it("stays under 400 characters even with large enrichment", async () => {
    const { formatPoiDescriptionCompact } = await import("../lib/export");
    const poi = makePoi({ tags: { amenity: "restaurant", phone: "+33 1 23 45 67 89" } });
    const longText = "lorem ipsum ".repeat(80);
    const desc = formatPoiDescriptionCompact(poi, {
      rating: 4.5,
      reviewCount: 999,
      hours: longText,
      openingHours: null,
      description: longText,
      review: longText,
      priceLevel: 4,
      googleMapsUrl: "https://maps.google.com",
      sourceUrls: [],
      rawSnippets: [],
      enrichedAt: "2026-05-10T00:00:00Z",
      status: "done",
      locality: null,
      sourceCount: 0,
      sourceEngines: [],
      confidence: 0,
      structured: {
        headline: null,
        operationalSummary: null,
        practicalities: [],
        sourceRollup: [],
        cautions: [longText, longText],
        unknowns: [],
        divergences: [],
        sourceConfirmation: "none",
      },
    });
    expect(desc.length).toBeLessThanOrEqual(400);
  });

  it("falls back to OSM tags when no enrichment is provided", async () => {
    const { formatPoiDescriptionCompact } = await import("../lib/export");
    const poi = makePoi({
      tags: {
        amenity: "restaurant",
        opening_hours: "Mo-Fr 09:00-18:00; Sa 10:00-14:00",
        phone: "+33 6 12 34 56 78",
      },
    });
    const desc = formatPoiDescriptionCompact(poi);
    // No enrichment → no rating, no description; OSM hours and phone surface.
    expect(desc).not.toContain("★");
    expect(desc).toContain("Restaurant or Bar");
    expect(desc).toContain("☎");
    expect(desc).toContain("Mo-Fr");
  });

  it("prefers phone over website when both are present", async () => {
    const { formatPoiDescriptionCompact } = await import("../lib/export");
    const poi = makePoi({
      tags: {
        amenity: "restaurant",
        phone: "+33 6 11 22 33 44",
        website: "https://example.com",
      },
    });
    const desc = formatPoiDescriptionCompact(poi);
    expect(desc).toContain("+33 6 11 22 33 44");
    expect(desc).not.toContain("https://example.com");
  });

  it("uses website when phone is missing", async () => {
    const { formatPoiDescriptionCompact } = await import("../lib/export");
    const poi = makePoi({
      tags: { amenity: "restaurant", website: "https://example.com" },
    });
    const desc = formatPoiDescriptionCompact(poi);
    expect(desc).toContain("https://example.com");
  });

  it("formats structured opening hours compactly", async () => {
    const { formatPoiDescriptionCompact } = await import("../lib/export");
    const poi = makePoi();
    const desc = formatPoiDescriptionCompact(poi, {
      rating: null,
      reviewCount: null,
      hours: null,
      openingHours: [
        { day: "Monday", open: "08:00", close: "18:00" },
        { day: "Tuesday", open: "08:00", close: "18:00" },
        { day: "Sunday", open: "closed", close: null },
      ],
      description: null,
      review: null,
      priceLevel: null,
      googleMapsUrl: "",
      sourceUrls: [],
      rawSnippets: [],
      enrichedAt: "2026-05-10T00:00:00Z",
      status: "done",
      locality: null,
      sourceCount: 0,
      sourceEngines: [],
      confidence: 0,
    });
    expect(desc).toContain("Mo 8-18");
    expect(desc).toContain("Tu 8-18");
    expect(desc).toContain("Su closed");
  });

  it("includes only the first caution to save space", async () => {
    const { formatPoiDescriptionCompact } = await import("../lib/export");
    const poi = makePoi();
    const desc = formatPoiDescriptionCompact(poi, {
      rating: null,
      reviewCount: null,
      hours: null,
      openingHours: null,
      description: null,
      review: null,
      priceLevel: null,
      googleMapsUrl: "",
      sourceUrls: [],
      rawSnippets: [],
      enrichedAt: "2026-05-10T00:00:00Z",
      status: "done",
      locality: null,
      sourceCount: 0,
      sourceEngines: [],
      confidence: 0,
      structured: {
        headline: null,
        operationalSummary: null,
        practicalities: [],
        sourceRollup: [],
        cautions: ["First warning", "Second warning", "Third warning"],
        unknowns: [],
        divergences: [],
        sourceConfirmation: "none",
      },
    });
    expect(desc).toContain("⚠ First warning");
    expect(desc).not.toContain("Second warning");
    expect(desc).not.toContain("Third warning");
  });
});
