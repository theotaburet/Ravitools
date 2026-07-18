// ---------------------------------------------------------------------------
// FVM — export validation (GPX/KML/GeoJSON)
// (split from fvm.test.ts)
// ---------------------------------------------------------------------------
// @vitest-environment jsdom

import { describe, expect, it } from "vitest";
import { buildGeoJsonObject, buildGpxString, buildKmlString } from "../lib/export";
import type { EnrichmentStructuredContent } from "../types";
import { makeBaseEnrichment, makePoi } from "./fvm-helpers";

// ===========================================================================
// K. Export Validation
// ===========================================================================

describe("FVM-K: Export Validation", () => {
  const enrichedStructured: EnrichmentStructuredContent = {
    headline: "Excellent bistro with cyclist-friendly terrace.",
    operationalSummary: "Best read as French bistro. Hours available. Reputation signals present.",
    practicalities: [
      "Type: French bistro",
      "Reported rating: 4.3/5 (120 reviews)",
      "Hours: Mon-Sat 12-14, 19-22",
    ],
    sourceRollup: [
      {
        platform: "google_maps",
        brief: "Google Maps: Well-reviewed bistro",
        url: "https://google.com/maps/test",
      },
      {
        platform: "tripadvisor",
        brief: "Tripadvisor: Great terrace",
        url: "https://tripadvisor.fr/test",
      },
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
    priceLevel: 2,
    locality: "Lyon",
    sourceCount: 3,
    sourceEngines: ["google", "bing"],
    confidence: 0.65,
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

  it("K8: GeoJSON exposes enrichment_structured_headline", () => {
    const geojson = buildGeoJsonObject([poi], enrichments);
    const props = geojson.features[0].properties!;
    expect(props.enrichment_structured_headline).toBe(
      "Excellent bistro with cyclist-friendly terrace.",
    );
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
    expect(props.enrichment_structured_cautions).toContain(
      "Price information could not be confirmed.",
    );
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
