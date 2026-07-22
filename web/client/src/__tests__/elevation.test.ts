// ---------------------------------------------------------------------------
// Elevation profile helpers – buildProfile, downsampleProfile, profileAt
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { buildProfile, downsampleProfile, gainAt, profileAt, slopeBuckets } from "../lib/elevation";
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

  it("reduces to at most maxPoints keeping first and last", () => {
    const out = downsampleProfile(big, 300);
    expect(out.length).toBeLessThanOrEqual(300);
    expect(out.length).toBeGreaterThan(200);
    expect(out[0]).toBe(big[0]);
    expect(out[out.length - 1]).toBe(big[999]);
  });

  it("preserves a single sharp spike (no smoothing)", () => {
    const flat = Array.from({ length: 1000 }, (_, i) => pt(i, 100));
    flat[500] = pt(500, 400); // one nasty ramp
    const out = downsampleProfile(buildProfile(flat)!, 50);
    expect(Math.max(...out.map((p) => p.ele))).toBe(400);
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

describe("gainAt", () => {
  // up 50, down 30, up 60 — only climbs count
  const profile = buildProfile([pt(0, 100), pt(1, 150), pt(2, 120), pt(3, 180)])!;
  const seg = profile[1].dist;

  it("is 0 at the start and full D+ at (or past) the end", () => {
    expect(gainAt(profile, 0)).toBe(0);
    expect(gainAt(profile, profile[3].dist)).toBeCloseTo(110, 5);
    expect(gainAt(profile, profile[3].dist + 1000)).toBeCloseTo(110, 5);
  });

  it("interpolates inside a climbing segment", () => {
    expect(gainAt(profile, seg / 2)).toBeCloseTo(25, 5);
  });

  it("ignores descents", () => {
    // mid of the descending segment: still only the first 50m climbed
    expect(gainAt(profile, seg * 1.5)).toBeCloseTo(50, 5);
  });
});

describe("slopeBuckets", () => {
  // 4 segments of ~111m: +11m (~10%), flat, -11m (~-10%), +33m (~30%)
  const profile = buildProfile([pt(0, 100), pt(1, 111), pt(2, 111), pt(3, 100), pt(4, 133)])!;
  const total = profile[4].dist;

  it("keeps the steepest segment per bucket, signed", () => {
    const out = slopeBuckets(profile, 0, total, 4);
    expect(out).toHaveLength(4);
    expect(out[0].slopePct).toBeCloseTo(10, 0);
    expect(out[1].slopePct).toBeCloseTo(0, 0);
    expect(out[2].slopePct).toBeCloseTo(-10, 0);
    expect(out[3].slopePct).toBeCloseTo(30, 0);
  });

  it("does not average a steep ramp away inside a coarse bucket", () => {
    // 1 bucket over the whole trace: worst |slope| wins → the 30% ramp
    const out = slopeBuckets(profile, 0, total, 1);
    expect(out[0].slopePct).toBeCloseTo(30, 0);
  });

  it("respects the [startM, endM] window", () => {
    const out = slopeBuckets(profile, 0, total / 4, 1);
    expect(out[0].slopePct).toBeCloseTo(10, 0);
  });
});
