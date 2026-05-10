/**
 * Shared Playwright browser context with persisted storage state.
 *
 * Goal: reuse a single BrowserContext across all Google Maps (and future Yandex)
 * scrapes so that cookies (consent, anti-bot, NID) accumulate and persist on
 * disk. This dramatically reduces the captcha rate compared to creating a fresh
 * context per page.
 *
 * Strategy:
 * - One Browser singleton (already in index.ts via getBrowser)
 * - One BrowserContext singleton, lazily created with storageState if file exists
 * - Pages are ephemeral and inherit cookies from the context
 * - Locale + UA are fixed at the context level (rotating per page would defeat
 *   session continuity — Google detects the inconsistency)
 * - StorageState saved to disk:
 *   - Manually after a captcha is solved (call `saveBrowserState()`)
 *   - Periodically (debounced, max 1x / 30s)
 *   - On graceful shutdown
 *
 * Privacy: only OSM-style metadata is stored. No GPX, no user data. The cookie
 * jar contains only cookies set by visited domains (Google, Yandex, etc.).
 */

import { join } from "node:path";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import type { Browser, BrowserContext, BrowserContextOptions } from "playwright";
import { pino } from "pino";

const log = pino({ name: "browser-context" });

const STATE_DIR = join(process.cwd(), ".cache");
const STATE_FILE = join(STATE_DIR, "browser-state.json");

/** Min interval between two disk saves (debounce). */
const SAVE_DEBOUNCE_MS = 30_000;

/**
 * Default locale for the shared context. Override via env GOOGLE_MAPS_LOCALE.
 * Fixed (not rotated) for session consistency.
 */
const DEFAULT_LOCALE = process.env.GOOGLE_MAPS_LOCALE ?? "fr-FR";

/**
 * Default User-Agent. Fixed (not rotated) for session consistency.
 * If unset, Playwright's default Chromium UA is used.
 */
const DEFAULT_USER_AGENT = process.env.GOOGLE_MAPS_USER_AGENT
  ?? "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

let contextPromise: Promise<BrowserContext> | null = null;
let lastSaveAt = 0;
let pendingSave: Promise<void> | null = null;

/**
 * Read storageState from disk if it exists, otherwise return undefined.
 * Returns undefined (not throw) on any I/O or parse error so the caller can
 * gracefully start with an empty session.
 */
async function loadStorageState(): Promise<{ cookies?: unknown; origins?: unknown } | undefined> {
  try {
    await access(STATE_FILE);
  } catch {
    return undefined;
  }
  try {
    const raw = await readFile(STATE_FILE, "utf8");
    const parsed = JSON.parse(raw) as { cookies?: unknown; origins?: unknown };
    const cookieCount = Array.isArray(parsed.cookies) ? parsed.cookies.length : 0;
    log.info({ file: STATE_FILE, cookies: cookieCount }, "Loaded browser storage state");
    return parsed;
  } catch (err) {
    log.warn({ err: (err as Error).message }, "Failed to read browser storage state, starting fresh");
    return undefined;
  }
}

/**
 * Get (or lazily create) the shared BrowserContext.
 *
 * Subsequent calls return the same context. Use `(await getBrowserContext()).newPage()`
 * to create ephemeral pages that share cookies with the rest of the session.
 */
export async function getBrowserContext(browser: Browser): Promise<BrowserContext> {
  if (!contextPromise) {
    contextPromise = (async () => {
      const storageState = await loadStorageState();
      const options: BrowserContextOptions = {
        locale: DEFAULT_LOCALE,
        userAgent: DEFAULT_USER_AGENT,
        viewport: { width: 1366, height: 900 },
      };
      if (storageState) {
        options.storageState = storageState as BrowserContextOptions["storageState"];
      }
      const ctx = await browser.newContext(options);
      // Auto-save on context close (defense-in-depth; explicit saves preferred)
      ctx.on("close", () => {
        log.info("Browser context closed");
      });
      log.info({ locale: DEFAULT_LOCALE }, "Browser context ready");
      return ctx;
    })();
  }
  return contextPromise;
}

/**
 * Persist the current storage state to disk.
 *
 * Throttled to at most one I/O per SAVE_DEBOUNCE_MS, except when `force=true`
 * (used at shutdown or right after a captcha resolution where freshness matters).
 *
 * Always swallows errors so the caller (often a hot path) is never blocked.
 */
export async function saveBrowserState(force = false): Promise<void> {
  if (!contextPromise) return;
  const now = Date.now();
  if (!force && now - lastSaveAt < SAVE_DEBOUNCE_MS) return;
  if (pendingSave) return pendingSave;

  pendingSave = (async () => {
    try {
      const ctx = await contextPromise!;
      await mkdir(STATE_DIR, { recursive: true });
      const state = await ctx.storageState();
      await writeFile(STATE_FILE, JSON.stringify(state), "utf8");
      lastSaveAt = Date.now();
      log.info(
        { file: STATE_FILE, cookies: state.cookies?.length ?? 0, force },
        "Saved browser storage state",
      );
    } catch (err) {
      log.warn({ err: (err as Error).message }, "Failed to save browser storage state");
    } finally {
      pendingSave = null;
    }
  })();
  return pendingSave;
}

/**
 * Close the shared context (and flush state).
 * Used at graceful shutdown.
 */
export async function closeBrowserContext(): Promise<void> {
  if (!contextPromise) return;
  try {
    await saveBrowserState(true);
    const ctx = await contextPromise;
    await ctx.close();
  } catch (err) {
    log.warn({ err: (err as Error).message }, "Failed to close browser context cleanly");
  } finally {
    contextPromise = null;
  }
}

/** Test-only reset (not exported in prod paths). */
export function _resetBrowserContextForTests(): void {
  contextPromise = null;
  lastSaveAt = 0;
  pendingSave = null;
}
