// ---------------------------------------------------------------------------
// GPX parser – client-side parsing of GPX XML files
// Port of gpx_smoother.py logic to TypeScript
// ---------------------------------------------------------------------------

import type { TracePoint, TraceData } from "../types";
import { TRACE_COLORS } from "../types";

/** Auto-incrementing counter for trace IDs */
let traceIdCounter = 0;

/**
 * Parse a GPX file string into structured trace data.
 * Handles tracks, routes, and waypoints.
 * Assigns a unique id and cycling color to each trace.
 */
export function parseGpx(xmlString: string, colorIndex?: number): TraceData {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "application/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("Invalid GPX file: XML parse error");
  }

  // Extract name from metadata
  const nameEl =
    doc.querySelector("metadata > name") ?? doc.querySelector("trk > name");
  const name = nameEl?.textContent ?? undefined;

  // Collect points from all tracks and segments
  const points: TracePoint[] = [];

  // Track points
  const trkpts = doc.querySelectorAll("trkpt");
  for (const pt of trkpts) {
    const p = parsePoint(pt);
    if (p) points.push(p);
  }

  // Route points (fallback if no track)
  if (points.length === 0) {
    const rtepts = doc.querySelectorAll("rtept");
    for (const pt of rtepts) {
      const p = parsePoint(pt);
      if (p) points.push(p);
    }
  }

  if (points.length === 0) {
    throw new Error("No track or route points found in GPX file");
  }

  const totalDistanceM = computePathLength(points);
  const simplified = simplifyTrace(points, 500); // 500m default spacing

  const id = `trace_${++traceIdCounter}`;
  const color = TRACE_COLORS[(colorIndex ?? traceIdCounter - 1) % TRACE_COLORS.length];

  return {
    id,
    original: points,
    simplified,
    totalDistanceM,
    name,
    color,
  };
}

function parsePoint(el: Element): TracePoint | null {
  const lat = parseFloat(el.getAttribute("lat") ?? "");
  const lon = parseFloat(el.getAttribute("lon") ?? "");
  if (isNaN(lat) || isNaN(lon)) return null;

  const eleEl = el.querySelector("ele");
  const timeEl = el.querySelector("time");

  return {
    lat,
    lon,
    ele: eleEl ? parseFloat(eleEl.textContent ?? "") : undefined,
    time: timeEl?.textContent ?? undefined,
  };
}

// ---------------------------------------------------------------------------
// Haversine distance
// ---------------------------------------------------------------------------
const EARTH_RADIUS_M = 6_371_000;

export function haversine(a: TracePoint, b: TracePoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h =
    sinDLat * sinDLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLon * sinDLon;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function computePathLength(points: TracePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversine(points[i - 1], points[i]);
  }
  return total;
}

// ---------------------------------------------------------------------------
// Trace simplification / resampling
// Port of GPXSmoother._smooth_and_resample_path
// ---------------------------------------------------------------------------

/**
 * Resample a trace to have evenly spaced points.
 * @param points - Original trace points
 * @param spacingM - Desired spacing in meters (default 500m)
 * @returns Resampled trace with uniform spacing
 */
export function simplifyTrace(
  points: TracePoint[],
  spacingM: number = 500,
): TracePoint[] {
  if (points.length < 2) return [...points];

  // Cumulative distances
  const distances: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i - 1] + haversine(points[i - 1], points[i]));
  }
  const totalDist = distances[distances.length - 1];
  if (totalDist === 0) return [points[0]];

  const numPoints = Math.max(2, Math.round(totalDist / spacingM));
  const result: TracePoint[] = [];

  for (let i = 0; i < numPoints; i++) {
    const targetDist = (i / (numPoints - 1)) * totalDist;

    // Find surrounding segment
    let segIdx = 0;
    for (let j = 1; j < distances.length; j++) {
      if (distances[j] >= targetDist) {
        segIdx = j - 1;
        break;
      }
      segIdx = j - 1;
    }

    const segStart = distances[segIdx];
    const segEnd = distances[segIdx + 1] ?? segStart;
    const segLen = segEnd - segStart;
    const t = segLen > 0 ? (targetDist - segStart) / segLen : 0;

    const p0 = points[segIdx];
    const p1 = points[segIdx + 1] ?? p0;

    result.push({
      lat: p0.lat + t * (p1.lat - p0.lat),
      lon: p0.lon + t * (p1.lon - p0.lon),
      ele:
        p0.ele !== undefined && p1.ele !== undefined
          ? p0.ele + t * (p1.ele - p0.ele)
          : p0.ele,
    });
  }

  return result;
}

/**
 * Compute the minimum distance from a point to any segment of the trace.
 * Used for filtering POIs by actual proximity to the route, not just
 * proximity to sampled points.
 */
export function distanceToTrace(
  point: TracePoint,
  trace: TracePoint[],
): number {
  let minDist = Infinity;
  for (let i = 0; i < trace.length - 1; i++) {
    const d = distanceToSegment(point, trace[i], trace[i + 1]);
    if (d < minDist) minDist = d;
  }
  // Also check distance to last point
  if (trace.length > 0) {
    const d = haversine(point, trace[trace.length - 1]);
    if (d < minDist) minDist = d;
  }
  return minDist;
}

// ---------------------------------------------------------------------------
// Spatial index for fast distance-to-trace queries on long traces
// ---------------------------------------------------------------------------

/** Grid cell size in degrees (~2.2 km at 45°N latitude) */
const GRID_CELL_DEG = 0.02;

/** A segment index entry: start index in the trace points array */
interface SegmentRef {
  /** Index of the first point of this segment in the trace */
  idx: number;
}

/**
 * Spatial index for a trace polyline.
 *
 * Segments are bucketed into a grid keyed by `"latCell,lonCell"`.
 * Each segment is inserted into every cell its bounding box touches.
 * To query distance from a point, only segments in nearby cells are tested.
 *
 * For a 600 km trace with ~12 000 points, building the index is O(n)
 * and each distance query is O(k) where k ≪ n (typically 20-60 segments).
 */
export class TraceIndex {
  private grid = new Map<string, SegmentRef[]>();
  private points: TracePoint[];

  constructor(trace: TracePoint[]) {
    this.points = trace;
    for (let i = 0; i < trace.length - 1; i++) {
      const a = trace[i];
      const b = trace[i + 1];
      // Bounding box of the segment
      const minLat = Math.min(a.lat, b.lat);
      const maxLat = Math.max(a.lat, b.lat);
      const minLon = Math.min(a.lon, b.lon);
      const maxLon = Math.max(a.lon, b.lon);
      // Insert into every cell the segment touches
      const cMinLat = Math.floor(minLat / GRID_CELL_DEG);
      const cMaxLat = Math.floor(maxLat / GRID_CELL_DEG);
      const cMinLon = Math.floor(minLon / GRID_CELL_DEG);
      const cMaxLon = Math.floor(maxLon / GRID_CELL_DEG);
      const ref: SegmentRef = { idx: i };
      for (let cy = cMinLat; cy <= cMaxLat; cy++) {
        for (let cx = cMinLon; cx <= cMaxLon; cx++) {
          const key = `${cy},${cx}`;
          let bucket = this.grid.get(key);
          if (!bucket) {
            bucket = [];
            this.grid.set(key, bucket);
          }
          bucket.push(ref);
        }
      }
    }
  }

  /**
   * Compute minimum distance from a point to the indexed trace.
   * Only tests segments in cells within `searchRadiusDeg` of the point.
   *
   * @param point - The query point
   * @param searchRadiusDeg - How many grid cells to search around the point
   *   (default 2 = 5x5 neighbourhood ≈ ±4.4 km). For maxDistanceM=1500m
   *   this provides ample margin even at cell boundaries.
   */
  distanceTo(point: TracePoint, searchRadiusDeg: number = 2): number {
    const cy = Math.floor(point.lat / GRID_CELL_DEG);
    const cx = Math.floor(point.lon / GRID_CELL_DEG);

    let minDist = Infinity;
    const tested = new Set<number>(); // avoid testing same segment twice

    for (let dy = -searchRadiusDeg; dy <= searchRadiusDeg; dy++) {
      for (let dx = -searchRadiusDeg; dx <= searchRadiusDeg; dx++) {
        const key = `${cy + dy},${cx + dx}`;
        const bucket = this.grid.get(key);
        if (!bucket) continue;
        for (const ref of bucket) {
          if (tested.has(ref.idx)) continue;
          tested.add(ref.idx);
          const d = distanceToSegment(
            point,
            this.points[ref.idx],
            this.points[ref.idx + 1],
          );
          if (d < minDist) minDist = d;
        }
      }
    }

    // If no segments found nearby (point far from trace), fall back to brute force
    if (minDist === Infinity) {
      return distanceToTrace(point, this.points);
    }

    return minDist;
  }
}

/**
 * Approximate distance from a point to a line segment.
 * Projects the point onto the segment in lat/lon space then computes
 * haversine distance to the projected point.
 */
function distanceToSegment(
  p: TracePoint,
  a: TracePoint,
  b: TracePoint,
): number {
  const dx = b.lon - a.lon;
  const dy = b.lat - a.lat;
  const lenSq = dx * dx + dy * dy;

  if (lenSq === 0) return haversine(p, a);

  let t = ((p.lon - a.lon) * dx + (p.lat - a.lat) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));

  const proj: TracePoint = {
    lat: a.lat + t * dy,
    lon: a.lon + t * dx,
  };

  return haversine(p, proj);
}
