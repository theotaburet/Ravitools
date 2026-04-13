// ---------------------------------------------------------------------------
// Tests for searchPoi – mock global fetch to test the real function logic
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { POI } from "../types";
import { searchPoi } from "../lib/enrichment/search";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    tags: { amenity: "restaurant" },
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

/** Build a successful SearXNG response body */
function makeSearxResponse(results: Array<{ title: string; url: string; content?: string; engine: string }>) {
  return {
    results,
    query: "test",
    number_of_results: results.length,
  };
}

// ---------------------------------------------------------------------------
// Mock fetch
// ---------------------------------------------------------------------------

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("searchPoi", () => {
  it("returns parsed snippets from a successful response", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeSearxResponse([
        { title: "Review 1", url: "https://a.com", content: "Great place", engine: "google" },
        { title: "Review 2", url: "https://b.com", content: "Nice food", engine: "bing" },
      ]),
    });

    const snippets = await searchPoi(makePoi(), "Tours", "/api");
    expect(snippets).toHaveLength(2);
    expect(snippets[0].title).toBe("Review 1");
    expect(snippets[0].content).toBe("Great place");
    expect(snippets[0].engine).toBe("google");
    expect(snippets[1].url).toBe("https://b.com");
  });

  it("deduplicates results by URL", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeSearxResponse([
        { title: "A", url: "https://same.com", content: "First", engine: "google" },
        { title: "B", url: "https://same.com", content: "Duplicate", engine: "bing" },
        { title: "C", url: "https://other.com", content: "Different", engine: "google" },
      ]),
    });

    const snippets = await searchPoi(makePoi(), null, "/api");
    expect(snippets).toHaveLength(2);
    expect(snippets[0].url).toBe("https://same.com");
    expect(snippets[1].url).toBe("https://other.com");
  });

  it("skips results with empty content", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeSearxResponse([
        { title: "No content", url: "https://a.com", content: "", engine: "google" },
        { title: "Only spaces", url: "https://b.com", content: "   ", engine: "google" },
        { title: "Has content", url: "https://c.com", content: "Real content", engine: "google" },
      ]),
    });

    const snippets = await searchPoi(makePoi(), null, "/api");
    expect(snippets).toHaveLength(1);
    expect(snippets[0].title).toBe("Has content");
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

    const snippets = await searchPoi(makePoi(), null, "/api");
    expect(snippets).toHaveLength(8);
  });

  it("retries on 429 with backoff", async () => {
    // First call: 429, second call: success
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 429, statusText: "Too Many Requests" })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeSearxResponse([
          { title: "After retry", url: "https://a.com", content: "Worked", engine: "google" },
        ]),
      });

    const snippets = await searchPoi(makePoi(), null, "/api", undefined, 1);
    expect(snippets).toHaveLength(1);
    expect(snippets[0].title).toBe("After retry");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("retries on 502/503/504 server errors", async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: false, status: 502, statusText: "Bad Gateway" })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeSearxResponse([
          { title: "OK", url: "https://a.com", content: "Good", engine: "google" },
        ]),
      });

    const snippets = await searchPoi(makePoi(), null, "/api", undefined, 1);
    expect(snippets).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  }, 10_000);

  it("throws on non-retryable HTTP error (e.g. 400)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
    });

    await expect(searchPoi(makePoi(), null, "/api", undefined, 0)).rejects.toThrow("Search failed: 400");
  });

  it("throws when signal is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(searchPoi(makePoi(), null, "/api", controller.signal)).rejects.toThrow("Cancelled");
  });

  it("returns empty array when SearXNG returns no results", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeSearxResponse([]),
    });

    const snippets = await searchPoi(makePoi(), null, "/api");
    expect(snippets).toHaveLength(0);
  });

  it("sends correct request body with query", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeSearxResponse([]),
    });

    await searchPoi(makePoi({ name: "Chez Marie" }), "Lyon", "/api");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/search");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.query).toContain('"Chez Marie"');
    expect(body.query).toContain("Lyon");
    expect(body.language).toBe("auto");
  });

  it("trims whitespace from snippet content", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeSearxResponse([
        { title: "T", url: "https://a.com", content: "  padded content  ", engine: "g" },
      ]),
    });

    const snippets = await searchPoi(makePoi(), null, "/api");
    expect(snippets[0].content).toBe("padded content");
  });

  it("uses 'unknown' for missing engine field", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        results: [{ title: "T", url: "https://a.com", content: "C", engine: "" }],
        query: "test",
      }),
    });

    const snippets = await searchPoi(makePoi(), null, "/api");
    // engine is "" which is falsy → should fallback to "unknown"
    expect(snippets[0].engine).toBe("unknown");
  });
});
