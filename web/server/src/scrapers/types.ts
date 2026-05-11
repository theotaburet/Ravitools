/**
 * Shared types for the map-source scraper plugin system.
 *
 * A "scraper" is anything that, given a POI name + coordinates (or a direct
 * URL), returns a structured `MapPreview` extracted from a third-party map
 * platform (Google Maps, Yandex Maps, Bing Maps, Apple Maps, OSM, etc.).
 *
 * Concrete plugins live in sibling files (google-maps.ts, yandex-maps.ts).
 * The job system / endpoint mounting is shared via job-system.ts and
 * endpoints.ts so adding a new source is a focused exercise in writing
 * the platform-specific Playwright extraction, not in re-implementing
 * queueing / persistence / retries / failure logging.
 */

import type { Browser } from "playwright";
import type { Logger } from "pino";

// ---------------------------------------------------------------------------
// Hours entry — same across sources
// ---------------------------------------------------------------------------

export type MapHoursEntry = {
  day: string;
  open: string;
  close: string | null;
};

// ---------------------------------------------------------------------------
// Base MapPreview — common shape that all sources expose.
//
// Concrete plugins extend this via `MapPreview & { source: "google" | ... }`
// (and may add source-specific optional fields). The client merger consumes
// this base shape uniformly.
// ---------------------------------------------------------------------------

export type MapPreview = {
  /** Original URL we requested (input) */
  url: string;
  /** URL after the page navigated / canonicalized (output) */
  resolvedUrl: string | null;
  title: string | null;
  category: string | null;
  rating: number | null;
  reviewCount: number | null;
  /** Some sources expose $/$$/$$$/$$$$ price tier; null when not surfaced */
  priceLevel: number | null;
  hoursText: string | null;
  structuredHours: MapHoursEntry[] | null;
  address: string | null;
  phone: string | null;
  website: string | null;
  snippet: string | null;
  fetchedAt: string;
};

// ---------------------------------------------------------------------------
// Job system types
// ---------------------------------------------------------------------------

export type ScraperJobStatus = "queued" | "running" | "done" | "error";

export type ScraperJob<T extends MapPreview> = {
  jobId: string;
  status: ScraperJobStatus;
  /** Source name (denormalized for easy filtering on the wire) */
  source: string;
  url: string;
  /** Human-readable POI name for UI display */
  poiName: string | null;
  preview: T | null;
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

// ---------------------------------------------------------------------------
// Shared dependencies injected into plugins (logger, sleep, randomDelay,
// browser supplier). Plugins are kept dependency-free so tests can mock
// trivially.
// ---------------------------------------------------------------------------

export interface ScraperDeps {
  log: Logger;
  sleep: (ms: number) => Promise<void>;
  randomDelay: (minMs: number, maxMs: number) => number;
  /** Get the shared Playwright browser (lazy-launched, reused across jobs) */
  getBrowser: () => Promise<Browser>;
}

// ---------------------------------------------------------------------------
// MapScraperPlugin — the contract every source implements.
//
// `T extends MapPreview` lets plugins extend the base shape with extra
// fields if they want (e.g. Google's structured hours entries are typed
// MapHoursEntry[] which is the same as the base, so no extension needed).
// ---------------------------------------------------------------------------

export interface MapScraperPlugin<T extends MapPreview = MapPreview> {
  /** Stable kebab-case identifier; used in URLs, cache keys, file paths */
  readonly name: string;

  /** Human-readable label for logs and the UI */
  readonly displayName: string;

  /**
   * Validate (and normalize) a user-supplied URL. Return null if the URL is
   * not a valid URL for this source. Returning a URL string means the URL
   * passed validation and may be canonicalized (e.g. trim params).
   */
  validateUrl(url: string): string | null;

  /**
   * Optionally build a search/canonical URL from POI name + coordinates.
   * Sources that only accept direct URLs return null; sources that support
   * search-by-name (Google, Yandex, Bing) build a search URL here.
   */
  buildUrl?(poiName: string, lat: number, lon: number, extra?: Record<string, unknown>): string | null;

  /**
   * Run the actual extraction once. Throws on hard failures (network, page
   * crashes), returns null on soft failures (CAPTCHA, no results found,
   * blocked). The job system handles retries; this method should not.
   */
  fetchOnce(url: string, attempt: number, deps: ScraperDeps): Promise<T | null>;

  /** Per-source tunables (env-overridable in concrete plugins) */
  readonly minDelayMs: number;
  readonly maxDelayMs: number;
  readonly retries: number;

  /** TTL for the preview cache, in seconds */
  readonly previewCacheTtlSec: number;

  /** TTL for the jobs map (terminal jobs auto-prune after this), in milliseconds */
  readonly jobsTtlMs: number;
}
