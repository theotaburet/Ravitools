// --- Tests for searchPoi: mock global fetch to test the real function logic ---

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { searchPoi } from "../lib/enrichment/search";
import type { POI } from "../types";

// --- Helpers ---

function makePoi(overrides: Partial<POI> = {}): POI {
  return {
    id: "sp-1",
    lat: 47.3941,
    lon: 0.6848,
    category: "Restaurant or Bar",
    name: "Le Petit Zinc",
    icon: "utensils",
    distanceToTrace: 120,
    alongTraceDistance: 5000,
    traceId: "trace_1",
    tags: { amenity: "restaurant" },
    ...overrides,
  };
}

/** Build a successful SearXNG response body. Real sources name the place, so every title does too. */
function makeSearxResponse(
  results: Array<{ title: string; url: string; content?: string; engine: string }>,
) {
  return {
    results: results.map((r) => ({ ...r, title: `Le Petit Zinc: ${r.title}` })),
    query: "test",
    number_of_results: results.length,
  };
}

// --- Mock fetch ---

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// --- Tests ---

describe("searchPoi", () => {
  it("returns parsed snippets from a successful response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () =>
        makeSearxResponse([
          { title: "Review 1", url: "https://a.com", content: "Great place", engine: "google" },
          { title: "Review 2", url: "https://b.com", content: "Nice food", engine: "bing" },
        ]),
    });

    const result = await searchPoi(makePoi(), "Tours");
    expect(result.snippets).toHaveLength(2);
    expect(result.snippets[0].title).toBe("Le Petit Zinc: Review 1");
    expect(result.snippets[0].content).toBe("Great place");
    expect(result.snippets[0].engine).toBe("google");
    expect(result.snippets[1].url).toBe("https://b.com");
    expect(result.query).toContain('"Le Petit Zinc"');
  });

  it("deduplicates results by URL", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () =>
        makeSearxResponse([
          { title: "A", url: "https://same.com", content: "First", engine: "google" },
          { title: "B", url: "https://same.com", content: "Duplicate", engine: "bing" },
          { title: "C", url: "https://other.com", content: "Different", engine: "google" },
        ]),
    });

    const result = await searchPoi(makePoi(), null);
    expect(result.snippets).toHaveLength(2);
    expect(result.snippets[0].url).toBe("https://same.com");
    expect(result.snippets[1].url).toBe("https://other.com");
  });

  it("skips results with empty content", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () =>
        makeSearxResponse([
          { title: "No content", url: "https://a.com", content: "", engine: "google" },
          { title: "Only spaces", url: "https://b.com", content: "   ", engine: "google" },
          { title: "Has content", url: "https://c.com", content: "Real content", engine: "google" },
        ]),
    });

    const result = await searchPoi(makePoi(), null);
    expect(result.snippets).toHaveLength(1);
    expect(result.snippets[0].title).toBe("Le Petit Zinc: Has content");
  });

  it("limits results to MAX_SNIPPETS (8)", async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      title: `Result ${i}`,
      url: `https://r${i}.com`,
      content: `Content ${i}`,
      engine: "google",
    }));

    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeSearxResponse(many),
    });

    const result = await searchPoi(makePoi(), null);
    expect(result.snippets).toHaveLength(8);
  });

  it("retries on 429 with backoff", async () => {
    // First call: 429, second call: success
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: "Too Many Requests" })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () =>
          makeSearxResponse([
            { title: "After retry", url: "https://a.com", content: "Worked", engine: "google" },
          ]),
      });

    const result = await searchPoi(makePoi(), null, undefined, 1);
    expect(result.snippets).toHaveLength(1);
    expect(result.snippets[0].title).toBe("Le Petit Zinc: After retry");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("retries on 502/503/504 server errors", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 502, statusText: "Bad Gateway" })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () =>
          makeSearxResponse([
            { title: "OK", url: "https://a.com", content: "Good", engine: "google" },
          ]),
      });

    const result = await searchPoi(makePoi(), null, undefined, 1);
    expect(result.snippets).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("throws on non-retryable HTTP error (e.g. 400)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
    });

    await expect(searchPoi(makePoi(), null, undefined, 0)).rejects.toThrow("Search failed: 400");
  });

  it("throws when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(searchPoi(makePoi(), null, controller.signal)).rejects.toThrow("Cancelled");
  });

  it("returns empty array when SearXNG returns no results", async () => {
    // SearchPoi tries every query variant on a 0-snippet
    // response, so the empty result must be mocked for all calls, not once.
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeSearxResponse([]),
    });

    const result = await searchPoi(makePoi(), null);
    expect(result.snippets).toHaveLength(0);
  });

  it("sends correct request body with query", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeSearxResponse([]),
    });

    await searchPoi(makePoi({ name: "Chez Marie" }), "Lyon");

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/search");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.query).toContain('"Chez Marie"');
    expect(body.query).toContain("Lyon");
    // No geocoded country here: the search falls back to English
    expect(body.language).toBe("en");
    expect(body.engines).toBe("bing,yandex");
  });

  it("keeps county and region out of the query even when the geocoder provides them", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeSearxResponse([]),
    });

    await searchPoi(makePoi({ name: "Chez Marie" }), "Lyon", undefined, 3, {
      locality: "Lyon",
      county: "Rhône",
      state: "Auvergne-Rhône-Alpes",
      country: "France",
      countryCode: "fr",
    });

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.query).toBe('"Chez Marie" Lyon avis restaurant horaires');
  });

  it("trims whitespace from snippet content", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () =>
        makeSearxResponse([
          { title: "T", url: "https://a.com", content: "  padded content  ", engine: "g" },
        ]),
    });

    const result = await searchPoi(makePoi(), null);
    expect(result.snippets[0].content).toBe("padded content");
  });

  it("uses 'unknown' for missing engine field", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        results: [{ title: "Le Petit Zinc: T", url: "https://a.com", content: "C", engine: "" }],
        query: "test",
      }),
    });

    const result = await searchPoi(makePoi(), null);
    // engine is "" which is falsy → should fallback to "unknown"
    expect(result.snippets[0].engine).toBe("unknown");
  });
});
