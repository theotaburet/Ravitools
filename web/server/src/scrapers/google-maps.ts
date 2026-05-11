/**
 * Google Maps scraper — pure parsing helpers + Playwright extraction.
 *
 * Extracted from index.ts in Phase 3b (PR1: pure refactor, no behavior change).
 * The job system (queue, persisted jobs map, retry orchestration) remains in
 * index.ts; this module owns only the page-level extraction.
 *
 * Dependencies are injected (logger, sleep, randomDelay, getBrowser) to keep
 * the module pure and trivially mockable in tests.
 */

import type { Browser, Page } from "playwright";
import type { Logger } from "pino";
import { getBrowserContext, saveBrowserState } from "../browser-context.js";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type GoogleMapsHoursEntry = { day: string; open: string; close: string | null };

export type GoogleMapsPreview = {
  url: string;
  resolvedUrl: string | null;
  title: string | null;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  priceLevel: number | null;
  hoursText: string | null;
  /** Structured opening hours extracted from the expanded hours panel.
   *  Array of {day, open, close} — compatible with client OpeningHoursEntry. */
  structuredHours: GoogleMapsHoursEntry[] | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  snippet: string | null;
  fetchedAt: string;
};

export interface GoogleMapsScraperDeps {
  log: Logger;
  sleep: (ms: number) => Promise<void>;
  randomDelay: (minMs: number, maxMs: number) => number;
}

/**
 * Optional HTTP/SOCKS proxy for Google Maps requests.
 * Set GOOGLE_MAPS_PROXY_URL to e.g. "http://user:pass@proxy.example.com:8080"
 * or "socks5://user:pass@proxy.example.com:1080".
 */
export const GOOGLE_MAPS_PROXY_URL = process.env.GOOGLE_MAPS_PROXY_URL ?? null;

// ---------------------------------------------------------------------------
// Pure text helpers (no Playwright dependency, trivially testable)
// ---------------------------------------------------------------------------

export function parseGoogleMapsText(text: string | null | undefined): string | null {
  if (!text) return null;
  const compact = text.replace(/\s+/g, " ").trim();
  return compact || null;
}

export function extractPriceLevelFromText(text: string | null): number | null {
  if (!text) return null;
  const match = text.match(/([$€£])\1{0,3}/);
  if (!match) return null;
  return Math.min(match[0].length, 4);
}

export function normalizeGoogleMapsGlyphs(text: string | null): string | null {
  return text ? text.replace(/[]/g, " ").replace(/\s+/g, " ").trim() : null;
}

export function extractLocalGoogleMapsWindow(bodyText: string | null, title: string | null): string | null {
  if (!bodyText) return null;
  if (!title) return bodyText.slice(0, 800);
  const cleanTitle = title.replace(/\s*-\s*Google Maps$/i, "").trim();
  const idx = bodyText.toLowerCase().indexOf(cleanTitle.toLowerCase());
  if (idx === -1) return bodyText.slice(0, 800);
  return bodyText.slice(idx, idx + 900);
}

export function extractGoogleMapsCategory(localText: string | null): string | null {
  if (!localText) return null;
  const starCategory = localText.match(/\(\d[\d\s., ]*\)\s*·\s*([^·]{3,60})\s*·/i);
  if (starCategory?.[1]) {
    return normalizeGoogleMapsGlyphs(parseGoogleMapsText(starCategory[1]));
  }
  const match = localText.match(/\d(?:[.,]\d)\s*(?:\(([\d\s., ]+)\))?\s*([^·]{3,60}?)(?:·\s*)?(?:Présentation|Overview|Prix|About|À propos|Directions|Itinéraires)/i)
    ?? localText.match(/\d(?:[.,]\d)\s+([^·]{3,60}?)(?:Présentation|Overview|Prix|About|À propos|Directions|Itinéraires)/i);
  return normalizeGoogleMapsGlyphs(parseGoogleMapsText(match?.[2] ?? match?.[1] ?? null));
}

export function cleanGoogleMapsPhone(phone: string | null): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/^[^+0-9]+/, "").trim();
  return cleaned || null;
}

export function cleanGoogleMapsHours(hoursText: string | null): string | null {
  if (!hoursText) return null;
  const cleaned = normalizeGoogleMapsGlyphs(hoursText);
  if (!cleaned || cleaned.length < 4) return null;
  if (!/(open|closed|ouvre|fermé|ferme|\d{1,2}[:h]\d{2})/i.test(cleaned)) return null;
  return cleaned;
}

// ---------------------------------------------------------------------------
// Day & time normalization
// ---------------------------------------------------------------------------

const DAY_NORMALIZATIONS: Record<string, string> = {
  // English
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu",
  friday: "Fri", saturday: "Sat", sunday: "Sun",
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu",
  fri: "Fri", sat: "Sat", sun: "Sun",
  // French
  lundi: "Mon", mardi: "Tue", mercredi: "Wed", jeudi: "Thu",
  vendredi: "Fri", samedi: "Sat", dimanche: "Sun",
  // Spanish
  lunes: "Mon", martes: "Tue", miércoles: "Wed", jueves: "Thu",
  viernes: "Fri", sábado: "Sat", domingo: "Sun",
};

export function normalizeDay(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return DAY_NORMALIZATIONS[lower] ?? raw.trim();
}

export function normalizeTimeString(raw: string): string {
  const s = raw.trim();
  // 12h format: "8:00 AM", "10:00 PM"
  const match12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match12) {
    let h = Number.parseInt(match12[1], 10);
    const m = match12[2];
    const meridiem = match12[3].toUpperCase();
    if (meridiem === "AM" && h === 12) h = 0;
    if (meridiem === "PM" && h !== 12) h += 12;
    return `${String(h).padStart(2, "0")}:${m}`;
  }
  // 24h format: "08:00", "20:00", "20h00"
  const match24 = s.match(/^(\d{1,2})[h:](\d{2})$/i);
  if (match24) {
    const h = Number.parseInt(match24[1], 10);
    const m = match24[2];
    if (h >= 0 && h <= 23 && Number.parseInt(m, 10) <= 59) {
      return `${String(h).padStart(2, "0")}:${m}`;
    }
  }
  return s;
}

export function parseGoogleMapsHoursRow(row: string): GoogleMapsHoursEntry | null {
  const s = normalizeGoogleMapsGlyphs(row)?.trim();
  if (!s) return null;

  const spaceIdx = s.search(/\s+/);
  if (spaceIdx === -1) return null;
  const dayRaw = s.slice(0, spaceIdx).trim();
  const timePart = s.slice(spaceIdx).trim();
  const day = normalizeDay(dayRaw);

  if (/^(closed|fermé|ferme|cerrado|geschlossen|chiuso|closed all day)$/i.test(timePart)) {
    return { day, open: "closed", close: null };
  }

  const sep = /\s*[–—\-]\s*/;
  const rangeParts = timePart.split(sep);
  if (rangeParts.length >= 2) {
    const openTime = normalizeTimeString(rangeParts[0].trim());
    const closeTime = normalizeTimeString(rangeParts[rangeParts.length - 1].trim());
    if (/^\d{2}:\d{2}$/.test(openTime) && /^\d{2}:\d{2}$/.test(closeTime)) {
      return { day, open: openTime, close: closeTime };
    }
  }

  if (/24\s*hours?|open 24|ouvert 24/i.test(timePart)) {
    return { day, open: "00:00", close: "23:59" };
  }

  return null;
}

// ---------------------------------------------------------------------------
// Rating / review count extraction (pure)
// ---------------------------------------------------------------------------

export function extractGoogleMapsReviewCount(localText: string | null): number | null {
  if (!localText) return null;
  const firstSection = localText.split(/Hôtels similaires|Nearby hotels|À proximité/i)[0] ?? localText;
  const match = firstSection.match(/\((\d[\d\s., ]*)\)/) ?? firstSection.match(/(\d[\d\s., ]*)\s+(?:reviews?|avis)/i);
  if (!match) return null;
  const normalized = match[1].replace(/[\s., ]/g, "");
  const value = Number.parseInt(normalized, 10);
  return Number.isFinite(value) ? value : null;
}

export function extractGoogleMapsRating(localText: string | null): number | null {
  if (!localText) return null;
  const firstSection = localText.split(/Hôtels similaires|Nearby hotels?|Similar places|À proximité|Nearby places/i)[0] ?? localText;
  const match = firstSection.match(/\b(\d(?:[.,]\d))\b/);
  if (!match) return null;
  const value = Number.parseFloat(match[1].replace(",", "."));
  return Number.isFinite(value) && value >= 1 && value <= 5 ? value : null;
}

// ---------------------------------------------------------------------------
// Playwright-backed extraction helpers
// ---------------------------------------------------------------------------

export async function extractTextBySelectors(page: Page, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    const value = parseGoogleMapsText(await page.locator(selector).first().innerText({ timeout: 1_500 }).catch(() => ""));
    if (value) return value;
  }
  return null;
}

export async function clickFirstGoogleMapsResult(page: Page, log: Logger): Promise<void> {
  const firstResult = page.locator('a[href*="/maps/place/"]').first();
  if (await firstResult.count()) {
    log.info({ selector: 'a[href*="/maps/place/"]' }, "Google Maps: clicking first place result");
    await firstResult.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
    return;
  }

  const roleResult = page.getByRole("link").filter({ has: page.locator('div[role="article"], div.Nv2PK') }).first();
  if (await roleResult.count()) {
    log.info({ selector: "role=link article" }, "Google Maps: clicking fallback result card");
    await roleResult.click({ timeout: 5_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  }
}

export async function acceptGoogleConsentIfPresent(page: Page, log: Logger): Promise<void> {
  if (!page.url().includes("consent.google.com")) return;

  log.info({ pageUrl: page.url() }, "Google Maps preview: consent page detected");

  const buttons = [
    'button:has-text("Accept all")',
    'button:has-text("I agree")',
    'button:has-text("Tout accepter")',
    'button:has-text("J’accepte")',
    'button:has-text("Alle akzeptieren")',
    'form[action*="consent"] button',
  ];

  for (const selector of buttons) {
    const locator = page.locator(selector).first();
    if (await locator.count()) {
      await locator.click({ timeout: 5_000 }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
      log.info({ selector, pageUrl: page.url() }, "Google Maps preview: consent accepted");
      return;
    }
  }

  const continueUrl = new URL(page.url()).searchParams.get("continue");
  if (continueUrl) {
    log.warn({ continueUrl }, "Google Maps preview: consent button not found, following continue URL directly");
    await page.goto(continueUrl, { waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  }
}

/**
 * Click the collapsed hours button to open the expanded panel, then extract
 * structured opening hours row by row. Returns null if extraction fails.
 */
export async function extractExpandedGoogleMapsHours(
  page: Page,
  deps: GoogleMapsScraperDeps,
): Promise<GoogleMapsHoursEntry[] | null> {
  const { log, sleep } = deps;
  const expandSelectors = [
    'button[aria-label*="Open"]',
    'button[aria-label*="Closed"]',
    'button[aria-label*="Ouvre"]',
    'button[aria-label*="Ferme"]',
    'button[aria-label*="hours"]',
    'button[aria-label*="horaires"]',
    'div[data-section-id="oh"] button',
    'button[jsaction*="openhours"]',
  ];

  for (const selector of expandSelectors) {
    const locator = page.locator(selector).first();
    if (!await locator.count()) continue;
    await locator.click({ timeout: 3_000 }).catch(() => undefined);
    await sleep(800);
    break;
  }

  const rowSelectors = [
    'table.WgFkxc tr',
    'table[aria-label*="hours"] tr',
    'table[aria-label*="horaires"] tr',
    'div[aria-label*="hours"] li',
    'div.t39EBf.GUrTXd',
    'tr[class*="hours"]',
  ];

  for (const selector of rowSelectors) {
    const rows = page.locator(selector);
    const count = await rows.count();
    if (count < 2) continue;

    const entries: GoogleMapsHoursEntry[] = [];
    for (let i = 0; i < Math.min(count, 7); i++) {
      const rowText = await rows.nth(i).innerText({ timeout: 1_500 }).catch(() => "");
      const parsed = parseGoogleMapsHoursRow(rowText);
      if (parsed) entries.push(parsed);
    }

    if (entries.length >= 2) {
      log.info({ selector, count, parsed: entries.length }, "Google Maps: structured hours extracted from panel");
      return entries;
    }
  }

  // Fallback: parse body text for day-labelled lines
  const bodyText = normalizeGoogleMapsGlyphs(
    await page.locator("body").innerText({ timeout: 3_000 }).catch(() => ""),
  );
  if (!bodyText) return null;

  const dayPattern = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche)\s+.+/im;
  const lines = bodyText.split("\n").map((l) => l.trim()).filter(Boolean);
  const entries: GoogleMapsHoursEntry[] = [];
  let inBlock = false;
  let consecutiveMisses = 0;

  for (const line of lines) {
    const parsed = dayPattern.test(line) ? parseGoogleMapsHoursRow(line) : null;
    if (parsed) {
      entries.push(parsed);
      inBlock = true;
      consecutiveMisses = 0;
    } else if (inBlock) {
      consecutiveMisses++;
      if (consecutiveMisses > 2) break;
    }
  }

  if (entries.length >= 2) {
    log.info({ parsed: entries.length }, "Google Maps: structured hours extracted from body text fallback");
    return entries;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main extraction entry point
// ---------------------------------------------------------------------------

/**
 * Fetch a single Google Maps preview for the given URL.
 *
 * Uses the shared BrowserContext (from browser-context.ts) so cookies and
 * session identity persist across requests. Returns null when blocked by
 * captcha (caller can retry or surface a `paused-captcha` state).
 */
export async function fetchGoogleMapsPreviewOnce(
  url: string,
  attempt: number,
  browser: Browser,
  deps: GoogleMapsScraperDeps,
): Promise<GoogleMapsPreview | null> {
  const { log, sleep, randomDelay } = deps;
  const context = await getBrowserContext(browser);
  // Page-level locale/UA/viewport overrides removed: the shared context owns
  // identity. Rotating per page would defeat session continuity (Google detects
  // the inconsistency and increases captcha rate).
  const page = await context.newPage();

  try {
    log.info({ url, attempt }, "Google Maps preview: opening page");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await acceptGoogleConsentIfPresent(page, log);
    await sleep(randomDelay(1_000, 3_000));

    const initialText = parseGoogleMapsText(await page.locator("body").innerText({ timeout: 5_000 }).catch(() => ""));
    if (/(captcha|unusual traffic|not a robot)/i.test(initialText ?? "")) {
      log.warn({ url, attempt, pageUrl: page.url(), initialText: initialText?.slice(0, 200) }, "Google Maps preview blocked by CAPTCHA/traffic checks");
      return null;
    }

    if (page.url().includes("/maps/search/") || /results/i.test(initialText ?? "")) {
      log.info({ url, attempt, pageUrl: page.url() }, "Google Maps preview: search result page detected");
      await clickFirstGoogleMapsResult(page, log);
      await sleep(randomDelay(1_500, 4_000));
    }

    const title = parseGoogleMapsText(await page.title())
      ?? await extractTextBySelectors(page, ["h1", 'h1.DUwDvf', 'div[role="main"] h1']);
    const bodyText = normalizeGoogleMapsGlyphs(parseGoogleMapsText(await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "")));
    const localText = extractLocalGoogleMapsWindow(bodyText, title);
    const snippet = bodyText?.slice(0, 1200) ?? null;

    const rating = extractGoogleMapsRating(localText);
    const reviewCount = extractGoogleMapsReviewCount(localText);

    const structuredHours = await extractExpandedGoogleMapsHours(page, deps).catch((err) => {
      log.warn({ err }, "Google Maps: structured hours extraction failed, falling back to text");
      return null;
    });

    let hoursText: string | null = null;
    if (structuredHours && structuredHours.length > 0) {
      hoursText = structuredHours
        .map((e) => {
          if (e.open.toLowerCase() === "closed") return `${e.day}: closed`;
          if (e.close) return `${e.day}: ${e.open}-${e.close}`;
          return `${e.day}: ${e.open}`;
        })
        .join("; ");
    } else {
      hoursText = await extractTextBySelectors(page, [
        'button[aria-label*="Open"]',
        'button[aria-label*="Closed"]',
        'button[aria-label*="Ouvre"]',
        'button[aria-label*="Ferme"]',
        'div[aria-label*="Hours"]',
        'div[aria-label*="horaires"]',
      ]) ?? (() => {
        const match = localText?.match(/(?:Open|Closed)[^\n]{0,80}/i)
          ?? localText?.match(/(?:Ouvre|Fermé|Ferme)[^\n]{0,80}/i);
        return parseGoogleMapsText(match?.[0] ?? null);
      })();
      hoursText = cleanGoogleMapsHours(hoursText);
    }

    const phone = cleanGoogleMapsPhone(
      await extractTextBySelectors(page, ['button[data-item-id*="phone"]', 'button[aria-label^="Phone:"]'])
      ?? parseGoogleMapsText(bodyText?.match(/\+?\d[\d\s().-]{6,}/)?.[0] ?? null),
    );
    const website = await page.locator('a[data-item-id="authority"], a[data-tooltip="Open website"]').getAttribute("href").catch(() => null);
    const address = normalizeGoogleMapsGlyphs(await extractTextBySelectors(page, ['button[data-item-id*="address"]', 'button[aria-label^="Address:"]']))
      ?? (() => {
        const match = bodyText?.match(/\b\d{4,5}[^\n]{10,120}/) ?? null;
        return normalizeGoogleMapsGlyphs(parseGoogleMapsText(match?.[0] ?? null));
      })();
    const category = await extractTextBySelectors(page, ['button[jsaction*="category"]', 'button[aria-label*="stars"] + button'])
      ?? extractGoogleMapsCategory(localText);

    log.info({
      url,
      pageUrl: page.url(),
      title,
      category,
      rating,
      reviewCount,
      priceLevel: extractPriceLevelFromText(bodyText),
      hasHours: Boolean(hoursText),
      hasAddress: Boolean(address),
      hasPhone: Boolean(phone),
      hasWebsite: Boolean(website),
    }, "Google Maps preview extracted");

    return {
      url,
      resolvedUrl: page.url(),
      title,
      category,
      rating,
      reviewCount,
      priceLevel: extractPriceLevelFromText(bodyText),
      hoursText,
      structuredHours: structuredHours ?? null,
      address,
      phone,
      website,
      snippet,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    log.error({ err, url, attempt, pageUrl: page.url().slice(0, 200) }, "Google Maps preview extraction failed");
    throw err;
  } finally {
    await page.close().catch(() => undefined);
    // Fire-and-forget: persist cookies after each request. Debounced to ~1
    // I/O per 30s inside saveBrowserState(), so cheap.
    saveBrowserState().catch(() => undefined);
  }
}
