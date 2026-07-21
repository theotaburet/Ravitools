// ---------------------------------------------------------------------------
// Ravito gaps – segments of a trace longer than a threshold without a POI
// ---------------------------------------------------------------------------

export interface Gap {
  startM: number;
  endM: number;
}

/**
 * Intervals of [0, totalDistM] strictly longer than thresholdM with no POI.
 * Edges count: start → first POI and last POI → end are intervals too.
 */
export function findGaps(distancesM: number[], totalDistM: number, thresholdM: number): Gap[] {
  const sorted = [...distancesM].sort((a, b) => a - b);
  const gaps: Gap[] = [];
  let prev = 0;
  for (const d of [...sorted, totalDistM]) {
    if (d - prev > thresholdM) gaps.push({ startM: prev, endM: d });
    prev = Math.max(prev, d);
  }
  return gaps;
}
