// Shared e2e fixtures: a short GPX and stubbed /api/* (no server or network needed)

import type { Page } from "@playwright/test";

// ~700m track in central Paris (3 points is enough for the pipeline)
const GPX_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ravitools-e2e" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Smoke Route</name><trkseg>
    <trkpt lat="48.8500" lon="2.3500"><ele>35</ele></trkpt>
    <trkpt lat="48.8530" lon="2.3510"><ele>36</ele></trkpt>
    <trkpt lat="48.8560" lon="2.3520"><ele>37</ele></trkpt>
  </trkseg></trk>
</gpx>`;

// Three POIs on the route, in default-enabled categories, >50m apart (no dedup); two water
// points so ◀ ▶ have somewhere to go once filtered to water
const OVERPASS_STUB = {
  elements: [
    { type: "node", id: 1, lat: 48.8531, lon: 2.3511, tags: { amenity: "drinking_water" } },
    {
      type: "node",
      id: 3,
      lat: 48.8545,
      lon: 2.3515,
      tags: { amenity: "drinking_water", name: "Fontaine Wallace" },
    },
    {
      type: "node",
      id: 2,
      lat: 48.8502,
      lon: 2.3502,
      tags: { amenity: "restaurant", name: "Chez Test" },
    },
  ],
};

/** Stub the server; the first `failingChunks` Overpass calls answer 502, like a busy mirror */
export async function stubApi(page: Page, { failingChunks = 0 } = {}): Promise<void> {
  let failures = failingChunks;
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { status: "ok", services: { searxng: "ok" } } }),
  );
  await page.route("**/api/overpass", (route) =>
    failures-- > 0
      ? route.fulfill({ status: 502, json: { error: "Bad gateway" } })
      : route.fulfill({ json: OVERPASS_STUB }),
  );
}

/** Load the fixture GPX and wait for the POI list (the app switches to tab 02 when done) */
export async function loadRoute(page: Page, gpx = GPX_FIXTURE): Promise<void> {
  await page.locator('input[type="file"]').setInputFiles({
    name: "smoke.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(gpx),
  });
  await page.locator(".poi-list-item").first().waitFor({ timeout: 30_000 });
}
