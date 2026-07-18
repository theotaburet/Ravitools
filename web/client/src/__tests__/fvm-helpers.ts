// ---------------------------------------------------------------------------
// Shared factories for the Feature Validation Matrix (FVM) test suite
// ---------------------------------------------------------------------------

import type { EnrichedData, POI, SearchSnippet } from "../types";

export function makePoi(overrides: Partial<POI> = {}): POI {
  return {
    id: "fvm-poi-1",
    lat: 45.764,
    lon: 4.8357,
    category: "Restaurant or Bar",
    name: "Chez Marcel",
    icon: "utensils",
    distanceToTrace: 200,
    alongTraceDistance: 12000,
    tags: { amenity: "restaurant", cuisine: "french" },
    style: {
      iconShape: "circle",
      borderColor: "#FFFFFF",
      borderWidth: "2",
      textColor: "#FFFFFF",
      backgroundColor: "#FF6B35",
    },
    ...overrides,
  };
}

export function makeSnippets(count: number, opts?: Partial<SearchSnippet>): SearchSnippet[] {
  return Array.from({ length: count }, (_, i) => ({
    title: opts?.title ?? `Result ${i}`,
    url: opts?.url ?? `https://example-${i}.com`,
    content: opts?.content ?? `Content for result ${i}`,
    engine: opts?.engine ?? ["google", "bing", "duckduckgo"][i % 3],
    ...opts,
  }));
}

export function makeBaseEnrichment(overrides: Partial<EnrichedData> = {}): EnrichedData {
  return {
    rating: null,
    reviewCount: null,
    hours: null,
    openingHours: null,
    description: null,
    review: null,
    priceLevel: null,
    googleMapsUrl: "https://www.google.com/maps/search/test",
    sourceUrls: [],
    rawSnippets: [],
    enrichedAt: "2026-04-13T00:00:00Z",
    status: "done",
    locality: null,
    sourceCount: 0,
    sourceEngines: [],
    confidence: 0,
    ...overrides,
  };
}
