// ---------------------------------------------------------------------------
// Tests for poi-cache (shared Postgres cache client)
// ---------------------------------------------------------------------------

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getPoiCacheKey,
  isCacheablePoi,
  lookupPoiBatch,
  uploadPoiEnrichment,
} from "../lib/poi-cache";
import type { EnrichedData, POI } from "../types";

const BASE_POI: POI = {
  id: "p1",
  lat: 43.5,
  lon: -1.4,
  category: "Restaurant or Bar",
  name: "Bistro",
  icon: "food",
  distanceToTrace: 100,
  alongTraceDistance: 12000,
  tags: { name: "Bistro", amenity: "restaurant" },
  style: {
    iconShape: "circle",
    borderColor: "#000",
    borderWidth: "2",
    textColor: "#fff",
    backgroundColor: "#f00",
  },
  osmId: 12345,
  osmType: "node",
};

const BASE_ENRICHMENT: EnrichedData = {
  rating: 4.5,
  reviewCount: 100,
  hours: "Mon-Fri 12:00-22:00",
  openingHours: null,
  description: "Nice bistro",
  review: "Solid food",
  priceLevel: 2,
  googleMapsUrl: "https://maps.google.com/?q=43.5,-1.4",
  sourceUrls: [],
  rawSnippets: [],
  enrichedAt: new Date().toISOString(),
  status: "done",
  locality: "Bayonne",
  sourceCount: 3,
  sourceEngines: ["google", "bing"],
  confidence: 0.85,
};

describe("isCacheablePoi / getPoiCacheKey", () => {
  it("returns true for POI with osmId+osmType", () => {
    expect(isCacheablePoi(BASE_POI)).toBe(true);
    expect(getPoiCacheKey(BASE_POI)).toBe("node/12345");
  });

  it("returns false when osmId missing", () => {
    const poi = { ...BASE_POI, osmId: undefined };
    expect(isCacheablePoi(poi)).toBe(false);
    expect(getPoiCacheKey(poi)).toBeNull();
  });

  it("returns false when osmType missing", () => {
    const poi = { ...BASE_POI, osmType: undefined };
    expect(isCacheablePoi(poi)).toBe(false);
  });

  it("returns false for negative osmId", () => {
    const poi = { ...BASE_POI, osmId: -1 };
    expect(isCacheablePoi(poi)).toBe(false);
  });
});

describe("lookupPoiBatch", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty Map when no cacheable POIs", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const poi = { ...BASE_POI, osmId: undefined };
    const result = await lookupPoiBatch([poi]);
    expect(result.size).toBe(0);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("parses server response into Map keyed by osm_type/osm_id", async () => {
    const cached = {
      osm_type: "node",
      osm_id: "12345",
      category: "Restaurant or Bar",
      lat: 43.5,
      lon: -1.4,
      name: "Bistro",
      enrichment: BASE_ENRICHMENT,
      enriched_at: new Date().toISOString(),
      is_stale: false,
    };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ requested: 1, hits: 1, misses: 0, results: [cached] }),
      }),
    );

    const result = await lookupPoiBatch([BASE_POI]);
    expect(result.size).toBe(1);
    expect(result.get("node/12345")?.enrichment.rating).toBe(4.5);
    expect(result.get("node/12345")?.is_stale).toBe(false);
  });

  it("returns empty Map on 503", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 503, json: async () => ({}) }),
    );
    const result = await lookupPoiBatch([BASE_POI]);
    expect(result.size).toBe(0);
  });

  it("returns empty Map on network error (graceful degradation)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("Network down")));
    const result = await lookupPoiBatch([BASE_POI]);
    expect(result.size).toBe(0);
  });
});

describe("uploadPoiEnrichment", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => vi.restoreAllMocks());

  it("returns false (no-op) for POI without osm identifier", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const poi = { ...BASE_POI, osmId: undefined };
    const ok = await uploadPoiEnrichment(poi, BASE_ENRICHMENT);
    expect(ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("PUTs to /api/poi/:type/:id with correct payload", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal("fetch", fetchSpy);
    const ok = await uploadPoiEnrichment(BASE_POI, BASE_ENRICHMENT);
    expect(ok).toBe(true);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/poi/node/12345");
    expect(init.method).toBe("PUT");
    const body = JSON.parse(init.body);
    expect(body.category).toBe("Restaurant or Bar");
    expect(body.lat).toBe(43.5);
    expect(body.lon).toBe(-1.4);
    expect(body.enrichment.rating).toBe(4.5);
  });

  it("returns false on network error (graceful degradation)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    const ok = await uploadPoiEnrichment(BASE_POI, BASE_ENRICHMENT);
    expect(ok).toBe(false);
  });

  it("returns false on 503 response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 503 }));
    const ok = await uploadPoiEnrichment(BASE_POI, BASE_ENRICHMENT);
    expect(ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// R11: batches over the server's 200-key cap must be chunked and merged
// ---------------------------------------------------------------------------

describe("lookupPoiBatch chunking (R11)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("chunks 250 POIs into 2 requests and merges results", async () => {
    const pois = Array.from({ length: 250 }, (_, i) => ({
      ...BASE_POI,
      id: `p${i}`,
      osmId: i + 1,
    }));
    const fetchSpy = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as {
        keys: { osm_type: string; osm_id: string }[];
      };
      return {
        ok: true,
        json: async () => ({
          requested: body.keys.length,
          hits: body.keys.length,
          misses: 0,
          results: body.keys.map((k) => ({
            osm_type: k.osm_type,
            osm_id: k.osm_id,
            enrichment: BASE_ENRICHMENT,
          })),
        }),
      };
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await lookupPoiBatch(pois);

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    const sizes = fetchSpy.mock.calls.map(
      (c) => (JSON.parse(String((c[1] as RequestInit).body)) as { keys: unknown[] }).keys.length,
    );
    expect(sizes).toEqual([200, 50]);
    expect(result.size).toBe(250);
  });
});
