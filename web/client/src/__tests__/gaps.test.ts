// ---------------------------------------------------------------------------
// findGaps – intervalles > seuil sans POI le long d'une trace (bords inclus)
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { findGaps } from "../lib/gaps";

describe("findGaps", () => {
  it("returns one full-length gap when there is no POI", () => {
    expect(findGaps([], 30000, 25000)).toEqual([{ startM: 0, endM: 30000 }]);
  });

  it("returns no gap when the trace is shorter than the threshold", () => {
    expect(findGaps([], 20000, 25000)).toEqual([]);
  });

  it("does not alert when the interval equals the threshold exactly", () => {
    expect(findGaps([25000], 50000, 25000)).toEqual([]);
  });

  it("detects edge gaps before the first and after the last POI", () => {
    expect(findGaps([30000], 70000, 25000)).toEqual([
      { startM: 0, endM: 30000 },
      { startM: 30000, endM: 70000 },
    ]);
  });

  it("handles unsorted input and threshold changes", () => {
    const d = [40000, 10000];
    expect(findGaps(d, 50000, 25000)).toEqual([{ startM: 10000, endM: 40000 }]);
    expect(findGaps(d, 50000, 8000)).toEqual([
      { startM: 0, endM: 10000 },
      { startM: 10000, endM: 40000 },
      { startM: 40000, endM: 50000 },
    ]);
  });
});
