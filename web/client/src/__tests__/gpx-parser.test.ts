// ---------------------------------------------------------------------------
// Tests for GPX parser and trace simplification
// ---------------------------------------------------------------------------

// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import {
  parseGpx,
  haversine,
  computePathLength,
  simplifyTrace,
  distanceToTrace,
  TraceIndex,
} from "../lib/gpx-parser";
import type { TracePoint } from "../types";
import { TRACE_COLORS } from "../types";

// Minimal valid GPX with a short track
const SAMPLE_GPX = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="test" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata><name>Test Route</name></metadata>
  <trk>
    <name>Test Track</name>
    <trkseg>
      <trkpt lat="48.8566" lon="2.3522"><ele>35</ele></trkpt>
      <trkpt lat="48.8600" lon="2.3600"><ele>40</ele></trkpt>
      <trkpt lat="48.8650" lon="2.3700"><ele>45</ele></trkpt>
      <trkpt lat="48.8700" lon="2.3800"><ele>50</ele></trkpt>
      <trkpt lat="48.8750" lon="2.3900"><ele>55</ele></trkpt>
      <trkpt lat="48.8800" lon="2.4000"><ele>60</ele></trkpt>
    </trkseg>
  </trk>
</gpx>`;

const SAMPLE_GPX_ROUTE = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1">
  <rte>
    <rtept lat="48.8566" lon="2.3522" />
    <rtept lat="48.8700" lon="2.3800" />
  </rte>
</gpx>`;

describe("haversine", () => {
  it("should return 0 for same point", () => {
    const p: TracePoint = { lat: 48.8566, lon: 2.3522 };
    expect(haversine(p, p)).toBe(0);
  });

  it("should compute correct distance for known points", () => {
    // Paris to roughly 1km north-ish
    const a: TracePoint = { lat: 48.8566, lon: 2.3522 };
    const b: TracePoint = { lat: 48.8656, lon: 2.3522 };
    const dist = haversine(a, b);
    // ~1000m (0.009 degrees latitude)
    expect(dist).toBeGreaterThan(900);
    expect(dist).toBeLessThan(1100);
  });
});

describe("computePathLength", () => {
  it("should return 0 for single point", () => {
    expect(computePathLength([{ lat: 48.8, lon: 2.3 }])).toBe(0);
  });

  it("should compute total length", () => {
    const points: TracePoint[] = [
      { lat: 48.8566, lon: 2.3522 },
      { lat: 48.8656, lon: 2.3522 },
      { lat: 48.8746, lon: 2.3522 },
    ];
    const len = computePathLength(points);
    // Two segments of ~1km each
    expect(len).toBeGreaterThan(1800);
    expect(len).toBeLessThan(2200);
  });
});

describe("parseGpx", () => {
  it("should parse a valid GPX track", () => {
    const result = parseGpx(SAMPLE_GPX);
    expect(result.original.length).toBe(6);
    expect(result.original[0].lat).toBe(48.8566);
    expect(result.original[0].lon).toBe(2.3522);
    expect(result.original[0].ele).toBe(35);
    expect(result.name).toBe("Test Route");
    expect(result.totalDistanceM).toBeGreaterThan(0);
    expect(result.simplified.length).toBeGreaterThanOrEqual(2);
  });

  it("should assign id and color to parsed trace", () => {
    const result = parseGpx(SAMPLE_GPX);
    expect(result.id).toMatch(/^trace_\d+$/);
    expect(TRACE_COLORS).toContain(result.color);
  });

  it("should use colorIndex to pick color", () => {
    const result = parseGpx(SAMPLE_GPX, 3);
    expect(result.color).toBe(TRACE_COLORS[3]);
  });

  it("should parse a route (rtept) if no track", () => {
    const result = parseGpx(SAMPLE_GPX_ROUTE);
    expect(result.original.length).toBe(2);
  });

  it("should throw on empty GPX", () => {
    const emptyGpx = `<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1"></gpx>`;
    expect(() => parseGpx(emptyGpx)).toThrow("No track or route points");
  });

  it("should throw on invalid XML", () => {
    expect(() => parseGpx("not xml at all")).toThrow();
  });
});

describe("simplifyTrace", () => {
  it("should return at least 2 points", () => {
    const points: TracePoint[] = [
      { lat: 48.8566, lon: 2.3522 },
      { lat: 48.8700, lon: 2.3800 },
    ];
    const result = simplifyTrace(points, 10000);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("should reduce dense points", () => {
    // Create 100 closely spaced points
    const points: TracePoint[] = [];
    for (let i = 0; i < 100; i++) {
      points.push({ lat: 48.8566 + i * 0.0001, lon: 2.3522 });
    }
    const result = simplifyTrace(points, 500);
    expect(result.length).toBeLessThan(points.length);
    expect(result.length).toBeGreaterThanOrEqual(2);
  });

  it("should preserve start and end", () => {
    const points: TracePoint[] = [
      { lat: 48.0, lon: 2.0 },
      { lat: 48.5, lon: 2.5 },
      { lat: 49.0, lon: 3.0 },
    ];
    const result = simplifyTrace(points, 5000);
    expect(result[0].lat).toBeCloseTo(48.0, 3);
    expect(result[result.length - 1].lat).toBeCloseTo(49.0, 3);
  });
});

describe("distanceToTrace", () => {
  it("should return 0 for a point on the trace", () => {
    const trace: TracePoint[] = [
      { lat: 48.8566, lon: 2.3522 },
      { lat: 48.8700, lon: 2.3800 },
    ];
    const d = distanceToTrace(trace[0], trace);
    expect(d).toBeLessThan(1);
  });

  it("should return a reasonable distance for a point near the trace", () => {
    const trace: TracePoint[] = [
      { lat: 48.8566, lon: 2.3522 },
      { lat: 48.8700, lon: 2.3522 },
    ];
    // Point 0.01 degrees east (~750m at this latitude)
    const point: TracePoint = { lat: 48.8633, lon: 2.3622 };
    const d = distanceToTrace(point, trace);
    expect(d).toBeGreaterThan(500);
    expect(d).toBeLessThan(1000);
  });
});

describe("TraceIndex", () => {
  it("should return same distance as brute-force distanceToTrace", () => {
    const trace: TracePoint[] = [
      { lat: 48.8566, lon: 2.3522 },
      { lat: 48.8600, lon: 2.3600 },
      { lat: 48.8650, lon: 2.3700 },
      { lat: 48.8700, lon: 2.3800 },
    ];
    const index = new TraceIndex(trace);
    const point: TracePoint = { lat: 48.862, lon: 2.365 };
    const brute = distanceToTrace(point, trace);
    const indexed = index.distanceTo(point);
    // Should be very close — both compute segment distance
    expect(Math.abs(brute - indexed)).toBeLessThan(1);
  });

  it("should return 0 for a point on the trace", () => {
    const trace: TracePoint[] = [
      { lat: 48.8566, lon: 2.3522 },
      { lat: 48.8700, lon: 2.3800 },
    ];
    const index = new TraceIndex(trace);
    const d = index.distanceTo(trace[0]);
    expect(d).toBeLessThan(1);
  });

  it("should handle a long trace correctly", () => {
    // Simulate a ~50km trace with 500 points
    const trace: TracePoint[] = [];
    for (let i = 0; i < 500; i++) {
      trace.push({ lat: 48.0 + i * 0.001, lon: 2.0 + i * 0.001 });
    }
    const index = new TraceIndex(trace);
    // Point near the middle of the trace
    const point: TracePoint = { lat: 48.25, lon: 2.251 };
    const brute = distanceToTrace(point, trace);
    const indexed = index.distanceTo(point);
    expect(Math.abs(brute - indexed)).toBeLessThan(1);
  });

  it("should match brute-force for a point far from trace", () => {
    const trace: TracePoint[] = [
      { lat: 48.8566, lon: 2.3522 },
      { lat: 48.8700, lon: 2.3800 },
    ];
    const index = new TraceIndex(trace);
    // Point far away — should fallback to brute force
    const farPoint: TracePoint = { lat: 50.0, lon: 5.0 };
    const brute = distanceToTrace(farPoint, trace);
    const indexed = index.distanceTo(farPoint);
    expect(Math.abs(brute - indexed)).toBeLessThan(1);
  });

  it("should be significantly faster than brute-force on 12k-point trace", () => {
    // Simulate a 600km trace with 12000 points (~50m spacing)
    const trace: TracePoint[] = [];
    for (let i = 0; i < 12000; i++) {
      // Zigzag path to simulate realistic route with curves
      const lat = 43.0 + i * 0.00045;
      const lon = 1.0 + Math.sin(i * 0.01) * 0.005 + i * 0.00045;
      trace.push({ lat, lon });
    }

    // Generate 2000 test POIs scattered near the trace
    const pois: TracePoint[] = [];
    for (let i = 0; i < 2000; i++) {
      const traceIdx = Math.floor(Math.random() * trace.length);
      const offsetLat = (Math.random() - 0.5) * 0.03; // ±1.5km
      const offsetLon = (Math.random() - 0.5) * 0.04;
      pois.push({
        lat: trace[traceIdx].lat + offsetLat,
        lon: trace[traceIdx].lon + offsetLon,
      });
    }

    // Brute force
    const bruteStart = performance.now();
    const bruteResults: number[] = [];
    for (const poi of pois) {
      bruteResults.push(distanceToTrace(poi, trace));
    }
    const bruteMs = performance.now() - bruteStart;

    // Indexed
    const indexBuildStart = performance.now();
    const index = new TraceIndex(trace);
    const indexBuildMs = performance.now() - indexBuildStart;

    const indexQueryStart = performance.now();
    const indexResults: number[] = [];
    for (const poi of pois) {
      indexResults.push(index.distanceTo(poi));
    }
    const indexQueryMs = performance.now() - indexQueryStart;
    const indexTotalMs = indexBuildMs + indexQueryMs;

    // Verify correctness — all results should match
    for (let i = 0; i < pois.length; i++) {
      expect(Math.abs(bruteResults[i] - indexResults[i])).toBeLessThan(1);
    }

    // Index should be at least 5x faster (typically 50-200x)
    const speedup = bruteMs / indexTotalMs;
    // Log for visibility
    console.log(
      `TraceIndex benchmark: brute=${bruteMs.toFixed(0)}ms, ` +
      `index=${indexTotalMs.toFixed(0)}ms (build=${indexBuildMs.toFixed(0)}ms + query=${indexQueryMs.toFixed(0)}ms), ` +
      `speedup=${speedup.toFixed(1)}x`
    );
    expect(speedup).toBeGreaterThan(5);
  });
});
