// --- Google Maps extraction: every locator call must be time-bounded ---

import type { Logger } from "pino";
import type { Browser } from "playwright";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { _resetBrowserContextForTests } from "../browser-context.js";
import { fetchGoogleMapsPreviewOnce } from "../scrapers/google-maps.js";

// A page with no website link: before the fix, getAttribute waited for the
// Playwright default (30 s) on every scrape.
const getAttribute = vi.fn().mockResolvedValue(null);
const chain: Record<string, unknown> = {
  count: vi.fn().mockResolvedValue(0),
  innerText: vi.fn().mockResolvedValue(""),
  click: vi.fn().mockResolvedValue(undefined),
  waitFor: vi.fn().mockResolvedValue(undefined),
  getAttribute,
};
chain.evaluateAll = vi.fn().mockResolvedValue([]);
chain.first = vi.fn().mockReturnValue(chain);
chain.nth = vi.fn().mockReturnValue(chain);

const page = {
  goto: vi.fn(),
  waitForLoadState: vi.fn().mockResolvedValue(undefined),
  url: vi.fn().mockReturnValue("https://www.google.com/maps/place/Test/"),
  title: vi.fn().mockResolvedValue("Test Place - Google Maps"),
  locator: vi.fn().mockReturnValue(chain),
  getByRole: vi.fn().mockReturnValue({
    filter: vi.fn().mockReturnValue({ first: vi.fn().mockReturnValue(chain) }),
  }),
  close: vi.fn().mockResolvedValue(undefined),
};

const browser = {
  newContext: vi.fn().mockResolvedValue({
    newPage: vi.fn().mockResolvedValue(page),
    on: vi.fn(),
    // Rejecting keeps saveBrowserState() from writing a fake cookie jar to .cache/.
    storageState: vi.fn().mockRejectedValue(new Error("test context")),
  }),
} as unknown as Browser;

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as Logger;
const deps = { log, sleep: async () => undefined, randomDelay: () => 0 };

describe("fetchGoogleMapsPreviewOnce", () => {
  beforeEach(() => _resetBrowserContextForTests());

  it("bounds the website lookup with an explicit timeout", async () => {
    const preview = await fetchGoogleMapsPreviewOnce(
      "https://www.google.com/maps/search/Test/@45.2,6.3,17z",
      1,
      browser,
      deps,
    );

    expect(preview?.title).toBe("Test Place - Google Maps");
    expect(getAttribute).toHaveBeenCalledWith(
      "href",
      expect.objectContaining({ timeout: expect.any(Number) }),
    );
  });

  it("reads the week from the day buttons' aria-labels and drops the live status", async () => {
    (chain.evaluateAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      "Close",
      "Sunday, 8:30 AM to 6:30 PM, Copy open hours",
      "Monday, Closed, Copy open hours",
      "Suggest new hours",
    ]);
    (chain.innerText as ReturnType<typeof vi.fn>).mockResolvedValue(
      "Test Place 4.4 (14) Open ⋅ Closes 6:30 PM test-place.example",
    );

    const preview = await fetchGoogleMapsPreviewOnce(
      "https://www.google.com/maps/search/Test/@45.2,6.3,17z",
      1,
      browser,
      deps,
    );

    expect(preview?.structuredHours).toEqual([
      { day: "Sun", open: "08:30", close: "18:30" },
      { day: "Mon", open: "closed", close: null },
    ]);
    expect(preview?.hoursText).toBe("Sun: 08:30-18:30; Mon: closed");
    expect(preview?.snippet).not.toMatch(/Open ⋅ Closes/);
    expect(preview?.layoutWarnings).toEqual([]);
    expect(page.goto).toHaveBeenLastCalledWith(expect.stringContaining("hl=en"), expect.anything());
  });

  it("flags a layout change when the page shows hours but no day button parses", async () => {
    (chain.evaluateAll as ReturnType<typeof vi.fn>).mockResolvedValueOnce(["Close", "Directions"]);
    (chain.innerText as ReturnType<typeof vi.fn>).mockResolvedValue(
      "Test Place 4.4 (14) Open ⋅ Closes 6:30 PM test-place.example",
    );

    const preview = await fetchGoogleMapsPreviewOnce(
      "https://www.google.com/maps/search/Test/@45.2,6.3,17z",
      1,
      browser,
      deps,
    );

    expect(preview?.structuredHours).toBeNull();
    expect(preview?.hoursText).toBeNull();
    expect(preview?.layoutWarnings).toEqual([expect.stringMatching(/hours/i)]);
    expect(log.error).toHaveBeenCalledWith(
      expect.objectContaining({ url: expect.any(String) }),
      expect.stringMatching(/layout/i),
    );
  });

  it("does not flag a place Google lists without hours", async () => {
    (chain.innerText as ReturnType<typeof vi.fn>).mockResolvedValue(
      "Search this area Hours All filters Mast'Rock 4.5 (253) Bar Temporarily closed Overview Add hours",
    );

    const preview = await fetchGoogleMapsPreviewOnce(
      "https://www.google.com/maps/search/Test/@45.2,6.3,17z",
      1,
      browser,
      deps,
    );

    expect(preview?.structuredHours).toBeNull();
    expect(preview?.layoutWarnings).toEqual([]);
  });

  it("opens hours folded behind 'See more hours' and keeps the first table only", async () => {
    (chain.evaluateAll as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce(["Close", "Open · Closes 7 pm · See more hours"])
      .mockResolvedValueOnce([
        "Sunday, 9 am to 7 pm, Copy open hours",
        // "Online service hours", a second table for the same place
        "Sunday, Open 24 hours, Copy open hours",
        "Monday, Open 24 hours, Copy open hours",
      ]);
    (chain.innerText as ReturnType<typeof vi.fn>).mockResolvedValue(
      "Skimium 4.9 Ski rental service Open · Closes 7 pm See more hours skimium.fr",
    );
    const seeMore: Record<string, unknown> = {
      ...chain,
      count: vi.fn().mockResolvedValue(1),
      click: vi.fn().mockResolvedValue(undefined),
    };
    seeMore.first = vi.fn().mockReturnValue(seeMore);
    page.locator.mockImplementation((selector: string) =>
      selector.includes("See more hours") ? seeMore : chain,
    );

    try {
      const preview = await fetchGoogleMapsPreviewOnce(
        "https://www.google.com/maps/search/Test/@45.2,6.3,17z",
        1,
        browser,
        deps,
      );

      expect(seeMore.click).toHaveBeenCalled();
      expect(preview?.structuredHours).toEqual([{ day: "Sun", open: "09:00", close: "19:00" }]);
      expect(preview?.layoutWarnings).toEqual([]);
      expect(preview?.snippet).not.toMatch(/\bpm\b/);
    } finally {
      page.locator.mockImplementation(() => chain);
    }
  });
});
