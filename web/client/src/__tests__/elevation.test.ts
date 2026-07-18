// ---------------------------------------------------------------------------
// Elevation profile helpers – buildProfile, downsampleProfile, profileAt
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { buildProfile, downsampleProfile, profileAt } from "../lib/elevation";
import type { TracePoint } from "../types";

// ~111m per 0.001° latitude — convenient for distance assertions
function pt(latOffset: number, ele?: number): TracePoint {
  return { lat: 45 + latOffset * 0.001, lon: 5, ele };
}

describe("buildProfile", () => {
  it("accumulates distance and keeps lat/lon", () => {
    const profile = buildProfile([pt(0, 100), pt(1, 110), pt(2, 105)])!;
    expect(profile).toHaveLength(3);
    expect(profile[0].dist).toBe(0);
    expect(profile[1].dist).toBeGreaterThan(100);
    expect(profile[1].dist).toBeLessThan(125);
    expect(profile[2].dist).toBeCloseTo(profile[1].dist * 2, 0);
    expect(profile[2].ele).toBe(105);
    expect(profile[2].lat).toBeCloseTo(45.002);
  });

  it("skips points without elevation but keeps their distance", () => {
    const profile = buildProfile([pt(0, 100), pt(1), pt(2, 120)])!;
    expect(profile).toHaveLength(2);
    // Second emitted point carries the full cumulative distance (2 segments)
    expect(profile[1].dist).toBeGreaterThan(200);
  });

  it("returns null with fewer than 2 elevation points", () => {
    expect(buildProfile([pt(0, 100), pt(1), pt(2)])).toBeNull();
    expect(buildProfile([])).toBeNull();
  });

  it("returns null for a flat profile (< 1m span)", () => {
    expect(buildProfile([pt(0, 100), pt(1, 100.5), pt(2, 100)])).toBeNull();
  });
});

describe("downsampleProfile", () => {
  const big = buildProfile(Array.from({ length: 1000 }, (_, i) => pt(i, 100 + (i % 50))))!;

  it("keeps small profiles untouched", () => {
    const small = buildProfile([pt(0, 100), pt(1, 110)])!;
    expect(downsampleProfile(small)).toBe(small);
  });

  it("reduces to maxPoints keeping first and last", () => {
    const out = downsampleProfile(big, 300);
    expect(out).toHaveLength(300);
    expect(out[0]).toBe(big[0]);
    expect(out[299]).toBe(big[999]);
  });
});

describe("profileAt", () => {
  const profile = buildProfile([pt(0, 100), pt(1, 200)])!;
  const total = profile[1].dist;

  it("clamps outside the range", () => {
    expect(profileAt(profile, -50).ele).toBe(100);
    expect(profileAt(profile, total + 50).ele).toBe(200);
  });

  it("interpolates elevation and position linearly", () => {
    const mid = profileAt(profile, total / 2);
    expect(mid.ele).toBeCloseTo(150, 5);
    expect(mid.lat).toBeCloseTo(45.0005, 6);
    expect(mid.lon).toBe(5);
  });
});
