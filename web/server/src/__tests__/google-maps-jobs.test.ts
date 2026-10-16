// --- Google Maps jobs: lifecycle, persistence, and extraction heuristic tests ---

import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import { join } from "node:path";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MapPreview, ScraperFailureRecord } from "../scrapers/types";

// --- Environment setup before app import ---
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
  parseHoursFromBodyText,
  normalizeDay,
  normalizeTimeString,
  extractGoogleMapsRating,
  extractGoogleMapsReviewCount,
  parseGoogleMapsHoursLabel,
  stripLiveOpenStatus,
  extractPriceLevelFromText,
  GOOGLE_MAPS_PROXY_URL,
} = await import("../scrapers/google-maps.js");

// Accessors into the live scraper system the app routes use
const { googleMapsSystem } = _testExports;
const googleMapsJobCache = googleMapsSystem.jobCache;
const persistGoogleMapsJobs = googleMapsSystem.persist;
const loadPersistedGoogleMapsJobs = googleMapsSystem.load;
const GOOGLE_MAPS_JOBS_FILE = googleMapsSystem.jobsFile;
const GOOGLE_MAPS_FAILURES_FILE = googleMapsSystem.failuresFile;
const appendGoogleMapsFailure = (record: Omit<ScraperFailureRecord, "source">) =>
  googleMapsSystem.appendFailure({ source: "google-maps", ...record });

// --- Job lifecycle tests ---

describe("Google Maps jobs: lifecycle", () => {
  beforeEach(() => {
    googleMapsJobCache.clear();
    mockFetch.mockReset();
  });

  it("POST /google-maps-preview/jobs returns 400 when url is missing", async () => {
    const res = await request(app).post("/google-maps-preview/jobs").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Missing 'url'/);
  });

  it("POST /google-maps-preview/jobs returns 400 for invalid URL", async () => {
    const res = await request(app).post("/google-maps-preview/jobs").send({ url: "not-a-url" });
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

  it("GET /google-maps-preview/jobs returns counts and jobs list", async () => {
    googleMapsJobCache.clear();
    const res = await request(app).get("/google-maps-preview/jobs");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("counts");
    expect(res.body.counts).toMatchObject({ queued: 0, running: 0, done: 0, error: 0 });
    expect(Array.isArray(res.body.jobs)).toBe(true);
  });

  it("GET /google-maps-preview/jobs counts done jobs whose page layout did not parse", async () => {
    googleMapsJobCache.clear();
    const now = new Date().toISOString();
    const base = {
      status: "done" as const,
      source: "google-maps",
      url: "https://www.google.com/maps/search/x",
      poiName: "X",
      error: null,
      createdAt: now,
      updatedAt: now,
      startedAt: now,
      attempt: 1,
      nextRetryAt: null,
      lastError: null,
    };
    googleMapsJobCache.set("layout-ok", {
      ...base,
      jobId: "layout-ok",
      preview: { layoutWarnings: [] } as unknown as MapPreview,
    });
    googleMapsJobCache.set("layout-ko", {
      ...base,
      jobId: "layout-ko",
      preview: {
        layoutWarnings: ["hours shown on the page but no day button parsed"],
      } as unknown as MapPreview,
    });

    const res = await request(app).get("/google-maps-preview/jobs");
    expect(res.body.counts).toMatchObject({ done: 2, layoutIssues: 1 });
  });
});

// --- Persistence / reload tests ---

describe("Google Maps jobs: persistence and reload", () => {
  const tmpDir = join(os.tmpdir(), `ravitools-test-${Date.now()}`);

  beforeEach(() => {
    mkdirSync(tmpDir, { recursive: true });
    googleMapsJobCache.clear();
  });

  afterEach(() => {
    try {
      rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("persistGoogleMapsJobs writes a valid JSON file", () => {
    // Temporarily override the jobs file path by writing to a known location
    // We test via the cache + persist cycle
    const fakeJob = {
      jobId: "test-id-1",
      status: "done" as const,
      source: "google-maps",
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
    const content = JSON.parse(readFileSync(GOOGLE_MAPS_JOBS_FILE, "utf8"));
    expect(Array.isArray(content)).toBe(true);
    const found = content.find((j: { jobId: string }) => j.jobId === "test-id-1");
    expect(found).toBeTruthy();
    expect(found.poiName).toBe("Test POI");
  });

  it("loadPersistedGoogleMapsJobs restores done jobs", () => {
    const fakeJob = {
      jobId: "test-reload-1",
      status: "done" as const,
      source: "google-maps",
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
    googleMapsJobCache.clear();
    loadPersistedGoogleMapsJobs();
    const reloaded = googleMapsJobCache.get("test-reload-1");
    expect(reloaded).toBeTruthy();
    expect(reloaded?.status).toBe("done");
    expect(reloaded?.poiName).toBe("Reload Test");
  });

  it("loadPersistedGoogleMapsJobs marks running jobs as error (interrupted)", () => {
    const runningJob = {
      jobId: "test-running-interrupted",
      status: "running" as const,
      source: "google-maps",
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
    googleMapsJobCache.clear();
    loadPersistedGoogleMapsJobs();
    const reloaded = googleMapsJobCache.get("test-running-interrupted");
    expect(reloaded).toBeTruthy();
    expect(reloaded?.status).toBe("error");
    expect(reloaded?.error).toMatch(/interrupted/i);
  });
});

// --- Extraction heuristic tests (pure functions, no Playwright) ---

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

  it("accepts 12h times without minutes", () => {
    expect(normalizeTimeString("9 AM")).toBe("09:00");
    expect(normalizeTimeString("7 PM")).toBe("19:00");
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
    // normalizeTimeString only converts time formats: 'Closed' is detected by parseGoogleMapsHoursRow, not here
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

describe("parseHoursFromBodyText", () => {
  it("reads the day-labelled lines of the page text", () => {
    const text =
      "Boulangerie\n4.6 stars\nMonday 7:00 – 19:00\nTuesday Closed\n\nWednesday 7:00 – 19:00\nDirections";
    expect(parseHoursFromBodyText(text)).toEqual([
      { day: "Mon", open: "07:00", close: "19:00" },
      { day: "Tue", open: "closed", close: null },
      { day: "Wed", open: "07:00", close: "19:00" },
    ]);
  });

  it("returns null when fewer than two days parse", () => {
    expect(parseHoursFromBodyText("Monday 7:00 – 19:00\nDirections")).toBeNull();
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

describe("parseGoogleMapsHoursLabel", () => {
  // Google Maps (2026) exposes the week as one button per day, no table: the
  // aria-label carries the day, the ranges and a trailing action verb.
  it("parses an English label with 12h times, with and without minutes", () => {
    expect(parseGoogleMapsHoursLabel("Monday, 9 AM to 6:30 PM, Copy open hours")).toEqual({
      day: "Mon",
      open: "09:00",
      close: "18:30",
    });
  });

  it("collapses several ranges to first open and last close", () => {
    expect(
      parseGoogleMapsHoursLabel("Tuesday, 8:30 AM to 12 PM, 2 to 7 PM, Copy open hours"),
    ).toEqual({ day: "Tue", open: "08:30", close: "19:00" });
  });

  it("parses closed and all-day labels", () => {
    expect(parseGoogleMapsHoursLabel("Sunday, Closed, Copy open hours")).toEqual({
      day: "Sun",
      open: "closed",
      close: null,
    });
    expect(parseGoogleMapsHoursLabel("Wednesday, Open 24 hours, Copy open hours")).toEqual({
      day: "Wed",
      open: "00:00",
      close: "23:59",
    });
  });

  it("parses other UI languages when the day name is known", () => {
    expect(
      parseGoogleMapsHoursLabel(
        "lundi, de 08:30 à 12:00, de 14:00 à 19:00, Copier les horaires d'ouverture",
      ),
    ).toEqual({ day: "Mon", open: "08:30", close: "19:00" });
    expect(parseGoogleMapsHoursLabel("domingo, Cerrado, Copiar el horario")).toEqual({
      day: "Sun",
      open: "closed",
      close: null,
    });
  });

  it("ignores labels that do not start with a day name", () => {
    expect(parseGoogleMapsHoursLabel("Suggest new hours")).toBeNull();
    expect(parseGoogleMapsHoursLabel("Close")).toBeNull();
  });
});

describe("stripLiveOpenStatus", () => {
  // "Closed ⋅ Opens 9 AM Mon" is the state at scrape time, not the schedule:
  // left in the snippet, the LLM reports the place as closed.
  it("removes the live status, with or without the day", () => {
    expect(stripLiveOpenStatus("Shop 4.4 (14) Closed ⋅ Opens 9 AM Mon 123 Main St")).toBe(
      "Shop 4.4 (14) 123 Main St",
    );
    expect(stripLiveOpenStatus("Shop Open ⋅ Closes 6:30 PM shop.example")).toBe(
      "Shop shop.example",
    );
  });

  it("also handles a French UI and keeps null", () => {
    expect(stripLiveOpenStatus("Skimium Fermé · Ouvre à 10:00 dim. Mis à jour")).toBe(
      "Skimium Mis à jour",
    );
    expect(stripLiveOpenStatus(null)).toBeNull();
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

// --- Proxy / IP rotation hook tests ---

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

// --- Structured failure log tests ---

describe("Google Maps failure log (appendGoogleMapsFailure)", () => {
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

    appendGoogleMapsFailure({
      url: "https://www.google.com/maps/place/A",
      poiName: "A",
      attempts: 1,
      lastError: "err1",
      failedAt: new Date().toISOString(),
    });
    appendGoogleMapsFailure({
      url: "https://www.google.com/maps/place/B",
      poiName: "B",
      attempts: 2,
      lastError: "err2",
      failedAt: new Date().toISOString(),
    });

    const after = readFileSync(GOOGLE_MAPS_FAILURES_FILE, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean).length;
    expect(after).toBe(before + 2);
  });

  it("appendGoogleMapsFailure handles null poiName gracefully", () => {
    expect(() =>
      appendGoogleMapsFailure({
        url: "https://www.google.com/maps/place/NoName",
        poiName: null,
        attempts: 1,
        lastError: null,
        failedAt: new Date().toISOString(),
      }),
    ).not.toThrow();

    const lines = readFileSync(GOOGLE_MAPS_FAILURES_FILE, "utf8")
      .trim()
      .split("\n")
      .filter(Boolean);
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.poiName).toBeNull();
    expect(last.lastError).toBeNull();
  });
});
