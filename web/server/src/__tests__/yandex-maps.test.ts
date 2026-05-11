// ---------------------------------------------------------------------------
// Yandex Maps: pure parsers, URL builder, and endpoint input validation tests.
//
// Mirrors the structure of google-maps-jobs.test.ts but stays focused on the
// pure helpers and request validation. Full Playwright extraction is exercised
// manually against live Yandex Maps and is not asserted here (would be flaky).
// ---------------------------------------------------------------------------

import { describe, it, expect, vi } from "vitest";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_MAX = "1000";

// Mock playwright so any Yandex queue path doesn't spin up Chromium
vi.mock("playwright", () => ({
  chromium: {
    launch: vi.fn().mockResolvedValue({
      newPage: vi.fn().mockResolvedValue({
        setExtraHTTPHeaders: vi.fn(),
        goto: vi.fn(),
        waitForLoadState: vi.fn(),
        url: vi.fn().mockReturnValue("https://yandex.com/maps/?text=test"),
        title: vi.fn().mockResolvedValue(""),
        locator: vi.fn().mockReturnValue({
          innerText: vi.fn().mockResolvedValue(""),
          first: vi.fn().mockReturnValue({
            innerText: vi.fn().mockResolvedValue(""),
            getAttribute: vi.fn().mockResolvedValue(null),
            count: vi.fn().mockResolvedValue(0),
            click: vi.fn(),
            hover: vi.fn(),
          }),
          nth: vi.fn().mockReturnValue({ innerText: vi.fn().mockResolvedValue("") }),
          count: vi.fn().mockResolvedValue(0),
          click: vi.fn(),
        }),
        getByRole: vi.fn().mockReturnValue({
          filter: vi.fn().mockReturnValue({
            first: vi.fn().mockReturnValue({ count: vi.fn().mockResolvedValue(0) }),
          }),
        }),
        close: vi.fn(),
      }),
    }),
  },
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const { default: app, _testExports } = await import("../index");
const {
  buildYandexMapsUrl,
  parseYandexMapsHoursRow,
  normalizeYandexDay,
  normalizeYandexTimeString,
  extractYandexMapsRating,
  extractYandexMapsReviewCount,
  cleanYandexMapsHours,
} = _testExports;

// ---------------------------------------------------------------------------
// URL builder
// ---------------------------------------------------------------------------

describe("buildYandexMapsUrl", () => {
  it("builds a search URL with text + lon,lat (Yandex order)", () => {
    const url = buildYandexMapsUrl("Café Central", 48.8566, 2.3522);
    expect(url).toBe("https://yandex.com/maps/?text=Caf%C3%A9%20Central&ll=2.3522,48.8566&z=16");
  });

  it("returns null for empty name", () => {
    expect(buildYandexMapsUrl("", 48.8566, 2.3522)).toBeNull();
    expect(buildYandexMapsUrl("   ", 48.8566, 2.3522)).toBeNull();
    expect(buildYandexMapsUrl(null, 48.8566, 2.3522)).toBeNull();
  });

  it("returns null for invalid coordinates", () => {
    expect(buildYandexMapsUrl("Test", null, 2.3522)).toBeNull();
    expect(buildYandexMapsUrl("Test", 48.8566, null)).toBeNull();
    expect(buildYandexMapsUrl("Test", 91, 2.3522)).toBeNull();
    expect(buildYandexMapsUrl("Test", 48.8566, 181)).toBeNull();
    expect(buildYandexMapsUrl("Test", -91, 2.3522)).toBeNull();
    expect(buildYandexMapsUrl("Test", NaN, 2.3522)).toBeNull();
  });

  it("trims whitespace from the name", () => {
    const url = buildYandexMapsUrl("  Bakery  ", 50.0, 4.0);
    expect(url).toBe("https://yandex.com/maps/?text=Bakery&ll=4,50&z=16");
  });
});

// ---------------------------------------------------------------------------
// Day & time normalization
// ---------------------------------------------------------------------------

describe("normalizeYandexDay", () => {
  it("normalizes English day names", () => {
    expect(normalizeYandexDay("Monday")).toBe("Mon");
    expect(normalizeYandexDay("monday")).toBe("Mon");
    expect(normalizeYandexDay("Mon")).toBe("Mon");
    expect(normalizeYandexDay("Sunday")).toBe("Sun");
  });

  it("normalizes Russian day names (full + short)", () => {
    expect(normalizeYandexDay("Понедельник")).toBe("Mon");
    expect(normalizeYandexDay("воскресенье")).toBe("Sun");
    expect(normalizeYandexDay("пн")).toBe("Mon");
    expect(normalizeYandexDay("вс")).toBe("Sun");
  });

  it("normalizes Turkish day names", () => {
    expect(normalizeYandexDay("Pazartesi")).toBe("Mon");
    expect(normalizeYandexDay("Pazar")).toBe("Sun");
    expect(normalizeYandexDay("salı")).toBe("Tue");
  });

  it("normalizes French day names", () => {
    expect(normalizeYandexDay("Lundi")).toBe("Mon");
    expect(normalizeYandexDay("dimanche")).toBe("Sun");
  });

  it("returns trimmed input when unknown", () => {
    expect(normalizeYandexDay("  Funday  ")).toBe("Funday");
  });
});

describe("normalizeYandexTimeString", () => {
  it("pads single-digit 24h hours", () => {
    expect(normalizeYandexTimeString("8:00")).toBe("08:00");
    expect(normalizeYandexTimeString("18:30")).toBe("18:30");
  });

  it("handles dot separator (Yandex sometimes uses 8.00)", () => {
    expect(normalizeYandexTimeString("8.00")).toBe("08:00");
  });

  it("handles 12h format defensively", () => {
    expect(normalizeYandexTimeString("8:00 AM")).toBe("08:00");
    expect(normalizeYandexTimeString("12:00 AM")).toBe("00:00");
    expect(normalizeYandexTimeString("12:00 PM")).toBe("12:00");
    expect(normalizeYandexTimeString("11:30 PM")).toBe("23:30");
  });

  it("returns input unchanged when not a recognizable time", () => {
    expect(normalizeYandexTimeString("24h")).toBe("24h");
    expect(normalizeYandexTimeString("noon")).toBe("noon");
  });

  it("rejects out-of-range hours", () => {
    expect(normalizeYandexTimeString("25:00")).toBe("25:00"); // not normalized
  });
});

// ---------------------------------------------------------------------------
// Hours row parsing
// ---------------------------------------------------------------------------

describe("parseYandexMapsHoursRow", () => {
  it("parses simple English range", () => {
    expect(parseYandexMapsHoursRow("Monday 9:00 - 18:00"))
      .toEqual({ day: "Mon", open: "09:00", close: "18:00" });
  });

  it("parses Russian range", () => {
    expect(parseYandexMapsHoursRow("Понедельник 9:00 – 18:00"))
      .toEqual({ day: "Mon", open: "09:00", close: "18:00" });
  });

  it("parses Turkish range", () => {
    expect(parseYandexMapsHoursRow("Pazartesi 09:00 - 22:00"))
      .toEqual({ day: "Mon", open: "09:00", close: "22:00" });
  });

  it("recognizes closed markers in multiple locales", () => {
    expect(parseYandexMapsHoursRow("Sunday closed"))
      .toEqual({ day: "Sun", open: "closed", close: null });
    expect(parseYandexMapsHoursRow("Воскресенье выходной"))
      .toEqual({ day: "Sun", open: "closed", close: null });
    expect(parseYandexMapsHoursRow("Pazar kapalı"))
      .toEqual({ day: "Sun", open: "closed", close: null });
    expect(parseYandexMapsHoursRow("Dimanche fermé"))
      .toEqual({ day: "Sun", open: "closed", close: null });
  });

  it("recognizes 24h markers", () => {
    expect(parseYandexMapsHoursRow("Friday 24 hours"))
      .toEqual({ day: "Fri", open: "00:00", close: "23:59" });
    expect(parseYandexMapsHoursRow("Пятница круглосуточно"))
      .toEqual({ day: "Fri", open: "00:00", close: "23:59" });
    expect(parseYandexMapsHoursRow("Cuma 24 saat"))
      .toEqual({ day: "Fri", open: "00:00", close: "23:59" });
  });

  it("returns null for malformed input", () => {
    expect(parseYandexMapsHoursRow("")).toBeNull();
    expect(parseYandexMapsHoursRow("nope")).toBeNull();
    expect(parseYandexMapsHoursRow("Monday")).toBeNull(); // no time
  });
});

// ---------------------------------------------------------------------------
// Rating / review count extraction
// ---------------------------------------------------------------------------

describe("extractYandexMapsRating", () => {
  it("extracts decimal rating with comma separator", () => {
    expect(extractYandexMapsRating("Café Central 4,7 (123 оценок)")).toBe(4.7);
  });

  it("extracts decimal rating with dot separator", () => {
    expect(extractYandexMapsRating("Café Central 4.7 reviews")).toBe(4.7);
  });

  it("rejects ratings outside 1.0-5.0 range", () => {
    expect(extractYandexMapsRating("just text 0,5 noise")).toBeNull();
    expect(extractYandexMapsRating("just text 6,0 noise")).toBeNull();
  });

  it("returns null when no rating present", () => {
    expect(extractYandexMapsRating("nothing here")).toBeNull();
    expect(extractYandexMapsRating(null)).toBeNull();
    expect(extractYandexMapsRating("")).toBeNull();
  });

  it("ignores ratings far past the head window", () => {
    const filler = "x".repeat(900);
    expect(extractYandexMapsRating(`${filler} 4,5`)).toBeNull();
  });
});

describe("extractYandexMapsReviewCount", () => {
  it("extracts review count with English label", () => {
    expect(extractYandexMapsReviewCount("Cafe rating 4.7 (126 reviews)")).toBe(126);
    expect(extractYandexMapsReviewCount("Cafe — 1234 reviews on the platform")).toBe(1234);
  });

  it("extracts review count with Russian label (multiple inflections)", () => {
    expect(extractYandexMapsReviewCount("Кафе 126 оценок")).toBe(126);
    expect(extractYandexMapsReviewCount("Кафе 5 оценок")).toBe(5);
    expect(extractYandexMapsReviewCount("Кафе 21 оценка")).toBe(21);
    expect(extractYandexMapsReviewCount("Кафе 126 отзывов")).toBe(126);
  });

  it("extracts review count with Turkish label", () => {
    expect(extractYandexMapsReviewCount("Cafe 126 değerlendirme")).toBe(126);
    expect(extractYandexMapsReviewCount("Cafe 50 yorum")).toBe(50);
  });

  it("normalizes thousands separators", () => {
    expect(extractYandexMapsReviewCount("Place 1,234 reviews")).toBe(1234);
    expect(extractYandexMapsReviewCount("Place 1 234 оценок")).toBe(1234);
  });

  it("returns null when no review count present", () => {
    expect(extractYandexMapsReviewCount("nothing here")).toBeNull();
    expect(extractYandexMapsReviewCount(null)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Hours text cleaning
// ---------------------------------------------------------------------------

describe("cleanYandexMapsHours", () => {
  it("returns the cleaned text when it contains a time-like marker", () => {
    expect(cleanYandexMapsHours("9:00 - 18:00")).toBe("9:00 - 18:00");
    expect(cleanYandexMapsHours("Открыто · до 22:00")).toBe("Открыто · до 22:00");
  });

  it("returns null for too-short or non-hours text", () => {
    expect(cleanYandexMapsHours(null)).toBeNull();
    expect(cleanYandexMapsHours("")).toBeNull();
    expect(cleanYandexMapsHours("ok")).toBeNull();
    expect(cleanYandexMapsHours("just some marketing text without times")).toBeNull();
  });

  it("recognizes 'круглосуточно' (24/7) as valid", () => {
    expect(cleanYandexMapsHours("круглосуточно")).toBe("круглосуточно");
  });
});

// ---------------------------------------------------------------------------
// Endpoint input validation
// ---------------------------------------------------------------------------

describe("POST /yandex-maps-preview input validation", () => {
  it("rejects requests with neither url nor name+coords", async () => {
    const res = await request(app).post("/yandex-maps-preview").send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/url.*poiName/i);
  });

  it("rejects non-yandex URLs", async () => {
    const res = await request(app).post("/yandex-maps-preview").send({
      url: "https://www.google.com/maps/place/Test/",
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/yandex/i);
  });

  it("rejects malformed URLs", async () => {
    const res = await request(app).post("/yandex-maps-preview").send({ url: "not-a-url" });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/Invalid URL/i);
  });

  it("rejects coords without a name", async () => {
    const res = await request(app).post("/yandex-maps-preview").send({ lat: 48.85, lon: 2.35 });
    expect(res.status).toBe(400);
  });
});

describe("POST /yandex-maps-preview/jobs input validation", () => {
  it("rejects empty body", async () => {
    const res = await request(app).post("/yandex-maps-preview/jobs").send({});
    expect(res.status).toBe(400);
  });

  it("rejects non-yandex URLs", async () => {
    const res = await request(app).post("/yandex-maps-preview/jobs").send({
      url: "https://example.com/place",
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /yandex-maps-preview/jobs/:jobId", () => {
  it("returns 404 for unknown job", async () => {
    const res = await request(app).get("/yandex-maps-preview/jobs/does-not-exist");
    expect(res.status).toBe(404);
  });
});

describe("DELETE /yandex-maps-preview/jobs/:jobId", () => {
  it("returns 404 for unknown job", async () => {
    const res = await request(app).delete("/yandex-maps-preview/jobs/does-not-exist");
    expect(res.status).toBe(404);
  });
});

describe("GET /yandex-maps-preview/jobs", () => {
  it("returns counts and recent jobs list", async () => {
    const res = await request(app).get("/yandex-maps-preview/jobs");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("counts");
    expect(res.body).toHaveProperty("jobs");
    expect(res.body.counts).toHaveProperty("queued");
    expect(res.body.counts).toHaveProperty("running");
    expect(res.body.counts).toHaveProperty("done");
    expect(res.body.counts).toHaveProperty("error");
    expect(Array.isArray(res.body.jobs)).toBe(true);
  });
});
