// GPX parser: client-side parsing of GPX XML files

import type { TraceData, TracePoint } from "../types";
import { TRACE_COLORS } from "../types";

/** Auto-incrementing counter for trace IDs */
let traceIdCounter = 0;

// Bound input to avoid memory blowups and Overpass chunk explosion on a
// pathological GPX. Generous: a long multi-day route stays well under these.
// Raise if a legit route is ever rejected.
const MAX_GPX_CHARS = 25_000_000; // ~25 MB of XML
const MAX_TRACE_POINTS = 300_000;

/**
 * Parse a GPX file string into structured trace data.
 * Handles tracks, routes, and waypoints.
 * Assigns a unique id and cycling color to each trace.
 */
export function parseGpx(xmlString: string, colorIndex?: number): TraceData {
  if (xmlString.length > MAX_GPX_CHARS) {
    throw new Error(
      `GPX file too large (${Math.round(xmlString.length / 1_000_000)} MB, max ${MAX_GPX_CHARS / 1_000_000} MB)`,
    );
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlString, "application/xml");

  const parseError = doc.querySelector("parsererror");
  if (parseError) {
    throw new Error("Invalid GPX file: XML parse error");
  }

  // Extract name from metadata
  const nameEl = doc.querySelector("metadata > name") ?? doc.querySelector("trk > name");
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

  if (points.length > MAX_TRACE_POINTS) {
    throw new Error(
      `GPX has too many points (${points.length}, max ${MAX_TRACE_POINTS}). Simplify the track before importing.`,
    );
  }

  const totalDistanceM = computePathLength(points);
  const simplified = simplifyTrace(points, 500); // 500m default spacing
  const { gain: elevationGainM, loss: elevationLossM } = computeElevationStats(points);

  const id = `trace_${++traceIdCounter}`;
  const color = TRACE_COLORS[(colorIndex ?? traceIdCounter - 1) % TRACE_COLORS.length];

  return {
    id,
    original: points,
    simplified,
    totalDistanceM,
    elevationGainM,
    elevationLossM,
    name,
    color,
  };
}

function parsePoint(el: Element): TracePoint | null {
  const lat = parseFloat(el.getAttribute("lat") ?? "");
  const lon = parseFloat(el.getAttribute("lon") ?? "");
  if (Number.isNaN(lat) || Number.isNaN(lon)) return null;

  const eleEl = el.querySelector("ele");
  const timeEl = el.querySelector("time");

  return {
    lat,
    lon,
    ele: eleEl ? parseFloat(eleEl.textContent ?? "") : undefined,
    time: timeEl?.textContent ?? undefined,
  };
}

// --- Haversine distance ---
const EARTH_RADIUS_M = 6_371_000;

export function haversine(a: TracePoint, b: TracePoint): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinDLat = Math.sin(dLat / 2);
  const sinDLon = Math.sin(dLon / 2);
  const h = sinDLat * sinDLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinDLon * sinDLon;
  return EARTH_RADIUS_M * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

export function computePathLength(points: TracePoint[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    total += haversine(points[i - 1], points[i]);
  }
  return total;
}

/**
 * Compute elevation gain (D+) and loss (D-) from trace points.
 * Ignores tiny elevation changes (< 2m) to avoid GPS noise.
 */
export function computeElevationStats(points: TracePoint[]): { gain: number; loss: number } {
  let gain = 0;
  let loss = 0;
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    // Skip only segments touching a point without elevation, instead of
    // discarding the whole stat on a single GPS dropout.
    if (prev.ele == null || curr.ele == null) continue;
    const diff = curr.ele - prev.ele;
    if (Math.abs(diff) >= 2) {
      if (diff > 0) gain += diff;
      else loss += Math.abs(diff);
    }
  }
  return { gain: Math.round(gain), loss: Math.round(loss) };
}

// Trace simplification / resampling

/**
 * Resample a trace to have evenly spaced points.
 * @param points - Original trace points
 * @param spacingM - Desired spacing in meters (default 500m)
 * @returns Resampled trace with uniform spacing
 */
export function simplifyTrace(points: TracePoint[], spacingM: number = 500): TracePoint[] {
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
      ele: p0.ele !== undefined && p1.ele !== undefined ? p0.ele + t * (p1.ele - p0.ele) : p0.ele,
    });
  }

  return result;
}

/**
 * Compute the minimum distance from a point to any segment of the trace.
 * Used for filtering POIs by actual proximity to the route, not just
 * proximity to sampled points.
 */
export function distanceToTrace(point: TracePoint, trace: TracePoint[]): number {
  if (trace.length === 1) return haversine(point, trace[0]);
  let minDist = Infinity;
  for (let i = 0; i < trace.length - 1; i++) {
    minDist = Math.min(minDist, projectOnSegment(point, trace[i], trace[i + 1]).dist);
  }
  return minDist;
}

// --- Spatial index for fast distance-to-trace queries on long traces ---

/** Grid cell size in degrees (~2.2 km at 45°N latitude) */
const GRID_CELL_DEG = 0.02;

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
  /** Cell key → index of each segment's first point */
  private grid = new Map<string, number[]>();
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
      for (let cy = cMinLat; cy <= cMaxLat; cy++) {
        for (let cx = cMinLon; cx <= cMaxLon; cx++) {
          const key = `${cy},${cx}`;
          let bucket = this.grid.get(key);
          if (!bucket) {
            bucket = [];
            this.grid.set(key, bucket);
          }
          bucket.push(i);
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
        for (const idx of bucket) {
          if (tested.has(idx)) continue;
          tested.add(idx);
          const d = projectOnSegment(point, this.points[idx], this.points[idx + 1]).dist;
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
 * Project a point onto segment [a, b]: `t` is the fraction along it (0–1),
 * `dist` the haversine distance to the projection. Longitude is scaled by
 * cos(lat) (1° lon = cos(lat)·1° lat in meters) so the projection is not
 * distorted away from the equator, where travel order would flip.
 */
function projectOnSegment(
  p: TracePoint,
  a: TracePoint,
  b: TracePoint,
): { t: number; dist: number } {
  const k = Math.cos((((a.lat + b.lat) / 2) * Math.PI) / 180);
  const dLon = b.lon - a.lon;
  const dx = dLon * k;
  const dy = b.lat - a.lat;
  const lenSq = dx * dx + dy * dy;
  const t =
    lenSq === 0
      ? 0
      : Math.max(0, Math.min(1, ((p.lon - a.lon) * k * dx + (p.lat - a.lat) * dy) / lenSq));
  return { t, dist: haversine(p, { lat: a.lat + t * dy, lon: a.lon + t * dLon }) };
}

// --- Along-trace distance computation ---

/**
 * Compute the cumulative along-trace distance from the trace start to the
 * nearest projection of a point onto the trace.
 *
 * For each segment, we project the point and compute:
 *   cumulative distance to segment start + fraction * segment length
 *
 * We pick the segment whose projection is closest (same logic as distanceToTrace)
 * and return the along-trace distance in meters.
 *
 * @returns Distance along the trace (meters) from the start to the POI's projection
 */
export function alongTraceProjection(point: TracePoint, trace: TracePoint[]): number {
  if (trace.length < 2) return 0;

  let minDist = Infinity;
  let bestAlongDist = 0;
  let cumDist = 0;

  for (let i = 0; i < trace.length - 1; i++) {
    const segLen = haversine(trace[i], trace[i + 1]);
    const { t, dist } = projectOnSegment(point, trace[i], trace[i + 1]);
    if (dist < minDist) {
      minDist = dist;
      bestAlongDist = cumDist + t * segLen;
    }
    cumDist += segLen;
  }

  return bestAlongDist;
}
