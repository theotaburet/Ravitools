/**
 * Yandex Maps scraper — mirror of google-maps.ts for a second source.
 *
 * Strategy: open https://yandex.com/maps/?text={poiName}&ll={lon},{lat}&z=16
 * which lands on a search result list around the coordinates. We click the
 * first business card whose location is closest, then extract title / rating
 * / review count / hours / address / phone / website / category.
 *
 * Yandex coverage is strongest in CIS / EU / Turkey and weakest in NA / SA /
 * Asia outside Russia. The caller (client merger) is expected to gracefully
 * accept null returns.
 *
 * Like the Google scraper, this module owns ONLY page-level extraction. The
 * job system (queue, retry, persistence) lives in server/index.ts and is
 * mirrored from the Google one to keep behavior parallel.
 */

import type { Browser, Page } from "playwright";
import type { Logger } from "pino";
import { getBrowserContext, saveBrowserState } from "../browser-context.js";

// ---------------------------------------------------------------------------
// Public types — mirror GoogleMapsPreview shape so the client merger can treat
// both sources uniformly.
// ---------------------------------------------------------------------------

export type YandexMapsHoursEntry = { day: string; open: string; close: string | null };

export type YandexMapsPreview = {
  url: string;
  resolvedUrl: string | null;
  title: string | null;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  /** Yandex does not surface a $ price level in the public DOM — kept for symmetry, always null today. */
  priceLevel: number | null;
  hoursText: string | null;
  structuredHours: YandexMapsHoursEntry[] | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  snippet: string | null;
  fetchedAt: string;
};

export interface YandexMapsScraperDeps {
  log: Logger;
  sleep: (ms: number) => Promise<void>;
  randomDelay: (minMs: number, maxMs: number) => number;
}

/**
 * Optional HTTP/SOCKS proxy for Yandex Maps requests.
 * Set YANDEX_MAPS_PROXY_URL to e.g. "http://user:pass@proxy.example.com:8080".
 * Yandex aggressively rate-limits non-CIS IPs; a residential proxy in EU
 * typically returns better recall than direct cloud egress.
 */
export const YANDEX_MAPS_PROXY_URL = process.env.YANDEX_MAPS_PROXY_URL ?? null;

// ---------------------------------------------------------------------------
// URL builder
// ---------------------------------------------------------------------------

/**
 * Build a Yandex Maps search URL for a named POI near a coordinate.
 *
 * Format: https://yandex.com/maps/?text={poiName}&ll={lon},{lat}&z=16
 * (Yandex uses lon,lat order, opposite of Google.)
 *
 * Returns null if name is empty or coords invalid.
 */
export function buildYandexMapsUrl(poiName: string | null, lat: number | null, lon: number | null): string | null {
  if (!poiName || !poiName.trim()) return null;
  if (!Number.isFinite(lat ?? NaN) || !Number.isFinite(lon ?? NaN)) return null;
  if ((lat as number) < -90 || (lat as number) > 90) return null;
  if ((lon as number) < -180 || (lon as number) > 180) return null;
  const encoded = encodeURIComponent(poiName.trim());
  return `https://yandex.com/maps/?text=${encoded}&ll=${lon},${lat}&z=16`;
}

// ---------------------------------------------------------------------------
// Pure text helpers
// ---------------------------------------------------------------------------

export function parseYandexMapsText(text: string | null | undefined): string | null {
  if (!text) return null;
  const compact = text.replace(/\s+/g, " ").trim();
  return compact || null;
}

export function normalizeYandexMapsGlyphs(text: string | null): string | null {
  return text ? text.replace(/[]/g, " ").replace(/\s+/g, " ").trim() : null;
}

export function cleanYandexMapsPhone(phone: string | null): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/^[^+0-9]+/, "").trim();
  return cleaned || null;
}

export function cleanYandexMapsHours(hoursText: string | null): string | null {
  if (!hoursText) return null;
  const cleaned = normalizeYandexMapsGlyphs(hoursText);
  if (!cleaned || cleaned.length < 4) return null;
  if (!/(open|closed|открыто|закрыто|круглосуточно|\d{1,2}[:h]\d{2})/i.test(cleaned)) return null;
  return cleaned;
}

// ---------------------------------------------------------------------------
// Day & time normalization (covers EN, RU, TR, FR — the main Yandex locales)
// ---------------------------------------------------------------------------

const YANDEX_DAY_NORMALIZATIONS: Record<string, string> = {
  // English
  monday: "Mon", tuesday: "Tue", wednesday: "Wed", thursday: "Thu",
  friday: "Fri", saturday: "Sat", sunday: "Sun",
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
  // Russian (full + short)
  понедельник: "Mon", вторник: "Tue", среда: "Wed", четверг: "Thu",
  пятница: "Fri", суббота: "Sat", воскресенье: "Sun",
  пн: "Mon", вт: "Tue", ср: "Wed", чт: "Thu", пт: "Fri", сб: "Sat", вс: "Sun",
  // Turkish
  pazartesi: "Mon", salı: "Tue", çarşamba: "Wed", perşembe: "Thu",
  cuma: "Fri", cumartesi: "Sat", pazar: "Sun",
  // French (Yandex is sometimes localized in FR)
  lundi: "Mon", mardi: "Tue", mercredi: "Wed", jeudi: "Thu",
  vendredi: "Fri", samedi: "Sat", dimanche: "Sun",
};

export function normalizeYandexDay(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return YANDEX_DAY_NORMALIZATIONS[lower] ?? raw.trim();
}

export function normalizeYandexTimeString(raw: string): string {
  const s = raw.trim();
  // 24h format: "08:00", "20:00", "20.00"
  const match24 = s.match(/^(\d{1,2})[h:.](\d{2})$/i);
  if (match24) {
    const h = Number.parseInt(match24[1], 10);
    const m = match24[2];
    if (h >= 0 && h <= 23 && Number.parseInt(m, 10) <= 59) {
      return `${String(h).padStart(2, "0")}:${m}`;
    }
  }
  // 12h format (rare on Yandex but defensive)
  const match12 = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (match12) {
    let h = Number.parseInt(match12[1], 10);
    const m = match12[2];
    const meridiem = match12[3].toUpperCase();
    if (meridiem === "AM" && h === 12) h = 0;
    if (meridiem === "PM" && h !== 12) h += 12;
    return `${String(h).padStart(2, "0")}:${m}`;
  }
  return s;
}

export function parseYandexMapsHoursRow(row: string): YandexMapsHoursEntry | null {
  const s = normalizeYandexMapsGlyphs(row)?.trim();
  if (!s) return null;

  // Find first whitespace splitting the day from the time range
  const spaceIdx = s.search(/\s+/);
  if (spaceIdx === -1) return null;
  const dayRaw = s.slice(0, spaceIdx).trim();
  const timePart = s.slice(spaceIdx).trim();
  const day = normalizeYandexDay(dayRaw);

  // Closed markers in EN/RU/TR/FR
  if (/^(closed|выходной|закрыто|kapalı|fermé|ferme|cerrado)$/i.test(timePart)) {
    return { day, open: "closed", close: null };
  }

  // 24h markers
  if (/24\s*hours?|круглосуточно|24\s*saat|24\/7|24h/i.test(timePart)) {
    return { day, open: "00:00", close: "23:59" };
  }

  const sep = /\s*[–—\-]\s*/;
  const rangeParts = timePart.split(sep);
  if (rangeParts.length >= 2) {
    const openTime = normalizeYandexTimeString(rangeParts[0].trim());
    const closeTime = normalizeYandexTimeString(rangeParts[rangeParts.length - 1].trim());
    if (/^\d{2}:\d{2}$/.test(openTime) && /^\d{2}:\d{2}$/.test(closeTime)) {
      return { day, open: openTime, close: closeTime };
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Rating / review count extraction
// ---------------------------------------------------------------------------

/**
 * Yandex shows rating as e.g. "4,7" or "4.7" near a star icon. The badge
 * class is `business-rating-badge-view__rating-text` but we also look for
 * a generic numeric pattern in the local text window.
 */
export function extractYandexMapsRating(localText: string | null): number | null {
  if (!localText) return null;
  // Restrict to the first 800 chars to avoid catching rating numbers from
  // nearby places in the sidebar.
  const head = localText.slice(0, 800);
  const match = head.match(/\b([1-5][.,]\d)\b/);
  if (!match) return null;
  const value = Number.parseFloat(match[1].replace(",", "."));
  return Number.isFinite(value) && value >= 1 && value <= 5 ? value : null;
}

/**
 * Yandex shows review counts as e.g. "126 оценок", "126 reviews", "126 değerlendirme",
 * "126 avis". We normalize all common locale variants.
 */
export function extractYandexMapsReviewCount(localText: string | null): number | null {
  if (!localText) return null;
  const head = localText.slice(0, 1200);
  const match = head.match(/(\d[\d\s.,]*)\s+(?:reviews?|оценок|оценки|оценка|отзывов|отзыва|отзыв|değerlendirme|yorum|avis)/i);
  if (!match) return null;
  const normalized = match[1].replace(/[\s., ]/g, "");
  const value = Number.parseInt(normalized, 10);
  return Number.isFinite(value) ? value : null;
}

export function extractYandexMapsCategory(localText: string | null): string | null {
  if (!localText) return null;
  // Category often appears right after the title in compact text:
  // "Café · 4,7 (123 reviews)" or "Кафе · 4,7"
  const match = localText.match(/^([^·\n]{3,60})\s*·\s*[\d.,]/);
  return normalizeYandexMapsGlyphs(parseYandexMapsText(match?.[1] ?? null));
}

// ---------------------------------------------------------------------------
// Playwright-backed extraction helpers
// ---------------------------------------------------------------------------

export async function extractYandexTextBySelectors(page: Page, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    const value = parseYandexMapsText(
      await page.locator(selector).first().innerText({ timeout: 1_500 }).catch(() => ""),
    );
    if (value) return value;
  }
  return null;
}

/**
 * Yandex search URL lands on a left-side list of business cards. Click the
 * first one to open the place panel. Returns true if a card was clicked.
 */
export async function clickFirstYandexResult(page: Page, log: Logger): Promise<boolean> {
  const selectors = [
    'li.search-snippet-view__list-item',
    'div.search-business-snippet-view',
    'div.search-snippet-view',
    '[data-id="card"]',
  ];
  for (const selector of selectors) {
    const card = page.locator(selector).first();
    if (await card.count()) {
      log.info({ selector }, "Yandex Maps: clicking first business card");
      await card.click({ timeout: 5_000 }).catch(() => undefined);
      await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => undefined);
      return true;
    }
  }
  return false;
}

/**
 * Detect Yandex CAPTCHA: either the URL contains "showcaptcha" or the body
 * text matches a known phrase in EN/RU.
 */
export function isYandexCaptcha(pageUrl: string, bodyText: string | null): boolean {
  if (/showcaptcha|smartcaptcha/i.test(pageUrl)) return true;
  if (!bodyText) return false;
  return /(are you a robot|подтвердите.+не робот|captcha|smartcaptcha)/i.test(bodyText);
}

/**
 * Extract structured opening hours from the Yandex hours panel. Yandex shows
 * hours either inline (one row per day) or in a collapsed widget that needs
 * a hover/click to expand. Returns null if extraction fails.
 */
export async function extractExpandedYandexHours(
  page: Page,
  deps: YandexMapsScraperDeps,
): Promise<YandexMapsHoursEntry[] | null> {
  const { log, sleep } = deps;

  // Try to expand collapsed hours widget
  const expandSelectors = [
    'div.business-working-status-view button',
    'div.business-working-status-view',
    'div[class*="hours"] button[aria-expanded="false"]',
  ];
  for (const selector of expandSelectors) {
    const locator = page.locator(selector).first();
    if (!(await locator.count())) continue;
    await locator.hover({ timeout: 2_000 }).catch(() => undefined);
    await locator.click({ timeout: 3_000 }).catch(() => undefined);
    await sleep(600);
    break;
  }

  const rowSelectors = [
    'table.business-working-intervals-view tr',
    'div.business-working-intervals-view__weekday',
    'ul[class*="working-hours"] li',
    'div[class*="working-intervals"] [class*="day"]',
  ];

  for (const selector of rowSelectors) {
    const rows = page.locator(selector);
    const count = await rows.count();
    if (count < 2) continue;

    const entries: YandexMapsHoursEntry[] = [];
    for (let i = 0; i < Math.min(count, 7); i++) {
      const rowText = await rows.nth(i).innerText({ timeout: 1_500 }).catch(() => "");
      const parsed = parseYandexMapsHoursRow(rowText);
      if (parsed) entries.push(parsed);
    }
    if (entries.length >= 2) {
      log.info({ selector, count, parsed: entries.length }, "Yandex Maps: structured hours extracted");
      return entries;
    }
  }

  // Fallback: parse body text for day-labelled lines
  const bodyText = normalizeYandexMapsGlyphs(
    await page.locator("body").innerText({ timeout: 3_000 }).catch(() => ""),
  );
  if (!bodyText) return null;

  const dayPattern = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Понедельник|Вторник|Среда|Четверг|Пятница|Суббота|Воскресенье|Pazartesi|Salı|Çarşamba|Perşembe|Cuma|Cumartesi|Pazar|Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche)\s+.+/im;
  const lines = bodyText.split("\n").map((l) => l.trim()).filter(Boolean);
  const entries: YandexMapsHoursEntry[] = [];
  let inBlock = false;
  let consecutiveMisses = 0;

  for (const line of lines) {
    const parsed = dayPattern.test(line) ? parseYandexMapsHoursRow(line) : null;
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
    log.info({ parsed: entries.length }, "Yandex Maps: structured hours extracted from body fallback");
    return entries;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main extraction entry point
// ---------------------------------------------------------------------------

/**
 * Fetch a single Yandex Maps preview for the given URL.
 *
 * The URL must already be a yandex.com/maps URL (typically built via
 * buildYandexMapsUrl). Uses the shared BrowserContext so cookies persist.
 * Returns null when blocked by CAPTCHA or when no business card matches.
 */
export async function fetchYandexMapsPreviewOnce(
  url: string,
  attempt: number,
  browser: Browser,
  deps: YandexMapsScraperDeps,
): Promise<YandexMapsPreview | null> {
  const { log, sleep, randomDelay } = deps;
  const context = await getBrowserContext(browser);
  const page = await context.newPage();

  try {
    log.info({ url, attempt }, "Yandex Maps preview: opening page");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await sleep(randomDelay(1_000, 3_000));

    const initialBody = parseYandexMapsText(
      await page.locator("body").innerText({ timeout: 5_000 }).catch(() => ""),
    );
    if (isYandexCaptcha(page.url(), initialBody)) {
      log.warn({ url, attempt, pageUrl: page.url() }, "Yandex Maps preview blocked by CAPTCHA");
      return null;
    }

    // Search URL lands on a list of cards — click the first one to open the
    // place panel. If the URL is already a /maps/org/ direct link, this is a
    // no-op (no cards present).
    const clicked = await clickFirstYandexResult(page, log);
    if (clicked) await sleep(randomDelay(1_500, 3_500));

    const title = await extractYandexTextBySelectors(page, [
      'h1.card-title-view__title',
      'h1.orgpage-header-view__header',
      'h1[class*="title"]',
      'h1',
    ]) ?? parseYandexMapsText(await page.title());

    const bodyText = normalizeYandexMapsGlyphs(
      parseYandexMapsText(await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "")),
    );
    const localText = bodyText?.slice(0, 1500) ?? null;
    const snippet = bodyText?.slice(0, 1200) ?? null;

    const rating = (() => {
      // Try DOM badge first, then fallback to text scan
      return extractYandexMapsRating(localText);
    })();
    const reviewCount = extractYandexMapsReviewCount(localText);

    const ratingFromDom = parseYandexMapsText(
      await page.locator('span.business-rating-badge-view__rating-text, [class*="rating-badge"] [class*="text"]')
        .first().innerText({ timeout: 1_500 }).catch(() => ""),
    );
    const ratingResolved = (() => {
      if (rating != null) return rating;
      if (!ratingFromDom) return null;
      const m = ratingFromDom.match(/([1-5][.,]\d)/);
      if (!m) return null;
      const v = Number.parseFloat(m[1].replace(",", "."));
      return Number.isFinite(v) && v >= 1 && v <= 5 ? v : null;
    })();

    const structuredHours = await extractExpandedYandexHours(page, deps).catch((err) => {
      log.warn({ err }, "Yandex Maps: structured hours extraction failed");
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
      hoursText = await extractYandexTextBySelectors(page, [
        'div.business-working-status-view',
        'span[class*="working-status"]',
        'div[class*="working-hours"]',
      ]);
      hoursText = cleanYandexMapsHours(hoursText);
    }

    const phone = cleanYandexMapsPhone(
      await extractYandexTextBySelectors(page, [
        'div.card-phones-view__phone-number',
        'a[href^="tel:"]',
        'div[class*="phones"] [class*="number"]',
      ]) ?? parseYandexMapsText(bodyText?.match(/\+?\d[\d\s().-]{6,}/)?.[0] ?? null),
    );

    const website = (await page.locator('a.business-urls-view__link, a[class*="website"], a[class*="url"]').first().getAttribute("href").catch(() => null))
      ?? null;

    const address = normalizeYandexMapsGlyphs(
      await extractYandexTextBySelectors(page, [
        'a.business-contacts-view__address-link',
        'div.business-contacts-view__address',
        'div[class*="address"] span',
      ]),
    );

    const category = await extractYandexTextBySelectors(page, [
      'div.business-card-title-view__categories',
      'a.business-card-title-view__category',
      'div[class*="categories"]',
    ]) ?? extractYandexMapsCategory(localText);

    // If we got nothing useful at all, return null so the caller can skip.
    if (!title && !ratingResolved && !reviewCount && !hoursText && !address && !phone && !website) {
      log.warn({ url, attempt, pageUrl: page.url() }, "Yandex Maps preview: no usable data extracted");
      return null;
    }

    log.info({
      url,
      pageUrl: page.url(),
      title,
      category,
      rating: ratingResolved,
      reviewCount,
      hasHours: Boolean(hoursText),
      hasAddress: Boolean(address),
      hasPhone: Boolean(phone),
      hasWebsite: Boolean(website),
    }, "Yandex Maps preview extracted");

    return {
      url,
      resolvedUrl: page.url(),
      title,
      category,
      rating: ratingResolved,
      reviewCount,
      priceLevel: null,
      hoursText,
      structuredHours: structuredHours ?? null,
      address,
      phone,
      website,
      snippet,
      fetchedAt: new Date().toISOString(),
    };
  } catch (err) {
    log.error({ err, url, attempt, pageUrl: page.url().slice(0, 200) }, "Yandex Maps preview extraction failed");
    throw err;
  } finally {
    await page.close().catch(() => undefined);
    saveBrowserState().catch(() => undefined);
  }
}

// ---------------------------------------------------------------------------
// Plugin export — wires this scraper into the generic plugin system.
// See web/server/src/scrapers/types.ts for the contract.
// ---------------------------------------------------------------------------

import type { MapScraperPlugin, ScraperDeps } from "./types.js";

export const yandexMapsPlugin: MapScraperPlugin<YandexMapsPreview> = {
  name: "yandex-maps",
  displayName: "Yandex Maps",

  validateUrl(url: string): string | null {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return null;
    }
    if (
      !/^(www\.)?yandex\.[a-z]{2,3}$/.test(parsed.hostname) ||
      !parsed.pathname.startsWith("/maps")
    ) {
      return null;
    }
    return parsed.toString();
  },

  buildUrl(poiName, lat, lon): string | null {
    return buildYandexMapsUrl(poiName, lat, lon);
  },

  async fetchOnce(url: string, attempt: number, deps: ScraperDeps): Promise<YandexMapsPreview | null> {
    const browser = await deps.getBrowser();
    return fetchYandexMapsPreviewOnce(url, attempt, browser, {
      log: deps.log,
      sleep: deps.sleep,
      randomDelay: deps.randomDelay,
    });
  },

  minDelayMs: parseInt(process.env.YANDEX_MAPS_MIN_DELAY_MS || "4000", 10),
  maxDelayMs: parseInt(process.env.YANDEX_MAPS_MAX_DELAY_MS || "12000", 10),
  retries: parseInt(process.env.YANDEX_MAPS_RETRIES || "3", 10),
  previewCacheTtlSec: 60 * 60 * 24 * 14, // 14 days
  jobsTtlMs: parseInt(process.env.YANDEX_MAPS_JOBS_TTL_MS || String(7 * 24 * 3600 * 1000), 10),
};
