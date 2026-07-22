// ---------------------------------------------------------------------------
// Screen-grid POI clustering – pure logic, no Leaflet.
// ponytail: fixed viewport grid instead of a markercluster dependency —
// zooming shrinks the cells, so clusters dissolve naturally.
// ---------------------------------------------------------------------------

import type { MapViewBounds } from "../state/ui";
import type { POI } from "../types";

export interface PoiCluster {
  lat: number;
  lon: number;
  count: number;
  members: POI[];
}

/**
 * Bucket the in-viewport POIs into a cols×rows grid. Cells holding at least
 * `minClusterSize` POIs become one cluster (centroid + count); the rest stay
 * individual markers. The POI with `keepId` (selection) is never clustered.
 */
export function clusterPois(
  pois: POI[],
  bounds: MapViewBounds,
  opts: { cols?: number; rows?: number; minClusterSize?: number; keepId?: string | null } = {},
): { singles: POI[]; clusters: PoiCluster[] } {
  const { cols = 14, rows = 10, minClusterSize = 4, keepId = null } = opts;
  const inView = pois.filter(
    (p) =>
      p.lat >= bounds.south &&
      p.lat <= bounds.north &&
      p.lon >= bounds.west &&
      p.lon <= bounds.east,
  );
  const cw = (bounds.east - bounds.west) / cols;
  const ch = (bounds.north - bounds.south) / rows;
  if (cw <= 0 || ch <= 0) return { singles: inView, clusters: [] };

  const cells = new Map<string, POI[]>();
  for (const p of inView) {
    const cx = Math.min(cols - 1, Math.floor((p.lon - bounds.west) / cw));
    const cy = Math.min(rows - 1, Math.floor((p.lat - bounds.south) / ch));
    const key = `${cx}_${cy}`;
    const cell = cells.get(key);
    if (cell) cell.push(p);
    else cells.set(key, [p]);
  }

  const singles: POI[] = [];
  const clusters: PoiCluster[] = [];
  for (const members of cells.values()) {
    const selected = keepId ? members.find((m) => m.id === keepId) : undefined;
    const rest = selected ? members.filter((m) => m.id !== keepId) : members;
    if (selected) singles.push(selected);
    if (rest.length === 0) continue;
    if (rest.length < minClusterSize) {
      singles.push(...rest);
    } else {
      clusters.push({
        lat: rest.reduce((s, m) => s + m.lat, 0) / rest.length,
        lon: rest.reduce((s, m) => s + m.lon, 0) / rest.length,
        count: rest.length,
        members: rest,
      });
    }
  }
  return { singles, clusters };
}

export interface ProfilePoiCluster {
  dist: number;
  count: number;
  members: POI[];
}

/**
 * 1D clustering along the elevation profile: POIs whose along-trace positions
 * fall within `minSharePct` of the visible window merge into one bubble.
 * ponytail: greedy left-to-right grouping — a chain of close POIs becomes one
 * long cluster, which is exactly what an unreadable pile of emojis deserves.
 */
export function clusterProfilePois(
  pois: POI[],
  winStart: number,
  winEnd: number,
  opts: { minSharePct?: number; minClusterSize?: number } = {},
): { singles: POI[]; clusters: ProfilePoiCluster[] } {
  const { minSharePct = 2.5, minClusterSize = 3 } = opts;
  const span = winEnd - winStart;
  if (span <= 0) return { singles: [], clusters: [] };
  const inWin = pois
    .filter((p) => p.alongTraceDistance >= winStart && p.alongTraceDistance <= winEnd)
    .sort((a, b) => a.alongTraceDistance - b.alongTraceDistance);
  const gap = (span * minSharePct) / 100;

  const groups: POI[][] = [];
  for (const p of inWin) {
    const g = groups[groups.length - 1];
    if (g && p.alongTraceDistance - g[g.length - 1].alongTraceDistance <= gap) g.push(p);
    else groups.push([p]);
  }

  const singles: POI[] = [];
  const clusters: ProfilePoiCluster[] = [];
  for (const g of groups) {
    if (g.length < minClusterSize) {
      singles.push(...g);
    } else {
      clusters.push({
        dist: g.reduce((s, m) => s + m.alongTraceDistance, 0) / g.length,
        count: g.length,
        members: g,
      });
    }
  }
  return { singles, clusters };
}

/** Bounding box of a POI list — used to zoom the map onto a profile cluster. */
export function poiBounds(pois: POI[]): MapViewBounds {
  return {
    south: Math.min(...pois.map((p) => p.lat)),
    north: Math.max(...pois.map((p) => p.lat)),
    west: Math.min(...pois.map((p) => p.lon)),
    east: Math.max(...pois.map((p) => p.lon)),
  };
}
