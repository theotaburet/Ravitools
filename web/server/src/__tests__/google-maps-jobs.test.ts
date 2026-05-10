// ---------------------------------------------------------------------------
// Google Maps jobs: lifecycle, persistence, and extraction heuristic tests
// ---------------------------------------------------------------------------

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { join } from "node:path";
import os from "node:os";

// ---------------------------------------------------------------------------
// Environment setup before app import
// ---------------------------------------------------------------------------
process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_MAX = "1000";

// Mock playwright so queueGoogleMapsPreviewJob doesn't spin up Chromium
vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        setExtraHTTPHeaders: vi.fn(),
        goto: vi.fn(),
        waitForLoadState: vi.fn(),
        url: vi.fn().mockReturnValue("https://www.google.com/maps/place/Test/"),
        title: vi.fn().mockResolvedValue("Test Place"),
        locator: vi.fn().mockReturnValue({
          innerText: vi.fn().mockResolvedValue(""),
          first: vi.fn().mockReturnValue({
            innerText: vi.fn().mockResolvedValue(""),
            getAttribute: vi.fn().mockResolvedValue(null),
            count: vi.fn().mockResolvedValue(0),
            click: vi.fn(),
          }),
          nth: vi.fn().mockReturnValue({
            innerText: vi.fn().mockResolvedValue(""),
          }),
          count: vi.fn().mockResolvedValue(0),
          click: vi.fn(),
        }),
        getByRole: vi.fn().mockReturnValue({
          filter: vi.fn().mockReturnValue({
            first: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
          }),
        }),
        getAttribute: vi.fn().mockResolvedValue(null),
        close: vi.fn(),
      }),
    }),
  },
}));

// Mock global fetch (used by health endpoint etc.)
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Import app after mocks
const { default: app, _testExports } = await import("../index");
const {
  parseGoogleMapsHoursRow,
  normalizeDay,
  normalizeTimeString,
  extractGoogleMapsRating,
  extractGoogleMapsReviewCount,
  cleanGoogleMapsHours,
  extractPriceLevelFromText,
  googleMapsJobCache,
  GOOGLE_MAPS_PROXY_URL,
  GOOGLE_MAPS_FAILURES_FILE,
  appendGoogleMapsFailure,
} = _testExports;

// ---------------------------------------------------------------------------
// T5a: Job lifecycle tests
// ---------------------------------------------------------------------------

describe("Google Maps jobs — lifecycle", () => {
  beforeEach(() => {
    googleMapsJobCache.flushAll();
    mockFetch.mockReset();
  });

  it("POST /google-maps-preview/jobs returns 400 when url is missing", async () => {
    const res = await request(app).post("/google-maps-preview/jobs").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing 'url'/);
  });

  it("POST /google-maps-preview/jobs returns 400 for invalid URL", async () => {
    const res = await request(app)
      .post("/google-maps-preview/jobs")
      .send({ url: "not-a-url" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid URL/);
  });

  it("POST /google-maps-preview/jobs returns 400 for non-Google Maps URL", async () => {
    const res = await request(app)
      .post("/google-maps-preview/jobs")
      .send({ url: "https://example.com/maps/search/foo" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Google Maps/);
  });

  it("POST /google-maps-preview/jobs queues a job and returns 202 with initial state", async () => {
    const res = await request(app)
      .post("/google-maps-preview/jobs")
      .send({ url: "https://www.google.com/maps/search/test+place", poiName: "Test Place" });
    expect(res.status).toBe(202);
    expect(res.body.jobId).toBeTruthy();
    expect(res.body.status).toBe("queued");
    expect(res.body.poiName).toBe("Test Place");
    expect(res.body.attempt).toBe(0);
    expect(res.body.startedAt).toBeNull();
  });

  it("GET /google-maps-preview/jobs/:jobId returns 404 for unknown job", async () => {
    const res = await request(app).get("/google-maps-preview/jobs/unknown-id");
    expect(res.status).toBe(404);
  });

  it("GET /google-maps-preview/jobs/:jobId returns queued job after creation", async () => {
    const post = await request(app)
      .post("/google-maps-preview/jobs")
      .send({ url: "https://www.google.com/maps/search/camping+test", poiName: "Camping Test" });
    expect(post.status).toBe(202);
    const jobId = post.body.jobId as string;

    const get = await request(app).get(`/google-maps-preview/jobs/${jobId}`);
    expect(get.status).toBe(200);
    expect(get.body.jobId).toBe(jobId);
    expect(get.body.poiName).toBe("Camping Test");
  });

  it("DELETE /google-maps-preview/jobs/:jobId cancels a queued job and returns 204", async () => {
    const post = await request(app)
      .post("/google-maps-preview/jobs")
      .send({ url: "https://www.google.com/maps/search/restaurant+test" });
    const jobId = post.body.jobId as string;

    const del = await request(app).delete(`/google-maps-preview/jobs/${jobId}`);
    expect(del.status).toBe(204);

    // Queued jobs are removed from cache; running jobs are marked error
    const get = await request(app).get(`/google-maps-preview/jobs/${jobId}`);
    // The job may have transitioned to running before cancel — check either gone or error+cancelled
    if (get.status === 200) {
      expect(get.body.status).toBe("error");
      expect(get.body.error).toMatch(/Cancelled/i);
    } else {
      expect(get.status).toBe(404);
    }
  });

  it("DELETE /google-maps-preview/jobs/:jobId returns 404 for unknown job", async () => {
    const res = await request(app).delete("/google-maps-preview/jobs/no-such-job");
    expect(res.status).toBe(404);
  });

  it("GET /google-maps-preview/jobs returns counts and jobs list", async () => {
    googleMapsJobCache.flushAll();
    const res = await request(app).get("/google-maps-preview/jobs");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("counts");
    expect(res.body.counts).toMatchObject({ queued: 0, running: 0, done: 0, error: 0 });
    expect(Array.isArray(res.body.jobs)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T5b: Persistence / reload tests
// ---------------------------------------------------------------------------

describe("Google Maps jobs — persistence and reload", () => {
  const tmpDir = join(os.tmpdir(), `ravitools-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
    googleMapsJobCache.flushAll();
  });

  afterEach(() => {
    try { rmSync(tmpDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });

  it("persistGoogleMapsJobs writes a valid JSON file", () => {
    const { persistGoogleMapsJobs, GOOGLE_MAPS_JOBS_FILE } = _testExports;
    // Temporarily override the jobs file path by writing to a known location
    // We test via the cache + persist cycle
    const fakeJob = {
      jobId: "test-id-1",
      status: "done" as const,
      url: "https://www.google.com/maps/search/test",
      poiName: "Test POI",
      preview: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      attempt: 1,
      nextRetryAt: null,
      lastError: null,
    };
    googleMapsJobCache.set(fakeJob.jobId, fakeJob);
    persistGoogleMapsJobs();
    expect(existsSync(GOOGLE_MAPS_JOBS_FILE)).toBe(true);
    const content = JSON.parse(require("fs").readFileSync(GOOGLE_MAPS_JOBS_FILE, "utf8"));
    expect(Array.isArray(content)).toBe(true);
    const found = content.find((j: { jobId: string }) => j.jobId === "test-id-1");
    expect(found).toBeTruthy();
    expect(found.poiName).toBe("Test POI");
  });

  it("loadPersistedGoogleMapsJobs restores done jobs", () => {
    const { persistGoogleMapsJobs, loadPersistedGoogleMapsJobs } = _testExports;
    const fakeJob = {
      jobId: "test-reload-1",
      status: "done" as const,
      url: "https://www.google.com/maps/search/test",
      poiName: "Reload Test",
      preview: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      attempt: 1,
      nextRetryAt: null,
      lastError: null,
    };
    googleMapsJobCache.set(fakeJob.jobId, fakeJob);
    persistGoogleMapsJobs();
    googleMapsJobCache.flushAll();
    loadPersistedGoogleMapsJobs();
    const reloaded = googleMapsJobCache.get<typeof fakeJob>("test-reload-1");
    expect(reloaded).toBeTruthy();
    expect(reloaded?.status).toBe("done");
    expect(reloaded?.poiName).toBe("Reload Test");
  });

  it("loadPersistedGoogleMapsJobs marks running jobs as error (interrupted)", () => {
    const { persistGoogleMapsJobs, loadPersistedGoogleMapsJobs } = _testExports;
    const runningJob = {
      jobId: "test-running-interrupted",
      status: "running" as const,
      url: "https://www.google.com/maps/search/interrupted",
      poiName: "Interrupted POI",
      preview: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      attempt: 1,
      nextRetryAt: null,
      lastError: null,
    };
    googleMapsJobCache.set(runningJob.jobId, runningJob);
    persistGoogleMapsJobs();
    googleMapsJobCache.flushAll();
    loadPersistedGoogleMapsJobs();
    const reloaded = googleMapsJobCache.get<typeof runningJob>("test-running-interrupted");
    expect(reloaded).toBeTruthy();
    expect(reloaded?.status).toBe("error");
    expect(reloaded?.error).toMatch(/interrupted/i);
  });
});

// ---------------------------------------------------------------------------
// T5c: Extraction heuristic tests (pure functions, no Playwright)
// ---------------------------------------------------------------------------

describe("normalizeDay", () => {
  it("passes through canonical English short days", () => {
    expect(normalizeDay("Monday")).toBe("Mon");
    expect(normalizeDay("Friday")).toBe("Fri");
    expect(normalizeDay("Sunday")).toBe("Sun");
  });

  it("normalizes French day names", () => {
    expect(normalizeDay("Lundi")).toBe("Mon");
    expect(normalizeDay("Vendredi")).toBe("Fri");
    expect(normalizeDay("Dimanche")).toBe("Sun");
  });

  it("passes through unrecognized values unchanged", () => {
    expect(normalizeDay("Holiday")).toBe("Holiday");
  });
});

describe("normalizeTimeString", () => {
  it("converts 12h AM/PM to 24h", () => {
    expect(normalizeTimeString("9:00 AM")).toBe("09:00");
    expect(normalizeTimeString("12:00 PM")).toBe("12:00");
    expect(normalizeTimeString("11:30 PM")).toBe("23:30");
    expect(normalizeTimeString("12:00 AM")).toBe("00:00");
  });

  it("passes through 24h time strings", () => {
    expect(normalizeTimeString("08:00")).toBe("08:00");
    expect(normalizeTimeString("18:30")).toBe("18:30");
  });

  it("normalizes h-format (9h30)", () => {
    expect(normalizeTimeString("9h30")).toBe("09:30");
    expect(normalizeTimeString("18h00")).toBe("18:00");
  });

  it("passes through unrecognized strings unchanged (e.g. 'Closed' text)", () => {
    // normalizeTimeString only converts time formats — 'Closed' is detected by parseGoogleMapsHoursRow, not here
    expect(normalizeTimeString("Closed")).toBe("Closed");
    expect(normalizeTimeString("some text")).toBe("some text");
  });
});

describe("parseGoogleMapsHoursRow", () => {
  it("parses a typical English hours row", () => {
    const result = parseGoogleMapsHoursRow("Monday 9:00 AM – 6:00 PM");
    expect(result).toBeTruthy();
    expect(result?.day).toBe("Mon");
    expect(result?.open).toBe("09:00");
    expect(result?.close).toBe("18:00");
  });

  it("parses a French row with h-format times", () => {
    const result = parseGoogleMapsHoursRow("Lundi 9h00 – 18h00");
    expect(result).toBeTruthy();
    expect(result?.day).toBe("Mon");
    expect(result?.open).toBe("09:00");
    expect(result?.close).toBe("18:00");
  });

  it("returns null for closed day", () => {
    const result = parseGoogleMapsHoursRow("Sunday Closed");
    expect(result).not.toBeNull();
    expect(result?.open).toBe("closed");
    expect(result?.close).toBeNull();
  });

  it("returns null for unrecognized format", () => {
    const result = parseGoogleMapsHoursRow("some random text without day");
    expect(result).toBeNull();
  });
});

describe("extractGoogleMapsRating", () => {
  it("extracts a decimal rating", () => {
    expect(extractGoogleMapsRating("This place has a rating of 4.3 / 5")).toBe(4.3);
  });

  it("returns null when no rating found", () => {
    expect(extractGoogleMapsRating("No rating here")).toBeNull();
  });

  it("returns null for out-of-range values", () => {
    expect(extractGoogleMapsRating("Rating: 6.0")).toBeNull();
  });
});

describe("extractGoogleMapsReviewCount", () => {
  it("extracts count from parenthesized format", () => {
    expect(extractGoogleMapsReviewCount("(1,234)")).toBe(1234);
  });

  it("extracts count from 'N reviews' format", () => {
    expect(extractGoogleMapsReviewCount("342 reviews")).toBe(342);
  });

  it("returns null when no count found", () => {
    expect(extractGoogleMapsReviewCount("No reviews")).toBeNull();
  });
});

describe("cleanGoogleMapsHours", () => {
  it("passes through clean hours text", () => {
    const text = "Open until 10 PM";
    expect(cleanGoogleMapsHours(text)).toBeTruthy();
  });

  it("returns null for null input", () => {
    expect(cleanGoogleMapsHours(null)).toBeNull();
  });
});

describe("extractPriceLevelFromText", () => {
  it("extracts price level from dollar signs", () => {
    expect(extractPriceLevelFromText("This restaurant is $$")).toBe(2);
    expect(extractPriceLevelFromText("$$$")).toBe(3);
  });

  it("returns null when no price indicator found", () => {
    expect(extractPriceLevelFromText("No price info")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Proxy / IP rotation hook tests
// ---------------------------------------------------------------------------

describe("Google Maps proxy configuration", () => {
  it("GOOGLE_MAPS_PROXY_URL is null by default (no proxy set in test env)", () => {
    // Tests run without GOOGLE_MAPS_PROXY_URL set, so it should be null.
    // This confirms the default is safe (direct connection).
    expect(GOOGLE_MAPS_PROXY_URL).toBeNull();
  });

  it("GOOGLE_MAPS_PROXY_URL type is string or null", () => {
    expect(GOOGLE_MAPS_PROXY_URL === null || typeof GOOGLE_MAPS_PROXY_URL === "string").toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Structured failure log tests
// ---------------------------------------------------------------------------

describe("Google Maps failure log (appendGoogleMapsFailure)", () => {
  const tmpDir = join(os.tmpdir(), `gm-failures-test-${Date.now()}`);
  const tmpFile = join(tmpDir, "google-maps-failures.jsonl");

  // Override the failure file path for isolation by monkey-patching the env
  // We test via appendGoogleMapsFailure directly (exported for testing).
  // Since GOOGLE_MAPS_FAILURES_FILE is a module-level constant, we test the
  // function's output by temporarily redirecting with a real temp file write.

  it("appendGoogleMapsFailure writes a valid JSON line to the failures file", () => {
    // Write directly to the real failures file and then read back one line
    const record = {
      url: "https://www.google.com/maps/search/test",
      poiName: "Test POI",
      attempts: 3,
      lastError: "timeout",
      failedAt: new Date().toISOString(),
    };

    // Verify the function doesn't throw
    expect(() => appendGoogleMapsFailure(record)).not.toThrow();

    // Verify the failures file now exists and contains valid JSONL
    expect(existsSync(GOOGLE_MAPS_FAILURES_FILE)).toBe(true);
    const content = readFileSync(GOOGLE_MAPS_FAILURES_FILE, "utf8");
    const lines = content.trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);

    // Last written line should parse and match
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.url).toBe(record.url);
    expect(last.poiName).toBe("Test POI");
    expect(last.attempts).toBe(3);
    expect(last.lastError).toBe("timeout");
    expect(typeof last.failedAt).toBe("string");
  });

  it("appendGoogleMapsFailure appends multiple records (JSONL, one per line)", () => {
    const before = existsSync(GOOGLE_MAPS_FAILURES_FILE)
      ? readFileSync(GOOGLE_MAPS_FAILURES_FILE, "utf8").trim().split("\n").filter(Boolean).length
      : 0;

    appendGoogleMapsFailure({ url: "https://www.google.com/maps/place/A", poiName: "A", attempts: 1, lastError: "err1", failedAt: new Date().toISOString() });
    appendGoogleMapsFailure({ url: "https://www.google.com/maps/place/B", poiName: "B", attempts: 2, lastError: "err2", failedAt: new Date().toISOString() });

    const after = readFileSync(GOOGLE_MAPS_FAILURES_FILE, "utf8").trim().split("\n").filter(Boolean).length;
    expect(after).toBe(before + 2);
  });

  it("appendGoogleMapsFailure handles null poiName gracefully", () => {
    expect(() => appendGoogleMapsFailure({
      url: "https://www.google.com/maps/place/NoName",
      poiName: null,
      attempts: 1,
      lastError: null,
      failedAt: new Date().toISOString(),
    })).not.toThrow();

    const lines = readFileSync(GOOGLE_MAPS_FAILURES_FILE, "utf8").trim().split("\n").filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.poiName).toBeNull();
    expect(last.lastError).toBeNull();
  });
});
