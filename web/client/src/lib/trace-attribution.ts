// ---------------------------------------------------------------------------
// Nearest-trace POI attribution — shared by ElevationProfile and Roadbook
// ---------------------------------------------------------------------------

import type { POI, TraceData } from "../types";
import { TraceIndex } from "./gpx-parser";

/** POIs belonging to `trace`: each POI is attributed to its nearest trace. */
export function poisForTrace(pois: POI[], traces: TraceData[], trace: TraceData): POI[] {
  if (traces.length === 1) return pois;
  const indices = traces.map((tr) => new TraceIndex(tr.original));
  const selectedIdx = traces.indexOf(trace);
  return pois.filter((poi) => {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < indices.length; i++) {
      const d = indices[i].distanceTo(poi);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best === selectedIdx;
  });
}
