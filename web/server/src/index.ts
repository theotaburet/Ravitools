import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import rateLimit from "express-rate-limit";
import NodeCache from "node-cache";
import pino from "pino";
import { chromium, type Browser } from "playwright";
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { lookup } from "node:dns/promises";

// ---------------------------------------------------------------------------
// SSRF guard — block requests to private/internal IPs
// ---------------------------------------------------------------------------
const PRIVATE_IP_RANGES = [
  /^127\./,                          // loopback
  /^10\./,                           // RFC 1918
  /^172\.(1[6-9]|2\d|3[01])\./,     // RFC 1918
  /^192\.168\./,                     // RFC 1918
  /^169\.254\./,                     // link-local
  /^0\./,                            // "this" network
  /^::1$/,                           // IPv6 loopback
  /^fe80:/i,                         // IPv6 link-local
  /^fc00:/i,                         // IPv6 ULA
  /^fd/i,                            // IPv6 ULA
];

function isPrivateIp(ip: string): boolean {
  return PRIVATE_IP_RANGES.some((re) => re.test(ip));
}

async function assertPublicHostname(hostname: string): Promise<void> {
  // Resolve to IP first to prevent DNS rebinding
  const { address } = await lookup(hostname);
  if (isPrivateIp(address)) {
    throw new Error(`Blocked request to private IP ${address} (hostname: ${hostname})`);
  }
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT || "3001", 10);
const OVERPASS_URL =
  process.env.OVERPASS_URL || "https://overpass-api.de/api/interpreter";
const OVERPASS_FALLBACK_URL =
  process.env.OVERPASS_FALLBACK_URL || "https://overpass.kumi.systems/api/interpreter";
const SEARXNG_URL =
  process.env.SEARXNG_URL || "http://localhost:8888";
const NOMINATIM_URL =
  process.env.NOMINATIM_URL || "https://nominatim.openstreetmap.org";
const CACHE_TTL = parseInt(process.env.CACHE_TTL || "86400", 10); // 24h default
const SEARCH_CACHE_TTL = parseInt(process.env.SEARCH_CACHE_TTL || "604800", 10); // 7 days
const GEOCODE_CACHE_TTL = parseInt(process.env.GEOCODE_CACHE_TTL || "2592000", 10); // 30 days
const MAX_QUERY_LENGTH = parseInt(
  process.env.MAX_QUERY_LENGTH || "32000",
  10,
);
const RATE_LIMIT_WINDOW_MS = parseInt(
  process.env.RATE_LIMIT_WINDOW_MS || "60000",
  10,
);
const RATE_LIMIT_MAX = parseInt(process.env.RATE_LIMIT_MAX || "60", 10);

// Google Maps rate controls (configurable via env)
const GOOGLE_MAPS_JOBS_TTL_MS = parseInt(process.env.GOOGLE_MAPS_JOBS_TTL_MS || String(7 * 24 * 3600 * 1000), 10); // 7 days

const log = pino({
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty" }
      : undefined,
});

type WebsiteStructuredData = {
  description: string | null;
  telephone: string | null;
  priceRange: string | null;
  openingHours: string[];
  rating: number | null;
  reviewCount: number | null;
};

type GoogleMapsPreview = {
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
  structuredHours: { day: string; open: string; close: string | null }[] | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  snippet: string | null;
  fetchedAt: string;
};

type GoogleMapsPreviewJob = {
  jobId: string;
  status: "queued" | "running" | "done" | "error";
  url: string;
  /** Human-readable POI name for UI display (extracted from URL or set at queue time) */
  poiName: string | null;
  preview: GoogleMapsPreview | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  /** ISO timestamp when the job actually started running */
  startedAt: string | null;
  /** Current attempt number (1-based) */
  attempt: number;
  /** ISO timestamp of next scheduled retry (null if not waiting for retry) */
  nextRetryAt: string | null;
  /** Last extraction error message before final failure or current attempt error */
  lastError: string | null;
};

let browserPromise: Promise<Browser> | null = null;
let googleMapsQueue: Promise<unknown> = Promise.resolve();

const GOOGLE_MAPS_MIN_DELAY_MS = parseInt(process.env.GOOGLE_MAPS_MIN_DELAY_MS || "4000", 10);
const GOOGLE_MAPS_MAX_DELAY_MS = parseInt(process.env.GOOGLE_MAPS_MAX_DELAY_MS || "12000", 10);
const GOOGLE_MAPS_RETRIES = parseInt(process.env.GOOGLE_MAPS_RETRIES || "3", 10);

const GOOGLE_MAPS_USER_AGENTS = [
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
];

const GOOGLE_MAPS_LOCALES = ["fr-FR", "en-US", "es-ES"] as const;
const GOOGLE_MAPS_JOBS_FILE = join(process.cwd(), ".cache", "google-maps-jobs.json");
/**
 * Append-only JSONL file for failed Google Maps extractions.
 * Each line is a self-contained JSON record: url, poiName, attempts, lastError, failedAt.
 * Useful for debugging extraction failures without noise in normal logs.
 * Grows unbounded — rotate/truncate manually if needed (not critical for dev use).
 */
const GOOGLE_MAPS_FAILURES_FILE = join(process.cwd(), ".cache", "google-maps-failures.jsonl");

type GoogleMapsFailureRecord = {
  url: string;
  poiName: string | null;
  attempts: number;
  lastError: string | null;
  failedAt: string;
};

function appendGoogleMapsFailure(record: GoogleMapsFailureRecord): void {
  try {
    const dir = dirname(GOOGLE_MAPS_FAILURES_FILE);
    mkdirSync(dir, { recursive: true });
    const line = JSON.stringify(record) + "\n";
    appendFileSync(GOOGLE_MAPS_FAILURES_FILE, line, { encoding: "utf8" });
    log.debug({ url: record.url, attempts: record.attempts, lastError: record.lastError }, "Google Maps: failure record appended");
  } catch (err) {
    log.warn({ err }, "Google Maps: failed to append failure record");
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomDelay(minMs: number, maxMs: number): number {
  return Math.floor(minMs + Math.random() * (maxMs - minMs));
}

function randomItem<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function pruneStaleGoogleMapsJobs(): void {
  const cutoff = Date.now() - GOOGLE_MAPS_JOBS_TTL_MS;
  for (const key of googleMapsJobCache.keys()) {
    const job = googleMapsJobCache.get<GoogleMapsPreviewJob>(key);
    if (!job) continue;
    const age = new Date(job.updatedAt).getTime();
    // Only prune terminal jobs (done/error) that are older than the TTL
    if ((job.status === "done" || job.status === "error") && age < cutoff) {
      googleMapsJobCache.del(key);
      log.debug({ jobId: job.jobId, age: Date.now() - age }, "Google Maps: pruned stale job");
    }
  }
}

function persistGoogleMapsJobs(): void {
  pruneStaleGoogleMapsJobs();
  const dir = dirname(GOOGLE_MAPS_JOBS_FILE);
  mkdirSync(dir, { recursive: true });
  const entries = googleMapsJobCache.keys()
    .map((key) => googleMapsJobCache.get<GoogleMapsPreviewJob>(key))
    .filter((job): job is GoogleMapsPreviewJob => Boolean(job));
  const tmpFile = `${GOOGLE_MAPS_JOBS_FILE}.tmp`;
  try {
    writeFileSync(tmpFile, JSON.stringify(entries, null, 2), { encoding: "utf8", flag: "w" });
    renameSync(tmpFile, GOOGLE_MAPS_JOBS_FILE);
  } catch (err) {
    log.warn({ err }, "Google Maps: failed to persist jobs (atomic write failed)");
    try { unlinkSync(tmpFile); } catch { /* ignore */ }
  }
}

function loadPersistedGoogleMapsJobs(): void {
  if (!existsSync(GOOGLE_MAPS_JOBS_FILE)) return;
  try {
    const raw = readFileSync(GOOGLE_MAPS_JOBS_FILE, "utf8");
    const jobs = JSON.parse(raw) as GoogleMapsPreviewJob[];
    const cutoff = Date.now() - GOOGLE_MAPS_JOBS_TTL_MS;
    let recovered = 0;
    let skipped = 0;
    for (const job of jobs) {
      // Skip jobs older than TTL (stale pruning on load)
      if ((job.status === "done" || job.status === "error") && new Date(job.updatedAt).getTime() < cutoff) {
        skipped++;
        continue;
      }
      // Jobs that were "running" at shutdown were interrupted — mark as error
      const recoveredStatus = job.status === "running" ? "error" : job.status;
      const recoveredError = job.status === "running"
        ? "Job interrupted by server restart"
        : job.error;
      googleMapsJobCache.set(job.jobId, {
        ...job,
        status: recoveredStatus,
        error: recoveredError,
        lastError: job.status === "running" ? "Job interrupted by server restart" : job.lastError,
        updatedAt: job.status === "running" ? new Date().toISOString() : job.updatedAt,
      });
      recovered++;
    }
    log.info({ recovered, skipped }, "Google Maps: restored jobs from disk");
  } catch (err) {
    log.warn({ err }, "Failed to restore Google Maps jobs from disk");
  }
}

async function withGoogleMapsQueue<T>(task: () => Promise<T>): Promise<T> {
  const run = googleMapsQueue.then(task, task);
  googleMapsQueue = run.then(() => undefined, () => undefined);
  return run;
}

function parseJsonLdBlocks(html: string): unknown[] {
  const blocks: unknown[] = [];
  const matches = html.matchAll(/<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const match of matches) {
    const raw = match[1]?.trim();
    if (!raw) continue;
    try {
      blocks.push(JSON.parse(raw));
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  }
  return blocks;
}

function flattenJsonLd(node: unknown): Record<string, unknown>[] {
  if (!node || typeof node !== "object") return [];
  if (Array.isArray(node)) return node.flatMap(flattenJsonLd);

  const record = node as Record<string, unknown>;
  const nested = [
    ...(Array.isArray(record["@graph"]) ? flattenJsonLd(record["@graph"]) : []),
    ...(Array.isArray(record.mainEntity) ? flattenJsonLd(record.mainEntity) : flattenJsonLd(record.mainEntity)),
  ];
  return [record, ...nested];
}

function firstString(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.replace(/\s+/g, " ").trim();
    return trimmed || null;
  }
  return null;
}

function firstNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value.replace(",", "."));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeOpeningHours(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map(firstString).filter((item): item is string => Boolean(item));
  }
  const single = firstString(value);
  return single ? [single] : [];
}

function extractStructuredDataFromHtml(html: string): WebsiteStructuredData | null {
  const nodes = parseJsonLdBlocks(html).flatMap(flattenJsonLd);
  const aggregateRatings = nodes
    .map((node) => (node.aggregateRating && typeof node.aggregateRating === "object" ? node.aggregateRating as Record<string, unknown> : null))
    .filter((item): item is Record<string, unknown> => Boolean(item));

  const description = nodes.map((node) => firstString(node.description)).find(Boolean) ?? null;
  const telephone = nodes.map((node) => firstString(node.telephone)).find(Boolean) ?? null;
  const priceRange = nodes.map((node) => firstString(node.priceRange)).find(Boolean) ?? null;
  const openingHours = nodes.flatMap((node) => normalizeOpeningHours(node.openingHours));
  const rating = aggregateRatings.map((item) => firstNumber(item.ratingValue)).find((item) => item != null) ?? null;
  const reviewCount = aggregateRatings
    .map((item) => firstNumber(item.reviewCount) ?? firstNumber(item.ratingCount))
    .find((item) => item != null) ?? null;

  if (!description && !telephone && !priceRange && openingHours.length === 0 && rating == null && reviewCount == null) {
    return null;
  }

  return {
    description,
    telephone,
    priceRange,
    openingHours: [...new Set(openingHours)],
    rating,
    reviewCount,
  };
}

function parseGoogleMapsText(text: string | null | undefined): string | null {
  if (!text) return null;
  const compact = text.replace(/\s+/g, " ").trim();
  return compact || null;
}

function extractPriceLevelFromText(text: string | null): number | null {
  if (!text) return null;
  const match = text.match(/([$€£])\1{0,3}/);
  if (!match) return null;
  return Math.min(match[0].length, 4);
}

function normalizeGoogleMapsGlyphs(text: string | null): string | null {
  return text ? text.replace(/[]/g, " ").replace(/\s+/g, " ").trim() : null;
}

function extractLocalGoogleMapsWindow(bodyText: string | null, title: string | null): string | null {
  if (!bodyText) return null;
  if (!title) return bodyText.slice(0, 800);
  const cleanTitle = title.replace(/\s*-\s*Google Maps$/i, "").trim();
  const idx = bodyText.toLowerCase().indexOf(cleanTitle.toLowerCase());
  if (idx === -1) return bodyText.slice(0, 800);
  return bodyText.slice(idx, idx + 900);
}

function extractGoogleMapsCategory(localText: string | null): string | null {
  if (!localText) return null;
  const starCategory = localText.match(/\(\d[\d\s., ]*\)\s*·\s*([^·]{3,60})\s*·/i);
  if (starCategory?.[1]) {
    return normalizeGoogleMapsGlyphs(parseGoogleMapsText(starCategory[1]));
  }
  const match = localText.match(/\d(?:[.,]\d)\s*(?:\(([\d\s., ]+)\))?\s*([^·]{3,60}?)(?:·\s*)?(?:Présentation|Overview|Prix|About|À propos|Directions|Itinéraires)/i)
    ?? localText.match(/\d(?:[.,]\d)\s+([^·]{3,60}?)(?:Présentation|Overview|Prix|About|À propos|Directions|Itinéraires)/i);
  return normalizeGoogleMapsGlyphs(parseGoogleMapsText(match?.[2] ?? match?.[1] ?? null));
}

function cleanGoogleMapsPhone(phone: string | null): string | null {
  if (!phone) return null;
  const cleaned = phone.replace(/^[^+0-9]+/, "").trim();
  return cleaned || null;
}

function cleanGoogleMapsHours(hoursText: string | null): string | null {
  if (!hoursText) return null;
  const cleaned = normalizeGoogleMapsGlyphs(hoursText);
  if (!cleaned || cleaned.length < 4) return null;
  if (!/(open|closed|ouvre|fermé|ferme|\d{1,2}[:h]\d{2})/i.test(cleaned)) return null;
  return cleaned;
}

// ---------------------------------------------------------------------------
// Google Maps expanded hours panel extraction
// ---------------------------------------------------------------------------

/**
 * Day name normalisations for English and French Google Maps.
 * Maps the displayed day label to a canonical short form.
 */
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

function normalizeDay(raw: string): string {
  const lower = raw.trim().toLowerCase();
  return DAY_NORMALIZATIONS[lower] ?? raw.trim();
}

/**
 * Parse a single Google Maps time string like "8:00 AM", "20h00", "08:00"
 * into 24h "HH:MM" format. Returns the original string if unparseable.
 */
function normalizeTimeString(raw: string): string {
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

/**
 * Parse a raw hours row text like "Monday 8:00 AM – 9:00 PM" or "Tuesday Closed"
 * into a structured {day, open, close} entry.
 * Returns null when the row cannot be confidently parsed.
 */
function parseGoogleMapsHoursRow(row: string): { day: string; open: string; close: string | null } | null {
  const s = normalizeGoogleMapsGlyphs(row)?.trim();
  if (!s) return null;

  // Split on first whitespace cluster to isolate day vs time part
  const spaceIdx = s.search(/\s+/);
  if (spaceIdx === -1) return null;
  const dayRaw = s.slice(0, spaceIdx).trim();
  const timePart = s.slice(spaceIdx).trim();
  const day = normalizeDay(dayRaw);

  // Closed / Fermé / Cerrado
  if (/^(closed|fermé|ferme|cerrado|geschlossen|chiuso|closed all day)$/i.test(timePart)) {
    return { day, open: "closed", close: null };
  }

  // Time range: "8:00 AM – 9:00 PM" or "08:00 - 20:00" or "8h00–20h00"
  const sep = /\s*[–—\-]\s*/;
  const rangeParts = timePart.split(sep);
  if (rangeParts.length >= 2) {
    const openTime = normalizeTimeString(rangeParts[0].trim());
    const closeTime = normalizeTimeString(rangeParts[rangeParts.length - 1].trim());
    if (/^\d{2}:\d{2}$/.test(openTime) && /^\d{2}:\d{2}$/.test(closeTime)) {
      return { day, open: openTime, close: closeTime };
    }
  }

  // Open 24 hours
  if (/24\s*hours?|open 24|ouvert 24/i.test(timePart)) {
    return { day, open: "00:00", close: "23:59" };
  }

  // Could not parse — return null to avoid noise
  return null;
}

/**
 * Attempt to click the collapsed hours button to open the expanded panel,
 * then extract structured opening hours row by row.
 *
 * Strategy:
 * 1. Click the "Open/Closed" summary button to trigger the panel
 * 2. Wait for the table to appear
 * 3. Extract each day row from `tr` elements or aria-labelled rows
 *
 * Returns null if the panel is not available or extraction fails.
 */
async function extractExpandedGoogleMapsHours(
  page: import("playwright").Page,
): Promise<{ day: string; open: string; close: string | null }[] | null> {
  // Selectors for the collapsed hours summary button (triggers expansion)
  const expandSelectors = [
    'button[aria-label*="Open"]',
    'button[aria-label*="Closed"]',
    'button[aria-label*="Ouvre"]',
    'button[aria-label*="Ferme"]',
    'button[aria-label*="hours"]',
    'button[aria-label*="horaires"]',
    // Generic: button with class used for the hours section
    'div[data-section-id="oh"] button',
    'button[jsaction*="openhours"]',
  ];

  // Try to click the expand button
  for (const selector of expandSelectors) {
    const locator = page.locator(selector).first();
    if (!await locator.count()) continue;
    await locator.click({ timeout: 3_000 }).catch(() => undefined);
    await sleep(800);
    break;
  }

  // Selectors for the expanded hours rows (after panel opens)
  // Google Maps renders days in a table: td or li with day + time
  const rowSelectors = [
    // Structured table rows in the hours panel
    'table.WgFkxc tr',
    'table[aria-label*="hours"] tr',
    'table[aria-label*="horaires"] tr',
    // Older DOM: div rows
    'div[aria-label*="hours"] li',
    'div.t39EBf.GUrTXd',
    // Fallback: any tr in a section labeled "hours"
    'tr[class*="hours"]',
  ];

  for (const selector of rowSelectors) {
    const rows = page.locator(selector);
    const count = await rows.count();
    if (count < 2) continue; // need at least 2 rows to trust the panel

    const entries: { day: string; open: string; close: string | null }[] = [];
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

  // Fallback: try to parse the body text for day-labelled lines
  const bodyText = normalizeGoogleMapsGlyphs(
    await page.locator("body").innerText({ timeout: 3_000 }).catch(() => ""),
  );
  if (!bodyText) return null;

  // Look for a block of consecutive day lines (7 lines max)
  const dayPattern = /^(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Lundi|Mardi|Mercredi|Jeudi|Vendredi|Samedi|Dimanche)\s+.+/im;
  const lines = bodyText.split("\n").map((l) => l.trim()).filter(Boolean);
  const entries: { day: string; open: string; close: string | null }[] = [];
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

function extractGoogleMapsReviewCount(localText: string | null): number | null {
  if (!localText) return null;
  const firstSection = localText.split(/Hôtels similaires|Nearby hotels|À proximité/i)[0] ?? localText;
  const match = firstSection.match(/\((\d[\d\s., ]*)\)/) ?? firstSection.match(/(\d[\d\s., ]*)\s+(?:reviews?|avis)/i);
  if (!match) return null;
  const normalized = match[1].replace(/[\s., ]/g, "");
  const value = Number.parseInt(normalized, 10);
  return Number.isFinite(value) ? value : null;
}

function extractGoogleMapsRating(localText: string | null): number | null {
  if (!localText) return null;
  // Truncate before sections that list nearby/similar businesses to avoid contamination
  const firstSection = localText.split(/Hôtels similaires|Nearby hotels?|Similar places|À proximité|Nearby places/i)[0] ?? localText;
  const match = firstSection.match(/\b(\d(?:[.,]\d))\b/);
  if (!match) return null;
  const value = Number.parseFloat(match[1].replace(",", "."));
  return Number.isFinite(value) && value >= 1 && value <= 5 ? value : null;
}

async function clickFirstGoogleMapsResult(page: import("playwright").Page): Promise<void> {
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

async function extractTextBySelectors(page: import("playwright").Page, selectors: string[]): Promise<string | null> {
  for (const selector of selectors) {
    const value = parseGoogleMapsText(await page.locator(selector).first().innerText({ timeout: 1_500 }).catch(() => ""));
    if (value) return value;
  }
  return null;
}

async function acceptGoogleConsentIfPresent(page: import("playwright").Page): Promise<void> {
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
 * Optional HTTP/SOCKS proxy for Google Maps requests.
 * Set GOOGLE_MAPS_PROXY_URL to e.g. "http://user:pass@proxy.example.com:8080"
 * or "socks5://user:pass@proxy.example.com:1080".
 * When unset, no proxy is used (direct connection, default behaviour).
 * The proxy is passed directly to Playwright — no vendor SDK required.
 */
const GOOGLE_MAPS_PROXY_URL = process.env.GOOGLE_MAPS_PROXY_URL ?? null;

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    const launchOptions: Parameters<typeof chromium.launch>[0] = { headless: true };
    if (GOOGLE_MAPS_PROXY_URL) {
      launchOptions.proxy = { server: GOOGLE_MAPS_PROXY_URL };
      log.info({ proxy: GOOGLE_MAPS_PROXY_URL }, "Google Maps browser: using proxy");
    }
    browserPromise = chromium.launch(launchOptions);
  }
  return browserPromise;
}

async function fetchGoogleMapsPreview(
  url: string,
  onAttemptUpdate?: (attempt: number, nextRetryAt: string | null, lastError: string | null) => void,
): Promise<GoogleMapsPreview | null> {
  return withGoogleMapsQueue(async () => {
    for (let attempt = 1; attempt <= GOOGLE_MAPS_RETRIES; attempt++) {
      const initialDelay = randomDelay(GOOGLE_MAPS_MIN_DELAY_MS, GOOGLE_MAPS_MAX_DELAY_MS);
      log.info({ url, attempt, initialDelay }, "Google Maps preview: waiting before attempt");
      onAttemptUpdate?.(attempt, null, null);
      await sleep(initialDelay);

      let lastError: string | null = null;
      const result = await fetchGoogleMapsPreviewOnce(url, attempt).catch((err) => {
        lastError = err instanceof Error ? err.message : String(err);
        log.warn({ err, url, attempt }, "Google Maps preview attempt failed");
        return null;
      });

      if (result) return result;

      if (attempt < GOOGLE_MAPS_RETRIES) {
        const retryDelay = randomDelay(8_000 * attempt, 20_000 * attempt);
        const nextRetryAt = new Date(Date.now() + retryDelay).toISOString();
        log.warn({ url, attempt, retryDelay, nextRetryAt }, "Google Maps preview: backing off before retry");
        onAttemptUpdate?.(attempt, nextRetryAt, lastError);
        await sleep(retryDelay);
      } else {
        onAttemptUpdate?.(attempt, null, lastError);
      }
    }

    return null;
  });
}

async function queueGoogleMapsPreviewJob(url: string, poiName?: string | null): Promise<GoogleMapsPreviewJob> {
  const crypto = await import("crypto");
  const jobId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const job: GoogleMapsPreviewJob = {
    jobId,
    status: "queued",
    url,
    poiName: poiName ?? null,
    preview: null,
    error: null,
    createdAt,
    updatedAt: createdAt,
    startedAt: null,
    attempt: 0,
    nextRetryAt: null,
    lastError: null,
  };
  googleMapsJobCache.set(jobId, job);
  persistGoogleMapsJobs();

  void (async () => {
    const startedAt = new Date().toISOString();
    const runningJob: GoogleMapsPreviewJob = {
      ...job,
      status: "running",
      startedAt,
      attempt: 1,
      updatedAt: startedAt,
    };
    googleMapsJobCache.set(jobId, runningJob);
    persistGoogleMapsJobs();

    const onAttemptUpdate = (attempt: number, nextRetryAt: string | null, lastError: string | null) => {
      const current = googleMapsJobCache.get<GoogleMapsPreviewJob>(jobId);
      if (!current) return;
      googleMapsJobCache.set(jobId, {
        ...current,
        attempt,
        nextRetryAt,
        lastError: lastError ?? current.lastError,
        updatedAt: new Date().toISOString(),
      });
      persistGoogleMapsJobs();
    };

    try {
      const preview = await fetchGoogleMapsPreview(url, onAttemptUpdate);
      const current = googleMapsJobCache.get<GoogleMapsPreviewJob>(jobId) ?? runningJob;
      if (!preview) {
        appendGoogleMapsFailure({
          url,
          poiName: poiName ?? null,
          attempts: current.attempt,
          lastError: current.lastError ?? "no data returned",
          failedAt: new Date().toISOString(),
        });
      }
      googleMapsJobCache.set(jobId, {
        ...current,
        status: preview ? "done" : "error",
        preview,
        error: preview ? null : "Google Maps preview returned no data",
        nextRetryAt: null,
        updatedAt: new Date().toISOString(),
      });
      persistGoogleMapsJobs();
    } catch (err) {
      const current = googleMapsJobCache.get<GoogleMapsPreviewJob>(jobId) ?? runningJob;
      const message = err instanceof Error ? err.message : "Unknown Google Maps error";
      appendGoogleMapsFailure({
        url,
        poiName: poiName ?? null,
        attempts: current.attempt,
        lastError: message,
        failedAt: new Date().toISOString(),
      });
      googleMapsJobCache.set(jobId, {
        ...current,
        status: "error",
        preview: null,
        error: message,
        lastError: message,
        nextRetryAt: null,
        updatedAt: new Date().toISOString(),
      });
      persistGoogleMapsJobs();
    }
  })();

  return job;
}

async function fetchGoogleMapsPreviewOnce(url: string, attempt: number): Promise<GoogleMapsPreview | null> {
  const browser = await getBrowser();
  const locale = randomItem(GOOGLE_MAPS_LOCALES);
  const userAgent = randomItem(GOOGLE_MAPS_USER_AGENTS);
  const page = await browser.newPage({
    locale,
    userAgent,
    viewport: {
      width: Math.floor(1280 + Math.random() * 320),
      height: Math.floor(820 + Math.random() * 180),
    },
  });

  try {
    await page.setExtraHTTPHeaders({
      "Accept-Language": `${locale},en;q=0.8`,
    });

    log.info({ url, attempt, locale, userAgent }, "Google Maps preview: opening page");
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => undefined);
    await acceptGoogleConsentIfPresent(page);
    await sleep(randomDelay(1_000, 3_000));

    const initialText = parseGoogleMapsText(await page.locator("body").innerText({ timeout: 5_000 }).catch(() => ""));
    if (/(captcha|unusual traffic|not a robot)/i.test(initialText ?? "")) {
      log.warn({ url, attempt, pageUrl: page.url(), initialText: initialText?.slice(0, 200) }, "Google Maps preview blocked by CAPTCHA/traffic checks");
      return null;
    }

    if (page.url().includes("/maps/search/") || /results/i.test(initialText ?? "")) {
      log.info({ url, attempt, pageUrl: page.url() }, "Google Maps preview: search result page detected");
      await clickFirstGoogleMapsResult(page);
      await sleep(randomDelay(1_500, 4_000));
    }

    const title = parseGoogleMapsText(await page.title())
      ?? await extractTextBySelectors(page, ["h1", 'h1.DUwDvf', 'div[role="main"] h1']);
    const bodyText = normalizeGoogleMapsGlyphs(parseGoogleMapsText(await page.locator("body").innerText({ timeout: 5_000 }).catch(() => "")));
    const localText = extractLocalGoogleMapsWindow(bodyText, title);
    const snippet = bodyText?.slice(0, 1200) ?? null;

    const rating = extractGoogleMapsRating(localText);
    const reviewCount = extractGoogleMapsReviewCount(localText);

    // Try to extract structured hours from the expanded panel first
    const structuredHours = await extractExpandedGoogleMapsHours(page).catch((err) => {
      log.warn({ err }, "Google Maps: structured hours extraction failed, falling back to text");
      return null;
    });

    // Build hoursText: prefer structured hours, then button/aria selectors, then body text regex
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
  }
}

// ---------------------------------------------------------------------------
// Caches
// ---------------------------------------------------------------------------
const cache = new NodeCache({
  stdTTL: CACHE_TTL,
  checkperiod: 600,
  maxKeys: 500,
});

/** Search cache – longer TTL, more keys (POI reviews don't change often) */
const searchCache = new NodeCache({
  stdTTL: SEARCH_CACHE_TTL,
  checkperiod: 3600,
  maxKeys: 5000,
});

/** Geocode cache – very long TTL (coordinates don't move) */
const geocodeCache = new NodeCache({
  stdTTL: GEOCODE_CACHE_TTL,
  checkperiod: 3600,
  maxKeys: 5000,
});

const googleMapsCache = new NodeCache({
  stdTTL: 60 * 60 * 24 * 14,
  checkperiod: 3600,
  maxKeys: 2000,
});

const googleMapsJobCache = new NodeCache({
  stdTTL: 60 * 60 * 24,
  checkperiod: 3600,
  maxKeys: 5000,
});

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------
const app = express();

loadPersistedGoogleMapsJobs();

app.use(helmet());
app.use(compression());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || "http://localhost:5173",
  }),
);
app.use(express.json({ limit: "1mb" }));
app.use(express.text({ limit: "1mb", type: "application/x-www-form-urlencoded" }));

// ---------------------------------------------------------------------------
// Rate limiters
// ---------------------------------------------------------------------------
const limiter = rateLimit({
  windowMs: RATE_LIMIT_WINDOW_MS,
  max: RATE_LIMIT_MAX,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests. Please wait before querying again.",
  },
});

/** Separate rate limiter for enrichment endpoints (more generous) */
const enrichLimiter = rateLimit({
  windowMs: 60_000,
  max: Number(process.env.ENRICH_RATE_LIMIT ?? 300), // 5 req/s average — proxying to our own SearXNG
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many enrichment requests. Please wait.",
  },
});

// ---------------------------------------------------------------------------
// Health check
// ---------------------------------------------------------------------------
app.get("/health", async (_req, res) => {
  const services: Record<string, "ok" | "error"> = {};

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3000);

  try {
    await fetch(`${SEARXNG_URL}/health`, { signal: controller.signal });
    services.searxng = "ok";
  } catch {
    services.searxng = "error";
  } finally {
    clearTimeout(timeout);
  }

  res.json({
    status: "ok",
    cache_keys: cache.keys().length,
    uptime: process.uptime(),
    services,
  });
});

// ---------------------------------------------------------------------------
// SearXNG UI redirect — lets the user solve a CAPTCHA in the same browser
// session/IP as the enrichment requests (opened via /api/searxng-ui)
// ---------------------------------------------------------------------------
app.get("/searxng-ui", (_req, res) => {
  res.redirect(302, `${SEARXNG_URL}/`);
});

// ---------------------------------------------------------------------------
// Cache stats
// ---------------------------------------------------------------------------
app.get("/cache/stats", (_req, res) => {
  const overpassStats = cache.getStats();
  const searchStats = searchCache.getStats();
  const geocodeStats = geocodeCache.getStats();
  res.json({
    overpass: {
      keys: cache.keys().length,
      hits: overpassStats.hits,
      misses: overpassStats.misses,
    },
    search: {
      keys: searchCache.keys().length,
      hits: searchStats.hits,
      misses: searchStats.misses,
    },
    geocode: {
      keys: geocodeCache.keys().length,
      hits: geocodeStats.hits,
      misses: geocodeStats.misses,
    },
  });
});

/** Flush the search cache — useful after engine configuration changes */
app.delete("/cache/search", (req, res) => {
  const adminKey = process.env.ADMIN_API_KEY;
  if (adminKey && req.headers["x-admin-key"] !== adminKey) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const count = searchCache.keys().length;
  searchCache.flushAll();
  log.info({ flushed: count }, "Search cache flushed");
  res.json({ flushed: count });
});

// ---------------------------------------------------------------------------
// Overpass proxy endpoint
// ---------------------------------------------------------------------------
app.post("/overpass", limiter, async (req, res) => {
  try {
    // Accept query from JSON body or form-encoded body
    const query: string =
      typeof req.body === "string"
        ? req.body
        : req.body?.data ?? req.body?.query;

    if (!query || typeof query !== "string") {
      res.status(400).json({ error: "Missing 'query' or 'data' in request body" });
      return;
    }

    // Guard: reject overly large queries
    if (query.length > MAX_QUERY_LENGTH) {
      res.status(413).json({
        error: `Query too large (${query.length} chars, max ${MAX_QUERY_LENGTH})`,
      });
      return;
    }

    // Cache key from query hash
    const crypto = await import("crypto");
    const cacheKey = crypto.createHash("md5").update(query).digest("hex");

    // Check cache
    const cached = cache.get<string>(cacheKey);
    if (cached) {
      log.info({ cacheKey }, "Cache hit");
      res.setHeader("X-Cache", "HIT");
      res.setHeader("Content-Type", "application/json");
      res.send(cached);
      return;
    }

    // Forward to Overpass
    log.info({ queryLength: query.length }, "Forwarding to Overpass");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 180_000);

    const overpassUrls = [OVERPASS_URL, OVERPASS_FALLBACK_URL];

    let overpassRes: Response | undefined;
    let usedUrl = "";
    for (const url of overpassUrls) {
      try {
        usedUrl = url;
        overpassRes = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: `data=${encodeURIComponent(query)}`,
          signal: controller.signal,
        });
        if (overpassRes.ok) break;
      } catch {
        log.warn({ url }, "Overpass fetch failed, trying next");
      }
    }

    clearTimeout(timeout);

    if (!overpassRes || !overpassRes.ok) {
      const body = overpassRes ? await overpassRes.text() : "All Overpass instances failed";
      log.warn(
        { status: overpassRes?.status, usedUrl },
        "Overpass returned non-OK status",
      );
      res.status(overpassRes?.status || 502).json({
        error: "Overpass API error",
        status: overpassRes?.status,
        detail: body.slice(0, 500),
      });
      return;
    }

    const data = await overpassRes.text();

    // Cache the response
    cache.set(cacheKey, data);
    log.info({ cacheKey, bytes: data.length }, "Cached Overpass response");

    res.setHeader("X-Cache", "MISS");
    res.setHeader("Content-Type", "application/json");
    res.send(data);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      log.error("Overpass request timed out");
      res.status(504).json({ error: "Overpass request timed out" });
      return;
    }
    log.error({ err }, "Overpass proxy error");
    res.status(502).json({ error: "Failed to reach Overpass API" });
  }
});

// ---------------------------------------------------------------------------
// SearXNG search proxy endpoint
// ---------------------------------------------------------------------------
app.post("/search", enrichLimiter, async (req, res) => {
  try {
    const { query, language, engines } = req.body as { query?: string; language?: string; engines?: string };

    if (!query || typeof query !== "string") {
      res.status(400).json({ error: "Missing 'query' in request body" });
      return;
    }

    if (query.length > 500) {
      res.status(413).json({ error: "Search query too long (max 500 chars)" });
      return;
    }

    // Cache key includes engines to avoid returning cached results from different engine sets
    const crypto = await import("crypto");
    const cacheInput = engines ? `${query}|engines=${engines}` : query;
    const cacheKey = `search:${crypto.createHash("md5").update(cacheInput).digest("hex")}`;

    const cached = searchCache.get<string>(cacheKey);
    if (cached) {
      log.info({ cacheKey }, "Search cache hit");
      res.setHeader("X-Cache", "HIT");
      res.setHeader("Content-Type", "application/json");
      res.send(cached);
      return;
    }

    // Build SearXNG query URL
    const params = new URLSearchParams({
      q: query,
      format: "json",
      categories: "general",
      language: language || "auto",
      time_range: "",
      safesearch: "0",
    });

    // Forward engine selection to SearXNG if specified
    if (engines && typeof engines === "string") {
      params.set("engines", engines);
    }

    log.info({ query: query.slice(0, 80), engines: engines || "default" }, "Searching SearXNG");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15_000);

    let searchRes: Response;
    try {
      searchRes = await fetch(`${SEARXNG_URL}/search?${params.toString()}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "Ravitools/1.0 (cycling POI enrichment)",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!searchRes.ok) {
      const body = await searchRes.text();
      log.warn({ status: searchRes.status }, "SearXNG returned non-OK status");
      res.status(searchRes.status).json({
        error: "SearXNG search error",
        status: searchRes.status,
        detail: body.slice(0, 500),
      });
      return;
    }

    const data = await searchRes.text();

    // Log unresponsive engines for observability
    try {
      const parsed = JSON.parse(data);
      if (parsed.unresponsive_engines?.length > 0) {
        log.warn({
          query: (req.body as { query?: string }).query?.slice(0, 60),
          unresponsive: parsed.unresponsive_engines,
        }, "SearXNG unresponsive engines");
      }
    } catch { /* non-critical parse failure */ }

    // Cache the response
    searchCache.set(cacheKey, data);
    log.info({ cacheKey, bytes: data.length }, "Cached search response");

    res.setHeader("X-Cache", "MISS");
    res.setHeader("Content-Type", "application/json");
    res.send(data);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      log.error("SearXNG request timed out");
      res.status(504).json({ error: "Search request timed out" });
      return;
    }
    log.error({ err }, "Search proxy error");
    res.status(502).json({ error: "Failed to reach search service" });
  }
});

// ---------------------------------------------------------------------------
// Nominatim reverse geocode proxy endpoint
// ---------------------------------------------------------------------------
app.post("/geocode", enrichLimiter, async (req, res) => {
  try {
    const { lat, lon } = req.body as { lat?: number; lon?: number };

    if (typeof lat !== "number" || typeof lon !== "number") {
      res.status(400).json({ error: "Missing 'lat' and 'lon' in request body" });
      return;
    }

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      res.status(400).json({ error: "Invalid coordinates" });
      return;
    }

    // Cache key — round to ~111m precision for cache efficiency
    const roundedLat = Math.round(lat * 1000) / 1000;
    const roundedLon = Math.round(lon * 1000) / 1000;
    const cacheKey = `geo:${roundedLat},${roundedLon}`;

    const cached = geocodeCache.get<string>(cacheKey);
    if (cached) {
      log.info({ cacheKey }, "Geocode cache hit");
      res.setHeader("X-Cache", "HIT");
      res.setHeader("Content-Type", "application/json");
      res.send(cached);
      return;
    }

    // Nominatim reverse geocode
    const params = new URLSearchParams({
      lat: lat.toString(),
      lon: lon.toString(),
      format: "json",
      zoom: "14", // city/town level
      addressdetails: "1",
    });

    log.info({ lat: roundedLat, lon: roundedLon }, "Reverse geocoding via Nominatim");

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    let geoRes: Response;
    try {
      geoRes = await fetch(`${NOMINATIM_URL}/reverse?${params.toString()}`, {
        method: "GET",
        headers: {
          Accept: "application/json",
          "User-Agent": "Ravitools/1.0 (cycling POI enrichment)",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!geoRes.ok) {
      const body = await geoRes.text();
      log.warn({ status: geoRes.status }, "Nominatim returned non-OK status");
      res.status(geoRes.status).json({
        error: "Nominatim geocode error",
        status: geoRes.status,
        detail: body.slice(0, 500),
      });
      return;
    }

    const data = await geoRes.text();

    // Cache the response
    geocodeCache.set(cacheKey, data);
    log.info({ cacheKey }, "Cached geocode response");

    res.setHeader("X-Cache", "MISS");
    res.setHeader("Content-Type", "application/json");
    res.send(data);
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      log.error("Nominatim request timed out");
      res.status(504).json({ error: "Geocode request timed out" });
      return;
    }
    log.error({ err }, "Geocode proxy error");
    res.status(502).json({ error: "Failed to reach geocode service" });
  }
});

// ---------------------------------------------------------------------------
// Website preview proxy endpoint
// ---------------------------------------------------------------------------
app.post("/fetch-page", enrichLimiter, async (req, res) => {
  try {
    const { url } = req.body as { url?: string };

    if (!url || typeof url !== "string") {
      res.status(400).json({ error: "Missing 'url' in request body" });
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      res.status(400).json({ error: "Invalid URL" });
      return;
    }

    if (!["http:", "https:"].includes(parsedUrl.protocol)) {
      res.status(400).json({ error: "Only http/https URLs are supported" });
      return;
    }

    // SSRF guard — block private/internal IPs
    try {
      await assertPublicHostname(parsedUrl.hostname);
    } catch (err) {
      log.warn({ url, err }, "SSRF blocked: private IP detected");
      res.status(403).json({ error: "URL points to a private/internal address" });
      return;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    let pageRes: Response;
    try {
      pageRes = await fetch(parsedUrl.toString(), {
        method: "GET",
        redirect: "follow",
        headers: {
          Accept: "text/html,application/xhtml+xml",
          "User-Agent": "Ravitools/1.0 (cycling POI enrichment)",
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!pageRes.ok) {
      res.status(pageRes.status).json({
        error: "Website fetch error",
        status: pageRes.status,
      });
      return;
    }

    const contentType = pageRes.headers.get("content-type") || "";
    if (!contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      res.status(415).json({
        error: "Unsupported content type",
        contentType,
      });
      return;
    }

    const html = await pageRes.text();
    const normalized = html.replace(/\s+/g, " ").trim();
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    const descriptionMatch = html.match(/<meta\s+name=["']description["']\s+content=["']([\s\S]*?)["'][^>]*>/i)
      ?? html.match(/<meta\s+content=["']([\s\S]*?)["']\s+name=["']description["'][^>]*>/i);
    const bodyText = normalized
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const structuredData = extractStructuredDataFromHtml(html);

    res.json({
      url: parsedUrl.toString(),
      finalUrl: pageRes.url,
      contentType,
      title: titleMatch?.[1]?.replace(/\s+/g, " ").trim() || null,
      description: descriptionMatch?.[1]?.replace(/\s+/g, " ").trim() || structuredData?.description || null,
      excerpt: bodyText.slice(0, 1200) || null,
      structuredData,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "AbortError") {
      res.status(504).json({ error: "Website fetch timed out" });
      return;
    }
    log.error({ err }, "Website fetch proxy error");
    res.status(502).json({ error: "Failed to fetch website" });
  }
});

app.post("/google-maps-preview", enrichLimiter, async (req, res) => {
  try {
    const { url } = req.body as { url?: string };
    if (!url || typeof url !== "string") {
      res.status(400).json({ error: "Missing 'url' in request body" });
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      res.status(400).json({ error: "Invalid URL" });
      return;
    }

    if (!/^www\.google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(parsedUrl.hostname) || !parsedUrl.pathname.startsWith("/maps/")) {
      res.status(400).json({ error: "Only Google Maps URLs are supported" });
      return;
    }

    const cacheKey = `gmaps:${parsedUrl.toString()}`;
    const cached = googleMapsCache.get<GoogleMapsPreview>(cacheKey);
    if (cached) {
      res.setHeader("X-Cache", "HIT");
      res.json(cached);
      return;
    }

    const preview = await fetchGoogleMapsPreview(parsedUrl.toString());
    if (!preview) {
      res.status(502).json({ error: "Failed to extract Google Maps preview" });
      return;
    }

    googleMapsCache.set(cacheKey, preview);
    res.setHeader("X-Cache", "MISS");
    res.json(preview);
  } catch (err: unknown) {
    log.error({ err }, "Google Maps preview error");
    res.status(502).json({ error: "Failed to fetch Google Maps preview" });
  }
});

app.post("/google-maps-preview/jobs", enrichLimiter, async (req, res) => {
  try {
    const { url, poiName } = req.body as { url?: string; poiName?: string };
    if (!url || typeof url !== "string") {
      res.status(400).json({ error: "Missing 'url' in request body" });
      return;
    }

    let parsedUrl: URL;
    try {
      parsedUrl = new URL(url);
    } catch {
      res.status(400).json({ error: "Invalid URL" });
      return;
    }

    if (!/^www\.google\.[a-z]{2,3}(\.[a-z]{2})?$/.test(parsedUrl.hostname) || !parsedUrl.pathname.startsWith("/maps/")) {
      res.status(400).json({ error: "Only Google Maps URLs are supported" });
      return;
    }

    const job = await queueGoogleMapsPreviewJob(parsedUrl.toString(), typeof poiName === "string" ? poiName : null);
    res.status(202).json(job);
  } catch (err: unknown) {
    log.error({ err }, "Google Maps preview job queue error");
    res.status(502).json({ error: "Failed to queue Google Maps preview" });
  }
});

app.delete("/google-maps-preview/jobs/:jobId", enrichLimiter, (req, res) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const job = googleMapsJobCache.get<GoogleMapsPreviewJob>(jobId);
  if (!job) {
    res.status(404).json({ error: "Google Maps preview job not found" });
    return;
  }
  if (job.status === "running") {
    // Mark as cancelled (stored as error with a sentinel message); cannot abort in-flight Playwright page
    googleMapsJobCache.set(jobId, {
      ...job,
      status: "error",
      error: "Cancelled by user",
      lastError: "Cancelled by user",
      nextRetryAt: null,
      updatedAt: new Date().toISOString(),
    });
  } else {
    googleMapsJobCache.del(jobId);
  }
  persistGoogleMapsJobs();
  log.info({ jobId, previousStatus: job.status }, "Google Maps preview job cancelled");
  res.status(204).send();
});

app.get("/google-maps-preview/jobs/:jobId", enrichLimiter, (req, res) => {
  const jobId = Array.isArray(req.params.jobId) ? req.params.jobId[0] : req.params.jobId;
  const job = googleMapsJobCache.get<GoogleMapsPreviewJob>(jobId);
  if (!job) {
    res.status(404).json({ error: "Google Maps preview job not found" });
    return;
  }
  res.json(job);
});

app.get("/google-maps-preview/jobs", enrichLimiter, (_req, res) => {
  const jobs = googleMapsJobCache.keys()
    .map((key) => googleMapsJobCache.get<GoogleMapsPreviewJob>(key))
    .filter((job): job is GoogleMapsPreviewJob => Boolean(job));
  const counts = {
    queued: jobs.filter((job) => job.status === "queued").length,
    running: jobs.filter((job) => job.status === "running").length,
    done: jobs.filter((job) => job.status === "done").length,
    error: jobs.filter((job) => job.status === "error").length,
  };
  res.json({ counts, jobs: jobs.slice(-20).reverse() });
});

// ---------------------------------------------------------------------------
// Start (only when run directly, not when imported for testing)
// ---------------------------------------------------------------------------
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    log.info({ port: PORT, overpass: OVERPASS_URL }, "Ravitools proxy started");
  });

  // Graceful shutdown — close Playwright browser to avoid orphaned Chromium processes
  const shutdown = async () => {
    log.info("Shutting down...");
    if (browserPromise) {
      try {
        const browser = await browserPromise;
        await browser.close();
        log.info("Playwright browser closed");
      } catch { /* already closed */ }
    }
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

export default app;

// ---------------------------------------------------------------------------
// Test-only exports (used by server unit tests)
// Not part of the public API.
// ---------------------------------------------------------------------------
export const _testExports = {
  parseGoogleMapsHoursRow,
  normalizeDay,
  normalizeTimeString,
  extractGoogleMapsRating,
  extractGoogleMapsReviewCount,
  cleanGoogleMapsHours,
  extractPriceLevelFromText,
  googleMapsJobCache,
  persistGoogleMapsJobs,
  loadPersistedGoogleMapsJobs,
  GOOGLE_MAPS_JOBS_FILE,
  GOOGLE_MAPS_PROXY_URL,
  GOOGLE_MAPS_FAILURES_FILE,
  appendGoogleMapsFailure,
};
