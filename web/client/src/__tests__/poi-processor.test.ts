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

  it("should sort POIs by distance to trace", () => {
    const elements: OverpassElement[] = [
      {
        type: "node",
        id: 9001,
        lat: 48.862, // farther from trace start
        lon: 2.375,
        tags: { amenity: "drinking_water" },
      },
      {
        type: "node",
        id: 9002,
        lat: 48.857, // closer to trace start
        lon: 2.353,
        tags: { amenity: "toilets" },
      },
    ];

    const pois = processElements(elements, [TRACE], 1500);
    expect(pois.length).toBe(2);
    expect(pois[0].distanceToTrace).toBeLessThanOrEqual(
      pois[1].distanceToTrace,
    );
  });
});
