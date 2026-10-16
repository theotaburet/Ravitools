// --- Tests for Overpass query builder ---

import { afterEach, describe, expect, it, vi } from "vitest";
import { buildOverpassQuery, chunkPoints, queryAllPois, splitChunk } from "../lib/overpass";
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

describe("queryAllPois, static build", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("asks Overpass directly, then the next mirror on the next retry round", async () => {
    vi.stubEnv("VITE_STANDALONE", "true");
    vi.useFakeTimers();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("busy", { status: 429 }))
      .mockResolvedValueOnce(Response.json({ elements: [{ type: "node", id: 1 }] }));
    vi.stubGlobal("fetch", fetchMock);

    const pending = queryAllPois([TRACE], 1000, ["Water"]);
    await vi.advanceTimersByTimeAsync(10_000);
    const result = await pending;

    expect(result.elements).toHaveLength(1);
    expect(result.failedChunks).toBe(0);
    const [first, second] = fetchMock.mock.calls;
    expect(first[0]).toBe("https://overpass-api.de/api/interpreter");
    expect(second[0]).toBe("https://maps.mail.ru/osm/tools/overpass/api/interpreter");
    expect((second[1].body as URLSearchParams).get("data")).toContain("drinking_water");
  });

  it("never joins two separate traces in one query", async () => {
    // around: with several points is a polyline: one query over both traces
    // would scan the whole corridor between them
    vi.stubEnv("VITE_STANDALONE", "true");
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) =>
      Response.json({ elements: [] }),
    );
    vi.stubGlobal("fetch", fetchMock);
    // Fresh points: TRACE's query is already in the client cache
    const lyon: TracePoint[] = [
      { lat: 45.76, lon: 4.83 },
      { lat: 45.77, lon: 4.84 },
    ];
    const alps: TracePoint[] = [
      { lat: 45.06, lon: 6.4 },
      { lat: 45.07, lon: 6.41 },
    ];

    await queryAllPois([lyon, alps], 1000, ["Water"]);

    const queries = fetchMock.mock.calls.map(([, init]) =>
      String((init.body as URLSearchParams).get("data")),
    );
    expect(queries).toHaveLength(2);
    expect(queries.filter((q) => q.includes("45.76") && q.includes("45.06"))).toEqual([]);
  });

  it("stops querying once aborted", async () => {
    vi.stubEnv("VITE_STANDALONE", "true");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const ctrl = new AbortController();
    ctrl.abort();

    await expect(queryAllPois([TRACE], 1000, ["Water"], undefined, ctrl.signal)).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
