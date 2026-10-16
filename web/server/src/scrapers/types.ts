/**
 * Types of the Google Maps scraper and its job queue.
 *
 * The job system (job-system.ts) and the endpoints (endpoints.ts) take the
 * source as a `MapScraperPlugin` object: the only reason is that tests drive
 * them with a mock source instead of Playwright.
 */

import type { Logger } from "pino";
import type { Browser } from "playwright";

export type MapHoursEntry = {
  day: string;
  open: string;
  close: string | null;
};

export type MapPreview = {
  /** Original URL we requested (input) */
  url: string;
  /** URL after the page navigated / canonicalized (output) */
  resolvedUrl: string | null;
  title: string | null;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  /** $/$$/$$$/$$$$ price tier; null when not surfaced */
  priceLevel: number | null;
  hoursText: string | null;
  structuredHours: MapHoursEntry[] | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  snippet: string | null;
  fetchedAt: string;
  /** Source layout checks that failed (a section is on the page but did not parse) */
  layoutWarnings?: string[];
};

// --- Job system types ---

export type ScraperJobStatus = "queued" | "running" | "done" | "error";

export type ScraperJob = {
  jobId: string;
  status: ScraperJobStatus;
  /** Source name (denormalized for easy filtering on the wire) */
  source: string;
  url: string;
  /** Human-readable POI name for UI display */
  poiName: string | null;
  preview: MapPreview | null;
  error: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  attempt: number;
  nextRetryAt: string | null;
  lastError: string | null;
};

export type ScraperFailureRecord = {
  source: string;
  url: string;
  poiName: string | null;
  attempts: number;
  lastError: string | null;
  failedAt: string;
};

/**
 * Sentinel prefix for "scraper was blocked" errors (CAPTCHA / anti-bot / 429).
 * `fetchOnce` throws `new Error(\`${BLOCKED_ERROR_PREFIX} ...\`)` so the block
 * reaches the job's `lastError` (instead of an opaque null) and the `/jobs`
 * endpoint can report a `blocked` count to the client.
 */
export const BLOCKED_ERROR_PREFIX = "BLOCKED:";

export function isBlockedError(message: string | null | undefined): boolean {
  return typeof message === "string" && message.startsWith(BLOCKED_ERROR_PREFIX);
}

/** Injected so tests run without real delays or a browser. */
export interface ScraperDeps {
  log: Logger;
  sleep: (ms: number) => Promise<void>;
  randomDelay: (minMs: number, maxMs: number) => number;
  /** Get the shared Playwright browser (lazy-launched, reused across jobs) */
  getBrowser: () => Promise<Browser>;
}

export interface MapScraperPlugin {
  /** Stable kebab-case identifier; used in cache file paths */
  readonly name: string;

  /** Human-readable label for logs and errors */
  readonly displayName: string;

  /** Validate (and normalize) a user-supplied URL; null if it is not one of this source */
  validateUrl(url: string): string | null;

  /**
   * Run the actual extraction once. Throws on hard failures (network, page
   * crashes); throws a `BLOCKED_ERROR_PREFIX`-tagged error when the page is
   * blocked (CAPTCHA / anti-bot); returns null on plain "no results found".
   * The job system handles retries; this method should not.
   */
  fetchOnce(url: string, attempt: number, deps: ScraperDeps): Promise<MapPreview | null>;

  /** Tunables (env-overridable) */
  readonly minDelayMs: number;
  readonly maxDelayMs: number;
  readonly retries: number;

  /** TTL for the jobs map (terminal jobs auto-prune after this), in milliseconds */
  readonly jobsTtlMs: number;
}
