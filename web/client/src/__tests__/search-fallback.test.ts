// ---------------------------------------------------------------------------
// R13: searchPoi must try the next query variant when the first one keeps
// zero snippets (the fallback was dead code except on throw)
// ---------------------------------------------------------------------------

import { afterEach, describe, expect, it, vi } from "vitest";
import { searchPoi } from "../lib/enrichment/search";
import type { POI } from "../types";

const POI_FIXTURE: POI = {
  id: "p1",
  lat: 43.49,
  lon: -1.47,
  category: "Restaurant or Bar",
  name: "Bistro du Port",
  icon: "food",
  distanceToTrace: 100,
  alongTraceDistance: 1000,
  tags: { name: "Bistro du Port", amenity: "restaurant" },
  style: {
    iconShape: "circle",
    borderColor: "#000",
    borderWidth: "2",
    textColor: "#fff",
    backgroundColor: "#f00",
  },
  osmId: 1,
  osmType: "node",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("searchPoi query-variant fallback (R13)", () => {
  it("fires the second variant when the first keeps 0 snippets", async () => {
    const emptyResponse = {
      ok: true,
      status: 200,
      json: async () => ({ results: [], unresponsive_engines: [] }),
    };
    const goodResponse = {
      ok: true,
      status: 200,
      json: async () => ({
        results: [
          {
            title: "Bistro du Port — Bayonne",
            url: "https://bistroduport.example.com",
            content: "Bistro du Port à Bayonne, cuisine locale, ouvert tous les jours 12:00-22:00.",
            engine: "google",
          },
        ],
        unresponsive_engines: [],
      }),
    };
    const fetchSpy = vi.fn().mockResolvedValueOnce(emptyResponse).mockResolvedValue(goodResponse);
    vi.stubGlobal("fetch", fetchSpy);

    await searchPoi(POI_FIXTURE, "Bayonne");

    // Regression: with the bug, searchPoi returned after a single request.
    expect(fetchSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// R20/R25: no manual abort listeners on the caller's signal — the native
// AbortSignal.any/timeout combination replaced the hand-rolled relay that
// used to accumulate listeners by the thousands on a batch signal
// ---------------------------------------------------------------------------

describe("abort listener cleanup (R20/R25)", () => {
  it("adds no manual listeners to the caller's signal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    );
    const ctrl = new AbortController();
    const addSpy = vi.spyOn(ctrl.signal, "addEventListener");

    const { reverseGeocode } = await import("../lib/enrichment/search");
    await reverseGeocode(43.5, -1.4, "/api", ctrl.signal);

    expect(addSpy.mock.calls.length).toBe(0);
  });
});
