// E2E smoke test: upload GPX → POIs on map → export a valid GPX.
// Deterministic: /api/* is stubbed, no server or network needed.

import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { loadRoute, OVERPASS_STUB, stubApi } from "./fixtures";

test.beforeEach(({ page }) => stubApi(page));

test("upload GPX → POIs on map → valid GPX export", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("header h1")).toHaveText("Ravitools");
  await expect(page.locator(".upload-zone")).toBeVisible();
  // Nothing to export before there are POIs
  await expect(page.getByRole("tab", { name: /Export/ })).toBeDisabled();

  await loadRoute(page);

  // Pipeline done → the POI tab is shown
  await expect(page.getByRole("tab", { name: /POI/ })).toHaveAttribute("aria-selected", "true");

  // Route polyline + every POI marker on the map
  await expect(page.locator(".route-map svg path").first()).toBeVisible();
  await expect(page.locator(".leaflet-marker-pane .pastille")).toHaveCount(
    OVERPASS_STUB.elements.length,
  );

  // POI list shows the named restaurant
  await expect(page.locator(".poi-list-item").first()).toBeVisible();
  await expect(page.getByText("Chez Test").first()).toBeVisible();

  // GPX export downloads a file with waypoints and the track
  await page.getByRole("tab", { name: /Export/ }).click();
  await page.getByRole("radio", { name: /^GPX COROS/ }).check();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Download GPX" }).click(),
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

  const errorBox = page.getByRole("alert");
  await expect(errorBox).toBeVisible({ timeout: 10_000 });
  await errorBox.getByText("Try again").click();
  await expect(page.locator(".upload-zone")).toBeVisible();
});
