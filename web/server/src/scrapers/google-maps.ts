/**
 * Google Maps scraper: pure parsing helpers + Playwright extraction, and the
 * `googleMapsPlugin` the job system runs.
 */

import type { Logger } from "pino";
import type { Browser, Page } from "playwright";
import { getBrowserContext, saveBrowserState } from "../browser-context.js";
import {
  BLOCKED_ERROR_PREFIX,
  type MapHoursEntry,
  type MapPreview,
  type MapScraperPlugin,
  type ScraperDeps,
} from "./types.js";

type PageDeps = Omit<ScraperDeps, "getBrowser">;

/**
 * Optional HTTP/SOCKS proxy for Google Maps requests.
 * Set GOOGLE_MAPS_PROXY_URL to e.g. "http://user:pass@proxy.example.com:8080"
 * or "socks5://user:pass@proxy.example.com:1080".
 */
export const GOOGLE_MAPS_PROXY_URL = process.env.GOOGLE_MAPS_PROXY_URL ?? null;

// --- Pure text helpers (no Playwright dependency, trivially testable) ---

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

export function extractLocalGoogleMapsWindow(
  bodyText: string | null,
  title: string | null,
): string | null {
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
    return parseGoogleMapsText(starCategory[1]);
  }
  const match =
    localText.match(
      /\d(?:[.,]\d)\s*(?:\(([\d\s., ]+)\))?\s*([^·]{3,60}?)(?:·\s*)?(?:Présentation|Overview|Prix|About|À propos|Directions|Itinéraires)/i,
    ) ??
    localText.match(
      /\d(?:[.,]\d)\s+([^·]{3,60}?)(?:Présentation|Overview|Prix|About|À propos|Directions|Itinéraires)/i,
    );
  return parseGoogleMapsText(match?.[2] ?? match?.[1] ?? null);
}

export function cleanGoogleMapsPhone(phone: string | null): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/^[^+0-9]+/, "").trim();
  return cleaned || null;
}

/**
 * Drop the live open/closed status ("Closed ⋅ Opens 9 AM Mon", "Ouvert · Ferme à
 * 18:30"): it describes the moment of the scrape, not the schedule, and a
 * night-time scrape would otherwise tell the LLM every place is closed.
 */
export function stripLiveOpenStatus(text: string | null): string | null {
  if (!text) return null;
  return text.replace(
    /(?:Ouvert|Fermé|Open|Closed)\s*[·⋅]\s*(?:Ferme|Ouvre|Closes|Opens)\s+(?:à\s+)?\d{1,2}(?:[:h]\d{2})?(?:\s*[AaPp][Mm])?(?:\s+(?:lun|mar|mer|jeu|ven|sam|dim)\.?|\s+(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?![a-z]))?\s*/g,
    "",
  );
}

// --- Day & time normalization ---

const DAY_NORMALIZATIONS: Record<string, string> = {
  // English
  monday: "Mon",
  tuesday: "Tue",
  wednesday: "Wed",
  thursday: "Thu",
  friday: "Fri",
  saturday: "Sat",
  sunday: "Sun",
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
  // French
  lundi: "Mon",
  mardi: "Tue",
  mercredi: "Wed",
  jeudi: "Thu",
  vendredi: "Fri",
  samedi: "Sat",
  dimanche: "Sun",
  // Spanish
  lunes: "Mon",
  martes: "Tue",
  miércoles: "Wed",
  jueves: "Thu",
  viernes: "Fri",
  sábado: "Sat",
  domingo: "Sun",
};

export function normalizeDay(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return DAY_NORMALIZATIONS[lower] ?? raw.trim();
}

export function normalizeTimeString(raw: string): string {
  const s = raw.trim();
  // 12h format: "8:00 AM", "10:00 PM", "9 AM"
  const match12 = s.match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)$/i);
  if (match12) {
    let h = Number.parseInt(match12[1], 10);
    const m = match12[2] ?? "00";
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

export function parseGoogleMapsHoursRow(row: string): MapHoursEntry | null {
  const s = parseGoogleMapsText(row);
  if (!s) return null;

  const spaceIdx = s.search(/\s+/);
  if (spaceIdx === -1) return null;
  const dayRaw = s.slice(0, spaceIdx).trim();
  const timePart = s.slice(spaceIdx).trim();
  const day = normalizeDay(dayRaw);

  if (/^(closed|fermé|ferme|cerrado|geschlossen|chiuso|closed all day)$/i.test(timePart)) {
    return { day, open: "closed", close: null };
  }

  const sep = /\s*[\u2013\u2014-]\s*/;
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

/**
 * Parse one day button's aria-label. Google Maps (2026) has no hours table any
 * more: each day is a button labelled "Monday, 9 AM to 12 PM, 2 to 6:30 PM, Copy
 * open hours" (the page is forced to English; other UI languages parse as long as
 * the day name is known). Several ranges collapse to first open / last close.
 */
export function parseGoogleMapsHoursLabel(label: string): MapHoursEntry | null {
  const parts = label.split(/,\s*/);
  if (parts.length < 2) return null;
  const day = DAY_NORMALIZATIONS[parts[0].trim().toLowerCase()];
  if (!day) return null;
  const ranges = parts.slice(1).join(", ");
  if (/ferm[ée]|closed|cerrado|geschlossen|chiuso/i.test(ranges)) {
    return { day, open: "closed", close: null };
  }
  if (/24\s*h|open 24|ouvert 24/i.test(ranges)) return { day, open: "00:00", close: "23:59" };
  const times = (ranges.match(/\d{1,2}(?:[:h]\d{2})?(?:\s*[AP]M)?/gi) ?? [])
    .map(normalizeTimeString)
    .filter((t) => /^\d{2}:\d{2}$/.test(t));
  if (times.length < 2) return null;
  return { day, open: times[0], close: times[times.length - 1] };
}

const DAY_LINE =
  /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche)\s+.+/i;

/**
 * Last-resort hours: the block of day-labelled lines ("Monday 9:00–18:00") in
 * the page text, read line by line (so the text must keep its line breaks).
 * Null when fewer than two days parse.
 */
export function parseHoursFromBodyText(text: string): MapHoursEntry[] | null {
  const entries: MapHoursEntry[] = [];
  let consecutiveMisses = 0;
  for (const line of text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)) {
    const parsed = DAY_LINE.test(line) ? parseGoogleMapsHoursRow(line) : null;
    if (parsed) {
      entries.push(parsed);
      consecutiveMisses = 0;
    } else if (entries.length > 0 && ++consecutiveMisses > 2) {
      break;
    }
  }
  return entries.length >= 2 ? entries : null;
}

// --- Rating / review count extraction (pure) ---

export function extractGoogleMapsReviewCount(localText: string | null): number | null {
  if (!localText) return null;
  const firstSection =
    localText.split(/Hôtels similaires|Nearby hotels|À proximité/i)[0] ?? localText;
  const match =
    firstSection.match(/\((\d[\d\s., ]*)\)/) ??
    firstSection.match(/(\d[\d\s., ]*)\s+(?:reviews?|avis)/i);
  if (!match) return null;
  const normalized = match[1].replace(/[\s., ]/g, "");
  const value = Number.parseInt(normalized, 10);
  return Number.isFinite(value) ? value : null;
}

export function extractGoogleMapsRating(localText: string | null): number | null {
  if (!localText) return null;
  const firstSection =
    localText.split(
      /Hôtels similaires|Nearby hotels?|Similar places|À proximité|Nearby places/i,
    )[0] ?? localText;
  const match = firstSection.match(/\b(\d(?:[.,]\d))\b/);
  if (!match) return null;
  const value = Number.parseFloat(match[1].replace(",", "."));
  return Number.isFinite(value) && value >= 1 && value <= 5 ? value : null;
}

// --- Playwright-backed extraction helpers ---

export async function extractTextBySelectors(
  page: Page,
  selectors: string[],
): Promise<string | null> {
  for (const selector of selectors) {
    const locator = page.locator(selector).first();
    // count() answers at once; innerText() on a missing element waits the full timeout.
    if (!(await locator.count())) continue;
    const value = parseGoogleMapsText(await locator.innerText({ timeout: 1_500 }).catch(() => ""));
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

  const roleResult = page
    .getByRole("link")
    .filter({ has: page.locator('div[role="article"], div.Nv2PK') })
    .first();
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
    log.warn(
      { continueUrl },
      "Google Maps preview: consent button not found, following continue URL directly",
    );
    await page
      .goto(continueUrl, { waitUntil: "domcontentloaded", timeout: 15_000 })
      .catch(() => undefined);
    await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
  }
}

/** Day buttons ("Sunday, 9 am to 7 pm, Copy open hours") of the first hours table. */
async function readDayButtons(page: Page): Promise<MapHoursEntry[]> {
  const labels = await page
    .locator("button[aria-label]")
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
  const byDay = new Map<string, MapHoursEntry>();
  for (const label of labels) {
    const parsed = parseGoogleMapsHoursLabel(label);
    if (!parsed) continue;
    // A repeated day starts a second table ("Online service hours"), not this place's
    if (byDay.has(parsed.day)) break;
    byDay.set(parsed.day, parsed);
  }
  return [...byDay.values()];
}

/**
 * Read the week from the day buttons' aria-labels (see parseGoogleMapsHoursLabel),
 * opening the folded panel when needed, then fall back to day-labelled lines in
 * the body text. Returns null when fewer than two days parse (one is enough
 * from the folded panel).
 */
export async function extractExpandedGoogleMapsHours(
  page: Page,
  deps: PageDeps,
): Promise<MapHoursEntry[] | null> {
  const { log } = deps;
  const days = await readDayButtons(page);
  if (days.length >= 2) {
    log.info({ parsed: days.length }, "Google Maps: structured hours extracted from day buttons");
    return days;
  }

  // Seasonal or irregular hours are folded behind "See more hours": the day
  // buttons only exist once it is opened, and may list a single day.
  const seeMore = page.locator('button[aria-label*="See more hours"]').first();
  if (days.length === 0 && (await seeMore.count()) > 0) {
    await seeMore.click({ timeout: 3_000 });
    await page
      .locator('button[aria-label$="Copy open hours"]')
      .first()
      .waitFor({ timeout: 5_000 })
      .catch(() => undefined);
    const folded = await readDayButtons(page);
    if (folded.length > 0) {
      log.info({ parsed: folded.length }, "Google Maps: structured hours extracted after opening");
      return folded;
    }
  }

  // Fallback: day-labelled lines of the body text
  const entries = parseHoursFromBodyText(
    await page
      .locator("body")
      .innerText({ timeout: 3_000 })
      .catch(() => ""),
  );
  if (entries) {
    log.info(
      { parsed: entries.length },
      "Google Maps: structured hours extracted from body text fallback",
    );
  }
  return entries;
}

// --- Main extraction entry point ---

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
  deps: PageDeps,
): Promise<MapPreview | null> {
  const { log, sleep, randomDelay } = deps;
  const context = await getBrowserContext(browser);
  const page = await context.newPage();

  try {
    log.info({ url, attempt }, "Google Maps preview: opening page");
    // One UI language whatever the place's country or the operator's locale:
    // the parsers below only have to know English day names and status words.
    const target = new URL(url);
    target.searchParams.set("hl", "en");
    await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await acceptGoogleConsentIfPresent(page, log);
    await sleep(randomDelay(1_000, 3_000));

    const initialText = parseGoogleMapsText(
      await page
        .locator("body")
        .innerText({ timeout: 5_000 })
        .catch(() => ""),
    );
    if (/(captcha|unusual traffic|not a robot)/i.test(initialText ?? "")) {
      log.warn(
        { url, attempt, pageUrl: page.url(), initialText: initialText?.slice(0, 200) },
        "Google Maps preview blocked by CAPTCHA/traffic checks",
      );
      throw new Error(`${BLOCKED_ERROR_PREFIX} Google Maps CAPTCHA / traffic check`);
    }

    if (page.url().includes("/maps/search/") || /results/i.test(initialText ?? "")) {
      log.info(
        { url, attempt, pageUrl: page.url() },
        "Google Maps preview: search result page detected",
      );
      await clickFirstGoogleMapsResult(page, log);
      await sleep(randomDelay(1_500, 4_000));
    }

    const title =
      parseGoogleMapsText(await page.title()) ??
      (await extractTextBySelectors(page, ["h1", "h1.DUwDvf", 'div[role="main"] h1']));
    const bodyText = parseGoogleMapsText(
      await page
        .locator("body")
        .innerText({ timeout: 5_000 })
        .catch(() => ""),
    );
    const localText = extractLocalGoogleMapsWindow(bodyText, title);
    const withoutStatus = stripLiveOpenStatus(bodyText);
    const snippet = withoutStatus?.slice(0, 1200) ?? null;

    const rating = extractGoogleMapsRating(localText);
    const reviewCount = extractGoogleMapsReviewCount(localText);

    const structuredHours = await extractExpandedGoogleMapsHours(page, deps).catch((err) => {
      log.warn({ err }, "Google Maps: structured hours extraction failed, falling back to text");
      return null;
    });

    // Layout check: Google changes its markup without notice. It prints a live
    // status ("Open ⋅ Closes 7 pm") only for places with hours, so a status with no
    // parsed day is a selector gone stale. "Temporarily closed", "Add hours" or the
    // "Hours" search filter are not hours.
    const layoutWarnings: string[] = [];
    if (!structuredHours && withoutStatus !== bodyText) {
      layoutWarnings.push("hours shown on the page but no day button parsed");
      log.error(
        { url, pageUrl: page.url() },
        "Google Maps layout check failed: hours shown on the page but no day button parsed",
      );
    }

    const hoursText = structuredHours?.length
      ? structuredHours
          .map((e) => {
            if (e.open.toLowerCase() === "closed") return `${e.day}: closed`;
            if (e.close) return `${e.day}: ${e.open}-${e.close}`;
            return `${e.day}: ${e.open}`;
          })
          .join("; ")
      : null;

    const phone = cleanGoogleMapsPhone(
      (await extractTextBySelectors(page, [
        'button[data-item-id*="phone"]',
        'button[aria-label^="Phone:"]',
      ])) ?? parseGoogleMapsText(bodyText?.match(/\+?\d[\d\s().-]{6,}/)?.[0] ?? null),
    );
    const website = await page
      .locator('a[data-item-id="authority"], a[data-tooltip="Open website"]')
      .getAttribute("href", { timeout: 1_500 })
      .catch(() => null);
    const address =
      (await extractTextBySelectors(page, [
        'button[data-item-id*="address"]',
        'button[aria-label^="Address:"]',
      ])) ??
      (() => {
        const match = bodyText?.match(/\b\d{4,5}[^\n]{10,120}/) ?? null;
        return parseGoogleMapsText(match?.[0] ?? null);
      })();
    const category =
      (await extractTextBySelectors(page, [
        'button[jsaction*="category"]',
        'button[aria-label*="stars"] + button',
      ])) ?? extractGoogleMapsCategory(localText);

    const priceLevel = extractPriceLevelFromText(bodyText);
    log.info(
      {
        url,
        pageUrl: page.url(),
        title,
        category,
        rating,
        reviewCount,
        priceLevel,
        hasHours: Boolean(hoursText),
        hasAddress: Boolean(address),
        hasPhone: Boolean(phone),
        hasWebsite: Boolean(website),
        layoutWarnings,
      },
      "Google Maps preview extracted",
    );

    return {
      url,
      resolvedUrl: page.url(),
      title,
      category,
      rating,
      reviewCount,
      priceLevel,
      hoursText,
      structuredHours: structuredHours ?? null,
      address,
      phone,
      website,
      snippet,
      fetchedAt: new Date().toISOString(),
      layoutWarnings,
    };
  } catch (err) {
    log.error(
      { err, url, attempt, pageUrl: page.url().slice(0, 200) },
      "Google Maps preview extraction failed",
    );
    throw err;
  } finally {
    await page.close().catch(() => undefined);
    // Fire-and-forget: persist cookies after each request. Debounced to ~1
    // I/O per 30s inside saveBrowserState(), so cheap.
    saveBrowserState().catch(() => undefined);
  }
}

export const googleMapsPlugin: MapScraperPlugin = {
  name: "google-maps",
  displayName: "Google Maps",

  validateUrl(url: string): string | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (
      !/^www\.google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(parsed.hostname) ||
      !parsed.pathname.startsWith("/maps/")
    ) {
      return null;
    }
    return parsed.toString();
  },

  async fetchOnce(url: string, attempt: number, deps: ScraperDeps): Promise<MapPreview | null> {
    return fetchGoogleMapsPreviewOnce(url, attempt, await deps.getBrowser(), deps);
  },

  minDelayMs: parseInt(process.env.GOOGLE_MAPS_MIN_DELAY_MS || "4000", 10),
  maxDelayMs: parseInt(process.env.GOOGLE_MAPS_MAX_DELAY_MS || "12000", 10),
  retries: parseInt(process.env.GOOGLE_MAPS_RETRIES || "3", 10),
  jobsTtlMs: parseInt(process.env.GOOGLE_MAPS_JOBS_TTL_MS || String(7 * 24 * 3600 * 1000), 10),
};
