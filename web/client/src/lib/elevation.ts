// ---------------------------------------------------------------------------
// Elevation profile helpers – pure functions, no DOM.
// Distances are cumulative meters from the trace start (same referential as
// POI.alongTraceDistance, both computed over the original points).
// ---------------------------------------------------------------------------

import type { TracePoint } from "../types";
import { haversine } from "./gpx-parser";

export interface ProfilePoint {
  /** Cumulative distance from trace start (m) */
  dist: number;
  /** Elevation (m) */
  ele: number;
  lat: number;
  lon: number;
}

/**
 * Build an elevation profile from trace points.
 * Distance accumulates over ALL points; only points carrying an elevation are
 * emitted. Returns null when there is nothing meaningful to plot
 * (< 2 elevation points, or a flat < 1m span — GPS noise, not a profile).
 */
export function buildProfile(points: TracePoint[]): ProfilePoint[] | null {
  const profile: ProfilePoint[] = [];
  let dist = 0;
  for (let i = 0; i < points.length; i++) {
    if (i > 0) dist += haversine(points[i - 1], points[i]);
    const ele = points[i].ele;
    if (ele != null) {
      profile.push({ dist, ele, lat: points[i].lat, lon: points[i].lon });
    }
  }
  if (profile.length < 2) return null;
  let min = Infinity;
  let max = -Infinity;
  for (const p of profile) {
    if (p.ele < min) min = p.ele;
    if (p.ele > max) max = p.ele;
  }
  return max - min < 1 ? null : profile;
}

/**
 * Reduce a profile to at most maxPoints, always keeping first and last.
 * ponytail: plain stride sampling — bucket min/max preservation if spikes
 * visibly disappear on real routes.
 */
export function downsampleProfile(profile: ProfilePoint[], maxPoints = 300): ProfilePoint[] {
  if (profile.length <= maxPoints) return profile;
  const out: ProfilePoint[] = [];
  const step = (profile.length - 1) / (maxPoints - 1);
  for (let i = 0; i < maxPoints; i++) {
    out.push(profile[Math.round(i * step)]);
  }
  return out;
}

/** Linear interpolation of the profile at a given distance (clamped to ends). */
export function profileAt(profile: ProfilePoint[], dist: number): ProfilePoint {
  const first = profile[0];
  const last = profile[profile.length - 1];
  if (dist <= first.dist) return first;
  if (dist >= last.dist) return last;
  // ponytail: linear scan — profiles are downsampled to ≤300 points
  let i = 1;
  while (profile[i].dist < dist) i++;
  const a = profile[i - 1];
  const b = profile[i];
  const f = b.dist === a.dist ? 0 : (dist - a.dist) / (b.dist - a.dist);
  return {
    dist,
    ele: a.ele + (b.ele - a.ele) * f,
    lat: a.lat + (b.lat - a.lat) * f,
    lon: a.lon + (b.lon - a.lon) * f,
  };
}
