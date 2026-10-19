// --- Tests for POI processor: matching, dedup, distance filtering ---

import { describe, expect, it } from "vitest";
import type { OverpassElement } from "../lib/overpass";
import { processElements } from "../lib/poi-processor";

const TRACE = {
  id: "trace_1",
  original: [
    { lat: 48.8566, lon: 2.3522 },
    { lat: 48.86, lon: 2.36 },
    { lat: 48.865, lon: 2.37 },
    { lat: 48.87, lon: 2.38 },
  ],
};

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

  it("gives a POI the same id on every run (enrichments are keyed by it)", () => {
    const elements: OverpassElement[] = [
      { type: "node", id: 1001, lat: 48.858, lon: 2.356, tags: { amenity: "drinking_water" } },
    ];
    const first = processElements(elements, [TRACE])[0].id;
    expect(processElements(elements, [TRACE], 1000)[0].id).toBe(first);
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

  it("drops bus shelters and keeps weather shelters", () => {
    const elements: OverpassElement[] = [
      {
        type: "node",
        id: 2101,
        lat: 48.862,
        lon: 2.365,
        tags: { amenity: "shelter", shelter_type: "public_transport", name: "Arrêt Mairie" },
      },
      {
        type: "node",
        id: 2102,
        lat: 48.863,
        lon: 2.366,
        tags: { amenity: "shelter", shelter_type: "weather_shelter" },
      },
      {
        type: "node",
        id: 2103,
        lat: 48.864,
        lon: 2.367,
        tags: { amenity: "shelter" },
      },
    ];

    const pois = processElements(elements, [TRACE]);
    expect(pois.map((p) => p.osmId)).toEqual([2102, 2103]);
    expect(pois.every((p) => p.category === "Shelter")).toBe(true);
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

    const pois = processElements(elements, [TRACE], 1500);
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

    const pois = processElements(elements, [TRACE], 1500);
    expect(pois.length).toBe(2);
  });

  // Paris: the 1 800 restaurants grew the merge radius to 120 m, and 28 % of the
  // water points vanished though the base map draws them
  it("keeps two water points 100 m apart, however many restaurants surround them", () => {
    const elements: OverpassElement[] = Array.from({ length: 1300 }, (_, index) => ({
      type: "node" as const,
      id: 4200 + index,
      lat: 48.858 + index * 0.00005,
      lon: 2.356,
      tags: { amenity: "restaurant", name: `Restaurant ${index}` },
    }));
    elements.push(
      { type: "node", id: 99901, lat: 48.95, lon: 2.45, tags: { amenity: "drinking_water" } },
      { type: "node", id: 99902, lat: 48.9509, lon: 2.45, tags: { amenity: "drinking_water" } },
    );

    const pois = processElements(elements, [TRACE], 20000);
    expect(pois.filter((poi) => poi.category === "Water")).toHaveLength(2);
  });

  // Places the base map draws that were in no category
  it.each([
    [{ man_made: "water_tap" }, "Water"],
    [{ natural: "spring" }, "Water"],
    [{ amenity: "fountain", drinking_water: "yes" }, "Water"],
    [{ tourism: "wilderness_hut" }, "Sleeping place"],
    [{ amenity: "fuel" }, "Food shop"],
    [{ shop: "kiosk" }, "Food shop"],
    [{ amenity: "marketplace" }, "Food shop"],
    [{ amenity: "vending_machine", vending: "sweets;drinks" }, "Food shop"],
  ])("files %o under %s", (tags, category) => {
    const el: OverpassElement = { type: "node", id: 1, lat: 48.86, lon: 2.36, tags };
    expect(processElements([el], [TRACE], 1500)[0]?.category).toBe(category);
  });

  it.each<Record<string, string>>([
    { man_made: "water_tap", drinking_water: "no" },
    { amenity: "fountain" },
    { amenity: "vending_machine", vending: "parking_tickets" },
  ])("leaves out %o", (tags) => {
    const el: OverpassElement = { type: "node", id: 1, lat: 48.86, lon: 2.36, tags };
    expect(processElements([el], [TRACE], 1500)).toEqual([]);
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

    const pois = processElements(elements, [TRACE], 1500);
    expect(pois.length).toBe(2);
  });

  it("should handle way elements with center", () => {
    const elements: OverpassElement[] = [
      {
        type: "way",
        id: 6001,
        center: { lat: 48.86, lon: 2.36 },
        tags: { tourism: "camp_site", name: "Big Campground" },
      },
    ];

    const pois = processElements(elements, [TRACE], 1500);
    expect(pois.length).toBe(1);
    expect(pois[0].lat).toBe(48.86);
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
    expect(pois[0].alongTraceDistance).toBeLessThanOrEqual(pois[1].alongTraceDistance);
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
