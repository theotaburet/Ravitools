// ---------------------------------------------------------------------------
// Screen-grid POI clustering
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { clusterPois, clusterProfilePois, poiBounds } from "../lib/poi-cluster";
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
    tags: {},
    style: {
      iconShape: "circle",
      borderColor: "#FFF",
      borderWidth: "2",
      textColor: "#FFF",
      backgroundColor: "#3B82F6",
    },
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

function poiAt(id: string, along: number): POI {
  return { ...poi(id, 43 + along / 1_000_000, 7), alongTraceDistance: along };
}

describe("clusterProfilePois", () => {
  // window 0–100 km → 2.5% share = 2.5 km grouping gap
  it("merges POIs packed within the share threshold, keeps spread ones single", () => {
    const packed = [poiAt("a", 50_000), poiAt("b", 50_500), poiAt("c", 51_000)];
    const lone = poiAt("far", 90_000);
    const { singles, clusters } = clusterProfilePois([...packed, lone], 0, 100_000);
    expect(clusters).toHaveLength(1);
    expect(clusters[0].count).toBe(3);
    expect(clusters[0].dist).toBeCloseTo(50_500, 0);
    expect(singles.map((p) => p.id)).toEqual(["far"]);
  });

  it("keeps pairs individual (minClusterSize 3)", () => {
    const pair = [poiAt("a", 50_000), poiAt("b", 50_500)];
    const { singles, clusters } = clusterProfilePois(pair, 0, 100_000);
    expect(clusters).toHaveLength(0);
    expect(singles).toHaveLength(2);
  });

  it("ignores POIs outside the window", () => {
    const { singles, clusters } = clusterProfilePois([poiAt("out", 200_000)], 0, 100_000);
    expect(singles).toHaveLength(0);
    expect(clusters).toHaveLength(0);
  });

  it("dissolves when the window narrows (zoom in)", () => {
    // same trio, but 10 km window → gap 250 m < 500 m spacing → all singles
    const packed = [poiAt("a", 50_000), poiAt("b", 50_500), poiAt("c", 51_000)];
    const { singles, clusters } = clusterProfilePois(packed, 45_000, 55_000);
    expect(clusters).toHaveLength(0);
    expect(singles).toHaveLength(3);
  });
});

describe("poiBounds", () => {
  it("returns the bounding box of the members", () => {
    const b = poiBounds([poi("a", 43.1, 7.2), poi("b", 43.5, 7.0)]);
    expect(b).toEqual({ south: 43.1, north: 43.5, west: 7.0, east: 7.2 });
  });
});
