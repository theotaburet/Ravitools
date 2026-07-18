import { app, googleMapsSystem } from "./app.js";
import { closeBrowser } from "./browser.js";
import { closeBrowserContext } from "./browser-context.js";
import { OVERPASS_URL, PORT } from "./config.js";
import { closeDb, initDb } from "./db.js";
import { log } from "./logger.js";

// ---------------------------------------------------------------------------
// Start (only when run directly, not when imported for testing)
// ---------------------------------------------------------------------------
if (process.env.NODE_ENV !== "test") {
  // Fire-and-forget DB init (graceful degradation if unavailable)
  initDb().catch((err) => log.error({ err: err?.message }, "DB init unexpected error"));

  app.listen(PORT, () => {
    log.info({ port: PORT, overpass: OVERPASS_URL }, "Ravitools proxy started");
  });

  // Graceful shutdown — close Playwright browser to avoid orphaned Chromium processes
  const shutdown = async () => {
    log.info("Shutting down...");
    try {
      // Flush + close shared context first (saves cookies to disk)
      await closeBrowserContext();
    } catch {
      /* ignore */
    }
    await closeBrowser();
    try {
      await closeDb(); // drain the pg pool (AUDIT S4)
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

export default app;

// Test-only export: the live scraper system the app routes use, so tests can
// reach its job cache / persistence. Pure helpers are imported directly from
// their modules in tests (AUDIT R30).
export const _testExports = { googleMapsSystem };
