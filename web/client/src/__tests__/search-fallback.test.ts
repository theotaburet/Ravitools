// SearchPoi must try the next query variant when the first one keeps
// zero snippets (the fallback was dead code except on throw)

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
  traceId: "trace_1",
  tags: { name: "Bistro du Port", amenity: "restaurant" },
  osmId: 1,
  osmType: "node",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("searchPoi query-variant fallback", () => {
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
            title: "Bistro du Port: Bayonne",
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

describe("searchPoi language", () => {
  const okResponse = {
    ok: true,
    status: 200,
    json: async () => ({ results: [], unresponsive_engines: [] }),
  };

  it("asks SearXNG in the country's language with that language's words", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okResponse);
    vi.stubGlobal("fetch", fetchSpy);

    await searchPoi(POI_FIXTURE, "Wien", undefined, 0, {
      locality: "Wien",
      county: null,
      state: null,
      country: "Österreich",
      countryCode: "at",
    });

    const body = JSON.parse(String(fetchSpy.mock.calls[0][1].body));
    expect(body.language).toBe("de");
    expect(body.query).toContain("Bewertungen");
  });

  it("defaults to English without a geocoded country", async () => {
    const fetchSpy = vi.fn().mockResolvedValue(okResponse);
    vi.stubGlobal("fetch", fetchSpy);

    await searchPoi(POI_FIXTURE, null, undefined, 0);

    const body = JSON.parse(String(fetchSpy.mock.calls[0][1].body));
    expect(body.language).toBe("en");
    expect(body.query).toContain("reviews");
  });
});

// No manual abort listeners on the caller's signal: the native
// AbortSignal.any/timeout combination replaced the hand-rolled relay that
// used to accumulate listeners by the thousands on a batch signal

describe("abort listener cleanup", () => {
  it("adds no manual listeners to the caller's signal", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, json: async () => ({}) })),
    );
    const ctrl = new AbortController();
    const addSpy = vi.spyOn(ctrl.signal, "addEventListener");

    const { reverseGeocode } = await import("../lib/enrichment/geocode");
    await reverseGeocode(43.5, -1.4, ctrl.signal);

    expect(addSpy.mock.calls.length).toBe(0);
  });
});
