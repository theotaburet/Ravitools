// --- Tests for Overpass query builder ---

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildChunkedQueries,
  buildOverpassQuery,
  chunkPoints,
  queryOverpass,
  splitChunk,
} from "../lib/overpass";
import type { TracePoint } from "../types";

const TRACE: TracePoint[] = [
  { lat: 48.8566, lon: 2.3522 },
  { lat: 48.86, lon: 2.36 },
  { lat: 48.865, lon: 2.37 },
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

describe("splitChunk", () => {
  const pts: TracePoint[] = Array.from({ length: 10 }, (_, i) => ({ lat: 48 + i, lon: 2 }));

  it("halves a chunk with a 1-point overlap (no corridor gap)", () => {
    const [a, b] = splitChunk(pts);
    expect(a.length + b.length).toBe(11);
    expect(a[a.length - 1]).toBe(b[0]);
    expect(a[0]).toBe(pts[0]);
    expect(b[b.length - 1]).toBe(pts[9]);
  });

  it("leaves tiny chunks alone", () => {
    const tiny = pts.slice(0, 3);
    expect(splitChunk(tiny)).toEqual([tiny]);
  });
});

describe("chunkPoints", () => {
  it("covers every point across overlapping chunks", () => {
    const pts: TracePoint[] = Array.from({ length: 120 }, (_, i) => ({ lat: 48 + i, lon: 2 }));
    const chunks = chunkPoints(pts, 50);
    expect(chunks.length).toBeGreaterThan(2);
    const covered = new Set(chunks.flat().map((p) => p.lat));
    expect(covered.size).toBe(120);
  });
});

describe("queryOverpass, static build", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("asks Overpass directly, then the next mirror when one is busy", async () => {
    vi.stubEnv("VITE_STANDALONE", "true");
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValueOnce(Response.json({ elements: [{ type: "node", id: 1 }] }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = queryOverpass("[out:json];node(1);out;", 1);
    await vi.advanceTimersByTimeAsync(5000);
    const data = await pending;

    expect(data.elements).toHaveLength(1);
    const [first, second] = fetchMock.mock.calls;
    expect(first[0]).toBe("https://overpass-api.de/api/interpreter");
    expect(second[0]).toBe("https://maps.mail.ru/osm/tools/overpass/api/interpreter");
    expect((second[1].body as URLSearchParams).get("data")).toBe("[out:json];node(1);out;");
  });
});
