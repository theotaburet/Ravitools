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
  getAttribute,
};
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
});
