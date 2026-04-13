// ---------------------------------------------------------------------------
// Server endpoint tests (WS10)
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, vi, afterAll } from "vitest";
import request from "supertest";

// Set test environment before importing app (prevents app.listen)
process.env.NODE_ENV = "test";
// Disable rate limiting for tests – set high limits
process.env.RATE_LIMIT_MAX = "1000";

// Mock global fetch before importing app
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import app after mocks are set up
const { default: app } = await import("../index");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Create a fake Response object matching the Fetch API */
function fakeResponse(body: string, init: { status?: number; ok?: boolean } = {}): Response {
  const status = init.status ?? 200;
  return {
    ok: init.ok ?? (status >= 200 && status < 300),
    status,
    text: () => Promise.resolve(body),
    json: () => Promise.resolve(JSON.parse(body)),
    headers: new Headers({ "Content-Type": "application/json" }),
  } as unknown as Response;
}

/** Generate a unique Overpass query to avoid cache collisions between tests */
let queryCounter = 0;
function uniqueQuery(prefix = "test"): string {
  return `[out:json];node(${++queryCounter});out;`;
}

// ---------------------------------------------------------------------------
// /health
// ---------------------------------------------------------------------------

describe("/health", () => {
  it("returns status ok", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body).toHaveProperty("cache_keys");
    expect(res.body).toHaveProperty("uptime");
  });
});

// ---------------------------------------------------------------------------
// /cache/stats
// ---------------------------------------------------------------------------

describe("/cache/stats", () => {
  it("returns stats for all three caches", async () => {
    const res = await request(app).get("/cache/stats");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("overpass");
    expect(res.body).toHaveProperty("search");
    expect(res.body).toHaveProperty("geocode");
    expect(res.body.overpass).toHaveProperty("keys");
    expect(res.body.overpass).toHaveProperty("hits");
    expect(res.body.overpass).toHaveProperty("misses");
  });
});

// ---------------------------------------------------------------------------
// /overpass
// ---------------------------------------------------------------------------

describe("/overpass", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("rejects missing query", async () => {
    const res = await request(app)
      .post("/overpass")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing/);
  });

  it("rejects non-string query", async () => {
    const res = await request(app)
      .post("/overpass")
      .send({ data: 12345 });
    expect(res.status).toBe(400);
  });

  it("rejects oversized query", async () => {
    const res = await request(app)
      .post("/overpass")
      .send({ data: "x".repeat(40000) });
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too large/i);
  });

  it("proxies a valid query and returns data", async () => {
    const query = uniqueQuery("proxy");
    const upstream = JSON.stringify({ elements: [{ id: 1 }] });
    mockFetch.mockResolvedValueOnce(fakeResponse(upstream));

    const res = await request(app)
      .post("/overpass")
      .send({ data: query });

    expect(res.status).toBe(200);
    expect(res.headers["x-cache"]).toBe("MISS");
    expect(JSON.parse(res.text)).toEqual({ elements: [{ id: 1 }] });
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("returns cached response on second request", async () => {
    const query = uniqueQuery("cache");
    const upstream = JSON.stringify({ elements: [] });
    mockFetch.mockResolvedValueOnce(fakeResponse(upstream));

    // First request – cache MISS
    const res1 = await request(app)
      .post("/overpass")
      .send({ data: query });
    expect(res1.headers["x-cache"]).toBe("MISS");

    // Second request – cache HIT (no fetch)
    const res2 = await request(app)
      .post("/overpass")
      .send({ data: query });
    expect(res2.status).toBe(200);
    expect(res2.headers["x-cache"]).toBe("HIT");
    // fetch should not be called again
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("forwards upstream error status", async () => {
    const query = uniqueQuery("upstream-err");
    mockFetch.mockResolvedValueOnce(fakeResponse("Rate limited", { status: 429, ok: false }));

    const res = await request(app)
      .post("/overpass")
      .send({ data: query });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/Overpass API error/);
  });

  it("returns 504 on timeout (AbortError)", async () => {
    const query = uniqueQuery("timeout");
    const abortErr = new DOMException("The operation was aborted.", "AbortError");
    mockFetch.mockRejectedValueOnce(abortErr);

    const res = await request(app)
      .post("/overpass")
      .send({ data: query });
    expect(res.status).toBe(504);
    expect(res.body.error).toMatch(/timed out/i);
  });

  it("returns 502 on generic fetch failure", async () => {
    const query = uniqueQuery("network-err");
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const res = await request(app)
      .post("/overpass")
      .send({ data: query });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatch(/Failed to reach/);
  });

  it("accepts query from text body (form-encoded fallback)", async () => {
    const query = uniqueQuery("text-body");
    const upstream = JSON.stringify({ elements: [] });
    mockFetch.mockResolvedValueOnce(fakeResponse(upstream));

    const res = await request(app)
      .post("/overpass")
      .set("Content-Type", "application/x-www-form-urlencoded")
      .send(query);
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// /search
// ---------------------------------------------------------------------------

describe("/search", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("rejects missing query", async () => {
    const res = await request(app)
      .post("/search")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing/);
  });

  it("rejects non-string query", async () => {
    const res = await request(app)
      .post("/search")
      .send({ query: 42 });
    expect(res.status).toBe(400);
  });

  it("rejects oversized search query", async () => {
    const res = await request(app)
      .post("/search")
      .send({ query: "x".repeat(501) });
    expect(res.status).toBe(413);
    expect(res.body.error).toMatch(/too long/i);
  });

  it("proxies a valid search and returns data", async () => {
    const searchQuery = `Restaurant "Le Comptoir" Tours ${++queryCounter}`;
    const upstream = JSON.stringify({ results: [{ title: "Le Comptoir", url: "https://example.com" }] });
    mockFetch.mockResolvedValueOnce(fakeResponse(upstream));

    const res = await request(app)
      .post("/search")
      .send({ query: searchQuery });

    expect(res.status).toBe(200);
    expect(res.headers["x-cache"]).toBe("MISS");
    expect(JSON.parse(res.text).results).toHaveLength(1);
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("returns cached search on second request", async () => {
    const searchQuery = `Bakery "Le Pain" ${++queryCounter}`;
    const upstream = JSON.stringify({ results: [] });
    mockFetch.mockResolvedValueOnce(fakeResponse(upstream));

    await request(app).post("/search").send({ query: searchQuery });
    const res2 = await request(app).post("/search").send({ query: searchQuery });

    expect(res2.headers["x-cache"]).toBe("HIT");
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("passes language parameter to SearXNG", async () => {
    const searchQuery = `Boulangerie ${++queryCounter}`;
    mockFetch.mockResolvedValueOnce(fakeResponse(JSON.stringify({ results: [] })));

    await request(app)
      .post("/search")
      .send({ query: searchQuery, language: "fr" });

    expect(mockFetch).toHaveBeenCalledOnce();
    const fetchUrl = mockFetch.mock.calls[0][0] as string;
    expect(fetchUrl).toContain("language=fr");
  });

  it("forwards upstream error status", async () => {
    const searchQuery = `Error test ${++queryCounter}`;
    mockFetch.mockResolvedValueOnce(fakeResponse("Service unavailable", { status: 503, ok: false }));

    const res = await request(app)
      .post("/search")
      .send({ query: searchQuery });
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/SearXNG/);
  });

  it("returns 504 on timeout", async () => {
    const searchQuery = `Timeout test ${++queryCounter}`;
    const abortErr = new DOMException("Aborted", "AbortError");
    mockFetch.mockRejectedValueOnce(abortErr);

    const res = await request(app)
      .post("/search")
      .send({ query: searchQuery });
    expect(res.status).toBe(504);
    expect(res.body.error).toMatch(/timed out/i);
  });

  it("returns 502 on network failure", async () => {
    const searchQuery = `Network fail ${++queryCounter}`;
    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const res = await request(app)
      .post("/search")
      .send({ query: searchQuery });
    expect(res.status).toBe(502);
  });
});

// ---------------------------------------------------------------------------
// /geocode
// ---------------------------------------------------------------------------

describe("/geocode", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("rejects missing lat/lon", async () => {
    const res = await request(app)
      .post("/geocode")
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing/);
  });

  it("rejects lat without lon", async () => {
    const res = await request(app)
      .post("/geocode")
      .send({ lat: 47.0 });
    expect(res.status).toBe(400);
  });

  it("rejects non-numeric coordinates", async () => {
    const res = await request(app)
      .post("/geocode")
      .send({ lat: "foo", lon: "bar" });
    expect(res.status).toBe(400);
  });

  it("rejects out-of-range latitude", async () => {
    const res = await request(app)
      .post("/geocode")
      .send({ lat: 95.0, lon: 2.0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid coordinates/);
  });

  it("rejects out-of-range longitude", async () => {
    const res = await request(app)
      .post("/geocode")
      .send({ lat: 47.0, lon: 200.0 });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid coordinates/);
  });

  it("proxies valid coordinates and returns data", async () => {
    // Use unique coords to avoid cache collisions
    const lat = 47.0 + queryCounter * 0.01;
    const lon = 0.6 + queryCounter * 0.01;
    queryCounter++;

    const upstream = JSON.stringify({
      display_name: "Tours, Indre-et-Loire, France",
      address: { city: "Tours", country: "France" },
    });
    mockFetch.mockResolvedValueOnce(fakeResponse(upstream));

    const res = await request(app)
      .post("/geocode")
      .send({ lat, lon });

    expect(res.status).toBe(200);
    expect(res.headers["x-cache"]).toBe("MISS");
    expect(JSON.parse(res.text).display_name).toContain("Tours");
  });

  it("returns cached geocode on second request (same rounded coords)", async () => {
    // Two coords that round to the same value at 0.001 precision
    const lat = 48.0001 + queryCounter * 0.01;
    const lon = 2.0001 + queryCounter * 0.01;
    queryCounter++;

    const upstream = JSON.stringify({ display_name: "Paris" });
    mockFetch.mockResolvedValueOnce(fakeResponse(upstream));

    await request(app).post("/geocode").send({ lat, lon });

    // Same coords, slightly different but rounds the same
    const res2 = await request(app).post("/geocode").send({ lat: lat + 0.0001, lon: lon + 0.0001 });
    expect(res2.headers["x-cache"]).toBe("HIT");
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("forwards upstream error status", async () => {
    const lat = 49.0 + queryCounter * 0.01;
    const lon = 3.0 + queryCounter * 0.01;
    queryCounter++;

    mockFetch.mockResolvedValueOnce(fakeResponse("Error", { status: 500, ok: false }));

    const res = await request(app)
      .post("/geocode")
      .send({ lat, lon });
    expect(res.status).toBe(500);
    expect(res.body.error).toMatch(/Nominatim/);
  });

  it("returns 504 on timeout", async () => {
    const lat = 50.0 + queryCounter * 0.01;
    const lon = 4.0 + queryCounter * 0.01;
    queryCounter++;

    const abortErr = new DOMException("Aborted", "AbortError");
    mockFetch.mockRejectedValueOnce(abortErr);

    const res = await request(app)
      .post("/geocode")
      .send({ lat, lon });
    expect(res.status).toBe(504);
    expect(res.body.error).toMatch(/timed out/i);
  });

  it("returns 502 on network failure", async () => {
    const lat = 51.0 + queryCounter * 0.01;
    const lon = 5.0 + queryCounter * 0.01;
    queryCounter++;

    mockFetch.mockRejectedValueOnce(new Error("ECONNREFUSED"));

    const res = await request(app)
      .post("/geocode")
      .send({ lat, lon });
    expect(res.status).toBe(502);
  });

  it("includes User-Agent header in Nominatim requests", async () => {
    const lat = 52.0 + queryCounter * 0.01;
    const lon = 6.0 + queryCounter * 0.01;
    queryCounter++;

    mockFetch.mockResolvedValueOnce(fakeResponse(JSON.stringify({ display_name: "Test" })));

    await request(app).post("/geocode").send({ lat, lon });

    const fetchCall = mockFetch.mock.calls[0];
    const fetchOptions = fetchCall[1] as RequestInit;
    const headers = fetchOptions.headers as Record<string, string>;
    expect(headers["User-Agent"]).toMatch(/Ravitools/);
  });

  it("accepts boundary coordinates (lat=90, lon=180)", async () => {
    // These should be valid, not rejected
    const upstream = JSON.stringify({ display_name: "North Pole" });
    mockFetch.mockResolvedValueOnce(fakeResponse(upstream));

    const res = await request(app)
      .post("/geocode")
      .send({ lat: 90, lon: 180 });
    expect(res.status).toBe(200);
  });
});
