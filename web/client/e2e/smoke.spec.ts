// ---------------------------------------------------------------------------
// E2E smoke test – full pipeline: upload GPX → query Overpass → see POIs → export
// Uses the Paris urban short GPX (10km, fastest queries, good for dedup testing)
// ---------------------------------------------------------------------------

import { test, expect } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GPX_PATH = path.resolve(__dirname, "../../examples/paris-urban-short.gpx");

test.describe("Ravitools E2E smoke test", () => {
  test("full pipeline: upload → map → POIs → filters → export", async ({
    page,
  }) => {
    // -----------------------------------------------------------------------
    // 1. Navigate & verify landing page
    // -----------------------------------------------------------------------
    await page.goto("/");
    await expect(page.locator("header h1")).toHaveText("Ravitools");
    await expect(page.locator(".upload-zone")).toBeVisible();
    await expect(
      page.getByText("Drop your .GPX here"),
    ).toBeVisible();

    // -----------------------------------------------------------------------
    // 2. Upload GPX via file input
    // -----------------------------------------------------------------------
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(GPX_PATH);

    // -----------------------------------------------------------------------
    // 3. Wait for pipeline to complete (up to 90s for Overpass)
    // -----------------------------------------------------------------------
    // First, parsing should start
    await expect(page.locator(".status-bar")).toBeVisible({ timeout: 5_000 });

    // Wait for "done" stage – the export panel appears when done
    await expect(page.locator(".export-panel")).toBeVisible({
      timeout: 90_000,
    });

    // -----------------------------------------------------------------------
    // 4. Verify status shows POI count
    // -----------------------------------------------------------------------
    const statusBar = page.locator(".status-bar");
    await expect(statusBar).toContainText("Found");
    await expect(statusBar).toContainText("POIs along your route");

    // -----------------------------------------------------------------------
    // 5. Verify map has rendered content
    // -----------------------------------------------------------------------
    const mapContainer = page.locator(".route-map");
    await expect(mapContainer).toBeVisible();
    // Leaflet renders many SVG elements (path for polyline + circles for markers)
    // Just verify there's at least one SVG path (the route polyline)
    const svgPaths = mapContainer.locator("svg path");
    const pathCount = await svgPaths.count();
    expect(pathCount).toBeGreaterThan(0);

    // -----------------------------------------------------------------------
    // 6. Verify POI markers are on the map
    // -----------------------------------------------------------------------
    // Leaflet CircleMarkers render as SVG paths (not <circle> elements)
    // The route polyline is also a path, but we should have many more than 1
    // indicating POI markers are present
    expect(pathCount).toBeGreaterThan(1);

    // -----------------------------------------------------------------------
    // 7. Verify category filters are visible with counts
    // -----------------------------------------------------------------------
    const filterSection = page.locator(".filter-header");
    await expect(filterSection).toBeVisible();
    await expect(filterSection).toContainText("Filters");

    // There should be filter items (at least a few categories with POIs)
    const filterItems = page.locator(".filter-item");
    const filterCount = await filterItems.count();
    expect(filterCount).toBeGreaterThan(0);

    // -----------------------------------------------------------------------
    // 8. Test filter toggle – uncheck all, check POIs disappear
    // -----------------------------------------------------------------------
    const toggleBtn = filterSection.locator("button");
    // Click "None" to uncheck all
    await toggleBtn.click();
    // POI list should disappear (export panel returns null if 0 filtered POIs)
    // Wait a moment for re-render
    await page.waitForTimeout(300);

    // When all filters are off, export panel hides (since filteredPois is empty)
    // But the export panel receives filteredPois, so it should say 0 or hide
    const exportPanel = page.locator(".export-panel");
    // ExportPanel returns null when pois.length === 0
    await expect(exportPanel).not.toBeVisible({ timeout: 2_000 });

    // Click "All" to re-enable
    await toggleBtn.click();
    await expect(exportPanel).toBeVisible({ timeout: 2_000 });

    // -----------------------------------------------------------------------
    // 9. Verify POI list is populated
    // -----------------------------------------------------------------------
    const poiListHeader = page.locator(".poi-list-header");
    await expect(poiListHeader).toBeVisible();
    // Should contain "POIs along route (N)" where N > 0
    const headerText = await poiListHeader.textContent();
    expect(headerText).toMatch(/POIs along route \(\d+\)/);
    const poiCountMatch = headerText?.match(/\((\d+)\)/);
    expect(poiCountMatch).toBeTruthy();
    expect(Number(poiCountMatch![1])).toBeGreaterThan(0);

    // Verify individual POI items exist
    const poiItems = page.locator(".poi-list-item");
    const poiItemCount = await poiItems.count();
    expect(poiItemCount).toBeGreaterThan(0);

    // -----------------------------------------------------------------------
    // 10. Verify export buttons exist and are clickable
    // -----------------------------------------------------------------------
    await expect(exportPanel.locator("h3")).toHaveText("Export for GPS");
    await expect(exportPanel.getByText("POIs ready")).toBeVisible();

    const gpxBtn = exportPanel.getByText(".GPX (Garmin, Wahoo...)");
    const kmlBtn = exportPanel.getByText(".KML (Google Earth)");
    const geojsonBtn = exportPanel.getByText(".GeoJSON");

    await expect(gpxBtn).toBeVisible();
    await expect(kmlBtn).toBeVisible();
    await expect(geojsonBtn).toBeVisible();

    // Test GPX export – triggers a download
    const [gpxDownload] = await Promise.all([
      page.waitForEvent("download"),
      gpxBtn.click(),
    ]);
    expect(gpxDownload.suggestedFilename()).toMatch(/\.gpx$/);

    // Test KML export
    const [kmlDownload] = await Promise.all([
      page.waitForEvent("download"),
      kmlBtn.click(),
    ]);
    expect(kmlDownload.suggestedFilename()).toMatch(/\.kml$/);

    // Test GeoJSON export
    const [geojsonDownload] = await Promise.all([
      page.waitForEvent("download"),
      geojsonBtn.click(),
    ]);
    expect(geojsonDownload.suggestedFilename()).toMatch(/\.geojson$/);

    // -----------------------------------------------------------------------
    // 11. Verify reset works
    // -----------------------------------------------------------------------
    const resetBtn = page.getByText("Load another GPX");
    await expect(resetBtn).toBeVisible();
    await resetBtn.click();

    // Should return to upload state
    await expect(page.locator(".upload-zone")).toBeVisible({ timeout: 2_000 });
    await expect(exportPanel).not.toBeVisible();
  });

  test("displays error on invalid GPX", async ({ page }) => {
    await page.goto("/");

    // Create a fake file that's not valid GPX
    const fileInput = page.locator('input[type="file"]');
    // Set a non-GPX content to the file input
    await fileInput.setInputFiles({
      name: "bad.gpx",
      mimeType: "application/gpx+xml",
      buffer: Buffer.from("<not-a-gpx>hello</not-a-gpx>"),
    });

    // Should show error state
    const errorBox = page.locator(".error-box");
    await expect(errorBox).toBeVisible({ timeout: 10_000 });
    await expect(errorBox).toContainText("Error");

    // Try again button should work
    const tryAgain = errorBox.getByText("Try again");
    await expect(tryAgain).toBeVisible();
    await tryAgain.click();
    await expect(page.locator(".upload-zone")).toBeVisible({ timeout: 2_000 });
  });
});
