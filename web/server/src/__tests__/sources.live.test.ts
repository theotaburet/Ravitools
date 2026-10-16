// --- Source contract checks: do the real sources still answer in the shape the code reads? ---
//
// Opt-in (network, third-party quotas): `just test-live` sets LIVE_SOURCES=1.
// Each test pins the few fields the client or server actually reads, so a
// silent upstream change (Google dropped its hours table in 2026) fails here
// instead of degrading enrichment quietly.

import { chromium } from "playwright";
import { describe, expect, it } from "vitest";
import { NOMINATIM_URL, OVERPASS_URLS, SEARXNG_URL, USER_AGENT } from "../config.js";
import { fetchGoogleMapsPreviewOnce } from "../scrapers/google-maps.js";

const live = process.env.LIVE_SOURCES === "1";
const NETWORK_TIMEOUT_MS = 30_000;

// Eiffel Tower surroundings: dense, stable, plenty of drinking water.
const LAT = 48.8584;
const LON = 2.2945;

async function getJson(url: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(url, {
    ...init,
    headers: { "User-Agent": USER_AGENT, ...init?.headers },
    signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
  });
  expect(res.ok, `${url} answered ${res.status}`).toBe(true);
  return res.json();
}

describe.runIf(live)("live source contracts", () => {
  it(
    "Overpass: nwr + out center returns typed elements with tags and a position",
    async () => {
      const query = `[out:json][timeout:25];nwr["amenity"="drinking_water"](around:400,${LAT},${LON});out center;`;
      // Same fallback as the server route: public mirrors answer 504 under load,
      // and two of them answer 429 to any request without a meaningful User-Agent.
      type OverpassBody = { elements?: Array<Record<string, unknown>> };
      let data: OverpassBody | null = null;
      for (const url of OVERPASS_URLS) {
        const res = await fetch(url, {
          method: "POST",
          body: `data=${encodeURIComponent(query)}`,
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT,
          },
          signal: AbortSignal.timeout(NETWORK_TIMEOUT_MS),
        }).catch(() => null);
        if (res?.ok) {
          data = (await res.json()) as OverpassBody;
          break;
        }
      }
      expect(data, `no Overpass mirror answered: ${OVERPASS_URLS.join(", ")}`).not.toBeNull();

      const elements = data?.elements ?? [];
      expect(elements.length).toBeGreaterThan(0);
      for (const el of elements) {
        expect(["node", "way", "relation"]).toContain(el.type);
        expect(typeof el.id).toBe("number");
        expect((el.tags as Record<string, string>).amenity).toBe("drinking_water");
        const pos = el.type === "node" ? el : (el.center as Record<string, unknown>);
        expect(typeof pos.lat).toBe("number");
        expect(typeof pos.lon).toBe("number");
      }
    },
    NETWORK_TIMEOUT_MS,
  );

  it(
    "Nominatim: reverse geocode exposes the address fields the locality is built from",
    async () => {
      const params = new URLSearchParams({
        lat: String(LAT),
        lon: String(LON),
        format: "json",
        zoom: "14",
        addressdetails: "1",
      });
      const data = (await getJson(`${NOMINATIM_URL}/reverse?${params}`)) as {
        address?: Record<string, string>;
        display_name?: string;
      };

      expect(typeof data.display_name).toBe("string");
      const addr = data.address ?? {};
      expect(addr.country_code).toBe("fr");
      expect(addr.country).toBeTruthy();
      expect(addr.city || addr.town || addr.village || addr.municipality).toBeTruthy();
    },
    NETWORK_TIMEOUT_MS,
  );

  it(
    "SearXNG: JSON results carry title, url, content and engine",
    async (ctx) => {
      const up = await fetch(`${SEARXNG_URL}/healthz`, { signal: AbortSignal.timeout(3_000) })
        .then((r) => r.ok)
        .catch(() => false);
      if (!up) ctx.skip();

      const params = new URLSearchParams({ q: "Eiffel Tower opening hours", format: "json" });
      const data = (await getJson(`${SEARXNG_URL}/search?${params}`)) as {
        results?: Array<Record<string, unknown>>;
        unresponsive_engines?: unknown;
      };

      expect(Array.isArray(data.results)).toBe(true);
      expect(data.results?.length).toBeGreaterThan(0);
      for (const r of (data.results ?? []).slice(0, 5)) {
        expect(typeof r.title).toBe("string");
        expect(typeof r.url).toBe("string");
        expect(typeof r.engine).toBe("string");
        if (r.content !== undefined) expect(typeof r.content).toBe("string");
      }
      if (data.unresponsive_engines !== undefined) {
        expect(Array.isArray(data.unresponsive_engines)).toBe(true);
      }
    },
    NETWORK_TIMEOUT_MS,
  );

  it("Google Maps: a place page still yields title, rating, category and the week's hours", async () => {
    const browser = await chromium.launch({ headless: true });
    const log = { info() {}, warn: console.warn, error: console.error };
    try {
      // Powell's City of Books, Portland: open every day, thousands of reviews.
      const preview = await fetchGoogleMapsPreviewOnce(
        "https://www.google.com/maps/search/Powell's%20City%20of%20Books/@45.5231,-122.6813,17z",
        1,
        browser,
        {
          log: log as never,
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
          randomDelay: (min) => min,
        },
      );

      expect(preview?.title).toMatch(/Powell/i);
      expect(preview?.layoutWarnings).toEqual([]);
      expect(preview?.category).toBeTruthy();
      expect(preview?.rating).toBeGreaterThanOrEqual(1);
      expect(preview?.rating).toBeLessThanOrEqual(5);
      expect(preview?.reviewCount).toBeGreaterThan(100);
      expect(preview?.structuredHours?.length).toBeGreaterThanOrEqual(5);
      for (const entry of preview?.structuredHours ?? []) {
        expect(entry.day).toMatch(/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)$/);
        expect(entry.open).toMatch(/^(\d{2}:\d{2}|closed)$/);
      }
      expect(preview?.snippet).not.toMatch(/(Open|Closed) ⋅ (Opens|Closes)/);
    } finally {
      await browser.close();
    }
  }, 120_000);
});
