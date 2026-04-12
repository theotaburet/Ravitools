// ---------------------------------------------------------------------------
// Tests for Overpass query builder
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { buildOverpassQuery, buildChunkedQueries } from "../lib/overpass";
import type { TracePoint } from "../types";

const TRACE: TracePoint[] = [
  { lat: 48.8566, lon: 2.3522 },
  { lat: 48.8600, lon: 2.3600 },
  { lat: 48.8650, lon: 2.3700 },
];

describe("buildOverpassQuery", () => {
  it("should produce valid Overpass QL", () => {
    const query = buildOverpassQuery(TRACE, 1000);
    expect(query).toContain("[out:json]");
    expect(query).toContain("[timeout:120]");
    expect(query).toContain("out center");
    expect(query).toContain("around:1000");
    // Should contain trace coordinates
    expect(query).toContain("48.8566,2.3522");
    expect(query).toContain("48.865,2.37");
  });

  it("should group tags by OSM key", () => {
    const query = buildOverpassQuery(TRACE, 1000, ["Water"]);
    // Water has amenity: water_point and amenity: drinking_water
    expect(query).toContain('"amenity"');
    expect(query).toContain("water_point|drinking_water");
    // Should NOT contain tourism or shop keys
    expect(query).not.toContain('"tourism"');
    expect(query).not.toContain('"shop"');
  });

  it("should filter by categories", () => {
    const queryWater = buildOverpassQuery(TRACE, 1000, ["Water"]);
    const queryAll = buildOverpassQuery(TRACE, 1000);
    // All categories query should be longer
    expect(queryAll.length).toBeGreaterThan(queryWater.length);
  });
});

describe("buildChunkedQueries", () => {
  it("should return a single query for short traces", () => {
    const queries = buildChunkedQueries(TRACE, 1000, 80);
    expect(queries.length).toBe(1);
  });

  it("should chunk long traces", () => {
    // Create a trace with 200 points
    const longTrace: TracePoint[] = [];
    for (let i = 0; i < 200; i++) {
      longTrace.push({ lat: 48.8 + i * 0.001, lon: 2.3 + i * 0.001 });
    }
    const queries = buildChunkedQueries(longTrace, 1000, 50);
    expect(queries.length).toBeGreaterThan(1);
    // Each query should be valid
    for (const q of queries) {
      expect(q).toContain("[out:json]");
      expect(q).toContain("out center");
    }
  });
});
