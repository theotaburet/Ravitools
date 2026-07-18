// ---------------------------------------------------------------------------
// E2E smoke test – upload GPX → POIs on map → export a valid GPX.
// Deterministic: /api/* is stubbed, no server or network needed.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

// ~700m track in central Paris (3 points is enough for the pipeline)
const GPX_FIXTURE = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="ravitools-e2e" xmlns="http://www.topografix.com/GPX/1/1">
  <trk><name>Smoke Route</name><trkseg>
    <trkpt lat="48.8500" lon="2.3500"><ele>35</ele></trkpt>
    <trkpt lat="48.8530" lon="2.3510"><ele>36</ele></trkpt>
    <trkpt lat="48.8560" lon="2.3520"><ele>37</ele></trkpt>
  </trkseg></trk>
</gpx>`;

// Two POIs on the route, in default-enabled categories, >50m apart (no dedup)
const OVERPASS_STUB = {
  elements: [
    { type: "node", id: 1, lat: 48.8531, lon: 2.3511, tags: { amenity: "drinking_water" } },
    {
      type: "node",
      id: 2,
      lat: 48.8502,
      lon: 2.3502,
      tags: { amenity: "restaurant", name: "Chez Test" },
    },
  ],
};

test.beforeEach(async ({ page }) => {
  await page.route("**/api/health", (route) =>
    route.fulfill({ json: { status: "ok", services: { searxng: "ok" } } }),
  );
  await page.route("**/api/overpass", (route) => route.fulfill({ json: OVERPASS_STUB }));
});

test("upload GPX → POIs on map → valid GPX export", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header h1")).toHaveText("Ravitools");
  await expect(page.locator(".upload-zone")).toBeVisible();

  await page.locator('input[type="file"]').setInputFiles({
    name: "smoke.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from(GPX_FIXTURE),
  });

  // Pipeline done → export panel appears
  await expect(page.locator(".export-panel")).toBeVisible({ timeout: 20_000 });

  // Route polyline + both POI markers on the map
  await expect(page.locator(".route-map svg path").first()).toBeVisible();
  await expect(page.locator(".poi-marker")).toHaveCount(2);

  // POI list shows the named restaurant
  await expect(page.locator(".poi-list-item").first()).toBeVisible();
  await expect(page.getByText("Chez Test").first()).toBeVisible();

  // GPX export downloads a file with waypoints and the track
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByText(".GPX (Garmin, Wahoo...)").click(),
  ]);
  expect(download.suggestedFilename()).toMatch(/\.gpx$/);
  const gpx = readFileSync((await download.path()) as string, "utf8");
  expect(gpx).toContain("<wpt");
  expect(gpx).toContain("<trk>");
  expect(gpx).toContain("Chez Test");
});

test("invalid GPX shows an error with recovery", async ({ page }) => {
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "bad.gpx",
    mimeType: "application/gpx+xml",
    buffer: Buffer.from("<not-a-gpx>hello</not-a-gpx>"),
  });

  const errorBox = page.locator(".error-box");
  await expect(errorBox).toBeVisible({ timeout: 10_000 });
  await errorBox.getByText("Try again").click();
  await expect(page.locator(".upload-zone")).toBeVisible();
});
