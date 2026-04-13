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
