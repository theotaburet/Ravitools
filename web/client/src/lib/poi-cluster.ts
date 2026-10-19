// Screen-grid POI clustering: pure logic, no Leaflet.
// Fixed viewport grid instead of a markercluster dependency:
// zooming shrinks the cells, so clusters dissolve naturally.

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
