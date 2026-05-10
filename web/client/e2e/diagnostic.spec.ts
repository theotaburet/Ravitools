// ---------------------------------------------------------------------------
// E2E diagnostic test – upload real GPX, capture all console output, errors,
// network failures, and performance timings. Outputs a JSON report.
// ---------------------------------------------------------------------------

import { test, expect } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GPX_PATH = path.resolve(
  __dirname,
  "../../examples/2026-04-13_2883134106_de Hasparren à Baztan.gpx",
);

interface LogEntry {
  ts: number;
  type: string;
  text: string;
  location?: string;
}

test.describe("Diagnostic: Hasparren GPX full pipeline", () => {
  test("capture console, errors, network, and perf", async ({ page }) => {
    const logs: LogEntry[] = [];
    const errors: LogEntry[] = [];
    const networkFailures: { url: string; status: number; method: string }[] = [];
    const timings: Record<string, number> = {};

    const t0 = Date.now();
    const ts = () => Date.now() - t0;

    // Capture ALL console messages
    page.on("console", (msg) => {
      const entry: LogEntry = {
        ts: ts(),
        type: msg.type(),
        text: msg.text(),
        location: msg.location()?.url,
      };
      logs.push(entry);
      if (msg.type() === "error" || msg.type() === "warning") {
        errors.push(entry);
      }
    });

    // Capture uncaught exceptions
    page.on("pageerror", (err) => {
      errors.push({ ts: ts(), type: "pageerror", text: err.message });
    });

    // Capture network failures (4xx, 5xx, aborted)
    page.on("response", (resp) => {
      if (resp.status() >= 400) {
        networkFailures.push({
          url: resp.url(),
          status: resp.status(),
          method: resp.request().method(),
        });
      }
    });

    page.on("requestfailed", (req) => {
      networkFailures.push({
        url: req.url(),
        status: 0,
        method: req.method(),
      });
    });

    // 1. Navigate
    await page.goto("/");
    timings["pageLoad"] = ts();

    // 2. Upload GPX
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(GPX_PATH);
    timings["gpxUploaded"] = ts();

    // 3. Wait for parsing (status bar appears)
    await expect(page.locator(".status-bar")).toBeVisible({ timeout: 10_000 });
    timings["parsingStarted"] = ts();

    // 4. Wait for pipeline done (export panel visible) — up to 120s for Overpass
    await expect(page.locator(".export-panel")).toBeVisible({
      timeout: 120_000,
    });
    timings["pipelineDone"] = ts();

    // 5. Count POIs
    const headerText = await page.locator(".poi-list-header").textContent();
    const poiCountMatch = headerText?.match(/\((\d+)\)/);
    const poiCount = poiCountMatch ? Number(poiCountMatch[1]) : 0;
    timings["poiCount"] = poiCount;

    // 6. Check debug panel if visible
    const debugToggle = page.locator('[data-testid="debug-toggle"]');
    if (await debugToggle.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await debugToggle.click();
      await page.waitForTimeout(500);
      // Grab debug panel content
      const debugContent = await page
        .locator(".debug-panel")
        .textContent()
        .catch(() => null);
      if (debugContent) {
        logs.push({
          ts: ts(),
          type: "debug-panel-snapshot",
          text: debugContent.slice(0, 5000),
        });
      }
    }

    // 7. Measure DOM size
    const domNodeCount = await page.evaluate(
      () => document.querySelectorAll("*").length,
    );
    timings["domNodeCount"] = domNodeCount;

    // 8. Performance entries (LCP, resources)
    const perfData = await page.evaluate(() => {
      const entries = performance.getEntriesByType("resource") as PerformanceResourceTiming[];
      const overpassReqs = entries.filter((e) => e.name.includes("overpass"));
      return {
        totalResources: entries.length,
        overpassRequests: overpassReqs.map((e) => ({
          name: e.name.slice(0, 200),
          duration: Math.round(e.duration),
          size: e.transferSize,
        })),
        jsHeapMB:
          (performance as any).memory?.usedJSHeapSize
            ? Math.round(
                (performance as any).memory.usedJSHeapSize / 1024 / 1024,
              )
            : null,
      };
    });

    // 9. Try an export to make sure it works
    let exportOk = false;
    try {
      const gpxBtn = page
        .locator(".export-panel")
        .getByText(".GPX (Garmin, Wahoo...)");
      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 5_000 }),
        gpxBtn.click(),
      ]);
      exportOk = download.suggestedFilename().endsWith(".gpx");
    } catch {
      exportOk = false;
    }

    // 10. Write report
    const report = {
      gpx: "Hasparren → Baztan",
      date: new Date().toISOString(),
      timings,
      poiCount,
      domNodeCount,
      perfData,
      exportOk,
      consoleErrors: errors,
      networkFailures,
      totalConsoleLogs: logs.length,
      warningCount: logs.filter((l) => l.type === "warning").length,
      errorCount: errors.length,
      // Include first 50 logs for inspection
      sampleLogs: logs.slice(0, 50),
    };

    const reportPath = path.resolve(__dirname, "../e2e-diagnostic-report.json");
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

    console.log("\n=== DIAGNOSTIC SUMMARY ===");
    console.log(`Pipeline time: ${timings["pipelineDone"]}ms`);
    console.log(`POIs found: ${poiCount}`);
    console.log(`DOM nodes: ${domNodeCount}`);
    console.log(`Console errors: ${errors.length}`);
    console.log(`Network failures: ${networkFailures.length}`);
    console.log(`Export OK: ${exportOk}`);
    console.log(`Report written to: ${reportPath}`);
    console.log("==========================\n");

    // The test passes regardless — it's diagnostic, not assertive
    // But let's at least assert the pipeline completed
    expect(poiCount).toBeGreaterThan(0);
    expect(exportOk).toBe(true);
  });
});
