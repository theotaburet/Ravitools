// Shared test POI factory for the enrichment-*.test.ts files
// (split from enrichment.test.ts)

import type { POI } from "../types";

export function makePoi(overrides: Partial<POI> = {}): POI {
  return {
    id: "test-poi-1",
    lat: 47.3941,
    lon: 0.6848,
    category: "Restaurant or Bar",
    name: "Le Petit Zinc",
    icon: "utensils",
    distanceToTrace: 120,
    alongTraceDistance: 5000,
    traceId: "trace_1",
    tags: { amenity: "restaurant", cuisine: "french" },
    ...overrides,
  };
}
