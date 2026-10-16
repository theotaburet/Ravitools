import { type Browser, chromium } from "playwright";
import { log } from "./logger.js";
import { GOOGLE_MAPS_PROXY_URL } from "./scrapers/google-maps.js";

let browserPromise: Promise<Browser> | null = null;

export { setTimeout as sleep } from "node:timers/promises";

export function randomDelay(minMs: number, maxMs: number): number {
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

export async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const launchOptions: Parameters<typeof chromium.launch>[0] = { headless: true };
    if (GOOGLE_MAPS_PROXY_URL) {
      launchOptions.proxy = { server: GOOGLE_MAPS_PROXY_URL };
      log.info({ proxy: GOOGLE_MAPS_PROXY_URL }, "Google Maps browser: using proxy");
    }
    // Clear the slot if launch rejects, else a single failed launch is
    // cached forever and scrapers never recover until restart.
    browserPromise = chromium.launch(launchOptions).catch((e) => {
      browserPromise = null;
      throw e;
    });
  }
  return browserPromise;
}

/** Close the shared browser if it was ever launched (graceful shutdown). */
export async function closeBrowser(): Promise<void> {
  if (!browserPromise) return;
  try {
    const browser = await browserPromise;
    await browser.close();
    log.info("Playwright browser closed");
  } catch {
    /* already closed */
  }
}
