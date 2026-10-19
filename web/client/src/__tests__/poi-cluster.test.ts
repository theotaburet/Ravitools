// --- Screen-grid POI clustering ---

import { describe, expect, it } from "vitest";
import { clusterPois } from "../lib/poi-cluster";
import type { POI } from "../types";

const BOUNDS = { south: 43, west: 7, north: 44, east: 8 };

function poi(id: string, lat: number, lon: number): POI {
  return {
    id,
    lat,
    lon,
    category: "Water",
    name: id,
    icon: "faucet-drip",
    distanceToTrace: 10,
    alongTraceDistance: 0,
    traceId: "trace_1",
    tags: {},
  };
}

describe("clusterPois", () => {
  it("clusters a dense cell and keeps sparse POIs individual", () => {
    const dense = Array.from({ length: 6 }, (_, i) => poi(`d${i}`, 43.05, 7.05 + i * 0.001));
    const lone = poi("lone", 43.95, 7.95);
    const { singles, clusters } = clusterPois([...dense, lone], BOUNDS);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(6);
    expect(clusters[0].lat).toBeCloseTo(43.05, 3);
    expect(singles.map((p) => p.id)).toEqual(["lone"]);
  });

  it("drops POIs outside the viewport", () => {
    const { singles, clusters } = clusterPois([poi("out", 50, 10)], BOUNDS);
    expect(singles).toHaveLength(0);
    expect(clusters).toHaveLength(0);
  });

  it("never clusters the selected POI", () => {
    const dense = Array.from({ length: 6 }, (_, i) => poi(`d${i}`, 43.05, 7.05 + i * 0.001));
    const { singles, clusters } = clusterPois(dense, BOUNDS, { keepId: "d2" });
    expect(singles.map((p) => p.id)).toEqual(["d2"]);
    expect(clusters[0].count).toBe(5);
  });
});
