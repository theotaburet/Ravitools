// ---------------------------------------------------------------------------
// Tests for POI processor – matching, dedup, distance filtering
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { processElements } from "../lib/poi-processor";
import type { OverpassElement } from "../lib/overpass";
import type { TracePoint } from "../types";

const TRACE: TracePoint[] = [
  { lat: 48.8566, lon: 2.3522 },
  { lat: 48.8600, lon: 2.3600 },
  { lat: 48.8650, lon: 2.3700 },
  { lat: 48.8700, lon: 2.3800 },
];

describe("processElements", () => {
  it("should match a water POI from Overpass data", () => {
    const elements: OverpassElement[] = [
      {
        type: "node",
        id: 1001,
        lat: 48.858,
        lon: 2.356,
        tags: { amenity: "drinking_water" },
      },
    ];

    const pois = processElements(elements, [TRACE]);
    expect(pois.length).toBe(1);
    expect(pois[0].category).toBe("Water");
    expect(pois[0].name).toBe("Drinking water");
    expect(pois[0].distanceToTrace).toBeGreaterThan(0);
  });

  it("should match a campsite POI", () => {
    const elements: OverpassElement[] = [
      {
        type: "node",
        id: 2001,
        lat: 48.862,
        lon: 2.365,
        tags: { tourism: "camp_site", name: "Camping du Bois" },
      },
    ];

    const pois = processElements(elements, [TRACE]);
    expect(pois.length).toBe(1);
    expect(pois[0].category).toBe("Sleeping place");
    expect(pois[0].name).toBe("Camping du Bois");
  });

  it("should filter out POIs too far from trace", () => {
    const elements: OverpassElement[] = [
      {
        type: "node",
        id: 3001,
        lat: 49.0, // far north
        lon: 2.35,
        tags: { amenity: "drinking_water" },
      },
    ];

    const pois = processElements(elements, [TRACE], 1500);
    expect(pois.length).toBe(0);
  });

  it("should deduplicate nearby POIs of the same category", () => {
    const elements: OverpassElement[] = [
      {
        type: "node",
        id: 4001,
        lat: 48.858,
        lon: 2.356,
        tags: { amenity: "drinking_water" },
      },
      {
        type: "node",
        id: 4002,
        lat: 48.8581, // ~11m away
        lon: 2.3561,
        tags: { amenity: "drinking_water", name: "Fontaine du Parc" },
      },
    ];

    const pois = processElements(elements, [TRACE], 1500, 50);
    expect(pois.length).toBe(1);
    // Should keep the one with more tags (the named one)
    expect(pois[0].name).toBe("Fontaine du Parc");
  });

  it("should not deduplicate nearby restaurants of the same category", () => {
    const elements: OverpassElement[] = [
      {
        type: "node",
        id: 4101,
        lat: 48.858,
        lon: 2.356,
        tags: { amenity: "restaurant", name: "Chez A" },
      },
      {
        type: "node",
        id: 4102,
        lat: 48.8581,
        lon: 2.3561,
        tags: { amenity: "restaurant", name: "Chez B" },
      },
    ];

    const pois = processElements(elements, [TRACE], 1500, 50);
    expect(pois.length).toBe(2);
  });

  it("should use a larger dedup radius for dense mergeable categories", () => {
    const elements: OverpassElement[] = Array.from({ length: 300 }, (_, index) => ({
      type: "node" as const,
      id: 4200 + index,
      lat: 48.858 + index * 0.0003,
      lon: 2.356 + index * 0.0003,
      tags: { amenity: "drinking_water", name: `Water ${index}` },
    }));

    elements.push(
      {
        type: "node",
        id: 99901,
        lat: 48.95,
        lon: 2.45,
        tags: { amenity: "drinking_water", name: "Dense A" },
      },
      {
        type: "node",
        id: 99902,
        lat: 48.9505,
        lon: 2.45,
        tags: { amenity: "drinking_water", name: "Dense B" },
      },
    );

    const pois = processElements(elements, [TRACE], 20000, 50);
    expect(pois.some((poi) => poi.name === "Dense A")).toBe(true);
    expect(pois.some((poi) => poi.name === "Dense B")).toBe(false);
  });

  it("should not deduplicate POIs of different categories", () => {
    const elements: OverpassElement[] = [
      {
        type: "node",
        id: 5001,
        lat: 48.858,
        lon: 2.356,
        tags: { amenity: "drinking_water" },
      },
      {
        type: "node",
        id: 5002,
        lat: 48.858,
        lon: 2.356,
        tags: { amenity: "toilets" },
      },
    ];

    const pois = processElements(elements, [TRACE], 1500, 50);
    expect(pois.length).toBe(2);
  });

  it("should handle way elements with center", () => {
    const elements: OverpassElement[] = [
      {
        type: "way",
        id: 6001,
        center: { lat: 48.860, lon: 2.360 },
        tags: { tourism: "camp_site", name: "Big Campground" },
      },
    ];

    const pois = processElements(elements, [TRACE], 1500);
    expect(pois.length).toBe(1);
    expect(pois[0].lat).toBe(48.860);
    expect(pois[0].category).toBe("Sleeping place");
  });

  it("should skip elements without coordinates", () => {
    const elements: OverpassElement[] = [
      {
        type: "way",
        id: 7001,
        // no center
        tags: { amenity: "drinking_water" },
      },
    ];

    const pois = processElements(elements, [TRACE], 1500);
    expect(pois.length).toBe(0);
  });

  it("should skip elements with unrecognized tags", () => {
    const elements: OverpassElement[] = [
      {
        type: "node",
        id: 8001,
        lat: 48.858,
        lon: 2.356,
        tags: { building: "yes" },
      },
    ];

    const pois = processElements(elements, [TRACE], 1500);
    expect(pois.length).toBe(0);
  });

  it("should sort POIs by along-trace distance (travel order)", () => {
    const elements: OverpassElement[] = [
      {
        type: "node",
        id: 9001,
        lat: 48.862, // near middle of trace
        lon: 2.375,
        tags: { amenity: "drinking_water" },
      },
      {
        type: "node",
        id: 9002,
        lat: 48.857, // near start of trace
        lon: 2.353,
        tags: { amenity: "toilets" },
      },
    ];

    const pois = processElements(elements, [TRACE], 1500);
    expect(pois.length).toBe(2);
    // POI near trace start should come first
    expect(pois[0].alongTraceDistance).toBeLessThanOrEqual(
      pois[1].alongTraceDistance,
    );
  });

  it("should have alongTraceDistance on all POIs", () => {
    const elements: OverpassElement[] = [
      {
        type: "node",
        id: 10001,
        lat: 48.858,
        lon: 2.356,
        tags: { amenity: "drinking_water" },
      },
    ];

    const pois = processElements(elements, [TRACE]);
    expect(pois.length).toBe(1);
    expect(pois[0].alongTraceDistance).toBeGreaterThanOrEqual(0);
    expect(typeof pois[0].alongTraceDistance).toBe("number");
  });
});
