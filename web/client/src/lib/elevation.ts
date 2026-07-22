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
 * Per-bucket min AND max are kept (not a stride) so short steep spikes —
 * the ones that hurt legs — survive the reduction.
 */
export function downsampleProfile(profile: ProfilePoint[], maxPoints = 300): ProfilePoint[] {
  if (profile.length <= maxPoints) return profile;
  const buckets = Math.max(1, Math.floor(maxPoints / 2) - 1);
  const out: ProfilePoint[] = [profile[0]];
  const step = (profile.length - 2) / buckets;
  for (let k = 0; k < buckets; k++) {
    const from = 1 + Math.floor(k * step);
    const to = Math.min(profile.length - 2, 1 + Math.floor((k + 1) * step) - 1);
    if (to < from) continue;
    let lo = from;
    let hi = from;
    for (let i = from; i <= to; i++) {
      if (profile[i].ele < profile[lo].ele) lo = i;
      if (profile[i].ele > profile[hi].ele) hi = i;
    }
    if (lo === hi) out.push(profile[lo]);
    else out.push(profile[Math.min(lo, hi)], profile[Math.max(lo, hi)]);
  }
  out.push(profile[profile.length - 1]);
  return out;
}

export interface SlopeBucket {
  startM: number;
  endM: number;
  /** Signed % slope; the steepest (by |value|) segment touching the bucket */
  slopePct: number;
}

/**
 * Worst slope per distance bucket over [startM, endM], computed on the
 * FULL-RESOLUTION profile — downsampling would smooth away exactly the short
 * steep ramps this is meant to expose.
 * ponytail: segments < 5m run are skipped and slopes clamped to ±35% — GPS
 * elevation noise on tiny runs produces absurd gradients.
 */
export function slopeBuckets(
  profile: ProfilePoint[],
  startM: number,
  endM: number,
  buckets: number,
): SlopeBucket[] {
  if (profile.length < 2 || endM <= startM || buckets < 1) return [];
  const w = (endM - startM) / buckets;
  const worst = new Array<number>(buckets).fill(0);
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1];
    const b = profile[i];
    if (b.dist < startM || a.dist > endM) continue;
    const run = b.dist - a.dist;
    if (run < 5) continue;
    const slope = Math.max(-35, Math.min(35, ((b.ele - a.ele) / run) * 100));
    const k0 = Math.max(0, Math.floor((a.dist - startM) / w));
    const k1 = Math.min(buckets - 1, Math.floor((b.dist - startM) / w));
    for (let k = k0; k <= k1; k++) {
      if (Math.abs(slope) > Math.abs(worst[k])) worst[k] = slope;
    }
  }
  return worst.map((s, k) => ({
    startM: startM + k * w,
    endM: startM + (k + 1) * w,
    slopePct: s,
  }));
}

/**
 * Cumulative elevation gain (D+) from the trace start up to `dist`, with
 * linear interpolation inside the last segment.
 * ponytail: O(n) per call over a ≤300-point downsampled profile — fine for
 * mousemove; prefix sums if a profiler ever disagrees.
 */
export function gainAt(profile: ProfilePoint[], dist: number): number {
  let gain = 0;
  for (let i = 1; i < profile.length; i++) {
    const a = profile[i - 1];
    const b = profile[i];
    if (a.dist >= dist) break;
    if (b.dist <= dist) {
      if (b.ele > a.ele) gain += b.ele - a.ele;
      continue;
    }
    const f = b.dist === a.dist ? 0 : (dist - a.dist) / (b.dist - a.dist);
    const ele = a.ele + (b.ele - a.ele) * f;
    if (ele > a.ele) gain += ele - a.ele;
    break;
  }
  return gain;
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
