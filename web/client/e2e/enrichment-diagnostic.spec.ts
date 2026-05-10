// ---------------------------------------------------------------------------
// E2E diagnostic: enrichment pipeline
// Upload GPX → wait for POIs → start enrichment → capture everything
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
}

test.describe("Diagnostic: enrichment pipeline", () => {
  // Enrichment can be slow (SearXNG + optional Google fallback + LLM)
  test.setTimeout(300_000); // 5 minutes

  test("upload GPX → enrich POIs → capture all output", async ({ page }) => {
    const logs: LogEntry[] = [];
    const errors: LogEntry[] = [];
    const networkFailures: { url: string; status: number; body?: string }[] = [];
    const snapshots: { ts: number; label: string; data: any }[] = [];

    const t0 = Date.now();
    const ts = () => Date.now() - t0;

    // Capture console
    page.on("console", (msg) => {
      const entry: LogEntry = { ts: ts(), type: msg.type(), text: msg.text() };
      logs.push(entry);
      if (msg.type() === "error" || msg.type() === "warning") {
        errors.push(entry);
      }
    });

    page.on("pageerror", (err) => {
      errors.push({ ts: ts(), type: "pageerror", text: err.message + "\n" + err.stack });
    });

    // Capture failed network requests (skip tiles)
    page.on("response", async (resp) => {
      if (resp.status() >= 400 && !resp.url().includes("tile.openstreetmap")) {
        let body = "";
        try { body = (await resp.text()).slice(0, 500); } catch {}
        networkFailures.push({ url: resp.url(), status: resp.status(), body });
      }
    });

    page.on("requestfailed", (req) => {
      if (!req.url().includes("tile.openstreetmap")) {
        networkFailures.push({ url: req.url(), status: 0 });
      }
    });

    // -----------------------------------------------------------------------
    // 1. Upload GPX and wait for pipeline
    // -----------------------------------------------------------------------
    await page.goto("/");
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(GPX_PATH);
    await expect(page.locator(".export-panel")).toBeVisible({ timeout: 120_000 });
    snapshots.push({ ts: ts(), label: "pipeline-done", data: null });

    // -----------------------------------------------------------------------
    // 2. Check enrichment panel is visible and SearXNG available
    // -----------------------------------------------------------------------
    const enrichPanel = page.locator(".enrichment-panel");
    await expect(enrichPanel).toBeVisible({ timeout: 5_000 });

    // Check SearXNG notice — if it says unavailable, we can't proceed
    const searxngUnavailable = enrichPanel.locator(".enrichment-notice", {
      hasText: "SearXNG unavailable",
    });
    const isSearxngDown = await searxngUnavailable.isVisible().catch(() => false);
    if (isSearxngDown) {
      snapshots.push({ ts: ts(), label: "searxng-unavailable", data: "ABORT" });
      writeReport();
      test.skip(true, "SearXNG is not available — cannot test enrichment");
      return;
    }

    // -----------------------------------------------------------------------
    // 3. Click "Enrich" button
    // -----------------------------------------------------------------------
    const enrichBtn = enrichPanel.locator("button.neo-btn-primary", {
      hasText: /Enrich/,
    });
    await expect(enrichBtn).toBeVisible({ timeout: 2_000 });
    const btnText = await enrichBtn.textContent();
    snapshots.push({ ts: ts(), label: "enrich-btn-text", data: btnText });

    await enrichBtn.click();
    snapshots.push({ ts: ts(), label: "enrich-clicked", data: null });

    // -----------------------------------------------------------------------
    // 4. Poll enrichment state until done/error/paused (up to 4 min)
    // -----------------------------------------------------------------------
    const pollInterval = 3_000;
    const maxWait = 240_000;
    const pollStart = Date.now();
    let finalStage = "unknown";

    while (Date.now() - pollStart < maxWait) {
      await page.waitForTimeout(pollInterval);

      // Grab current state of enrichment panel
      const panelText = await enrichPanel.textContent().catch(() => "");

      // Detect terminal states
      if (panelText?.includes("Enriched") && panelText?.includes("POIs")) {
        // "Enriched X/Y POIs" — done state
        finalStage = "done";
        snapshots.push({ ts: ts(), label: "enrichment-done", data: panelText?.slice(0, 500) });
        break;
      }
      if (panelText?.includes("Error:")) {
        finalStage = "error";
        snapshots.push({ ts: ts(), label: "enrichment-error", data: panelText?.slice(0, 500) });
        break;
      }
      if (panelText?.includes("CAPTCHA") || panelText?.includes("All search engines blocked")) {
        finalStage = "paused-captcha";
        snapshots.push({ ts: ts(), label: "enrichment-captcha", data: panelText?.slice(0, 500) });
        break;
      }

      // Log progress
      const progressMatch = panelText?.match(/(\d+)\/(\d+)/);
      if (progressMatch) {
        snapshots.push({
          ts: ts(),
          label: "progress",
          data: `${progressMatch[1]}/${progressMatch[2]} — ${panelText?.slice(0, 200)}`,
        });
      }
    }

    if (finalStage === "unknown") {
      finalStage = "timeout";
      const panelText = await enrichPanel.textContent().catch(() => "");
      snapshots.push({ ts: ts(), label: "enrichment-timeout", data: panelText?.slice(0, 500) });
    }

    // -----------------------------------------------------------------------
    // 5. Capture debug panel content
    // -----------------------------------------------------------------------
    const debugToggle = page.locator('[data-testid="debug-toggle"]');
    if (await debugToggle.isVisible({ timeout: 1_000 }).catch(() => false)) {
      await debugToggle.click();
      await page.waitForTimeout(500);
      const debugContent = await page
        .locator(".debug-panel")
        .textContent()
        .catch(() => null);
      if (debugContent) {
        snapshots.push({
          ts: ts(),
          label: "debug-panel",
          text: debugContent.slice(0, 10_000),
          data: debugContent.slice(0, 10_000),
        });
      }
    }

    // -----------------------------------------------------------------------
    // 6. Capture engine-failures details if present
    // -----------------------------------------------------------------------
    const engineDetails = enrichPanel.locator(".engine-failures");
    if (await engineDetails.isVisible().catch(() => false)) {
      await engineDetails.locator("summary").click();
      const engineText = await engineDetails.textContent().catch(() => "");
      snapshots.push({ ts: ts(), label: "engine-failures", data: engineText });
    }

    // -----------------------------------------------------------------------
    // 7. Write report
    // -----------------------------------------------------------------------
    function writeReport() {
      const report = {
        gpx: "Hasparren → Baztan",
        date: new Date().toISOString(),
        finalStage,
        totalTimeMs: ts(),
        consoleErrors: errors,
        networkFailures,
        totalConsoleLogs: logs.length,
        warningCount: logs.filter((l) => l.type === "warning").length,
        errorCount: errors.length,
        snapshots,
        // Last 100 logs for context
        recentLogs: logs.slice(-100),
      };

      const reportPath = path.resolve(__dirname, "../e2e-enrichment-report.json");
      fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));

      console.log("\n=== ENRICHMENT DIAGNOSTIC ===");
      console.log(`Final stage: ${finalStage}`);
      console.log(`Total time: ${Math.round(ts() / 1000)}s`);
      console.log(`Console errors: ${errors.length}`);
      console.log(`Network failures: ${networkFailures.length}`);
      console.log(`Snapshots: ${snapshots.length}`);
      console.log(`Report: ${reportPath}`);
      console.log("=============================\n");
    }

    writeReport();

    // Soft assertions — we want the report even if these fail
    expect(["done", "paused-captcha"]).toContain(finalStage);
  });
});
