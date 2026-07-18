// ---------------------------------------------------------------------------
// SearXNG engine health — failure tracking, cooldown suspension, CAPTCHA URL
// ---------------------------------------------------------------------------

import type { SearchSnippet } from "../../types";

/**
 * Known-good SearXNG engines for POI enrichment.
 * Keep this explicit so we don't silently fall back to noisy/broken defaults.
 *
 * Engines removed:
 *   - yandex: constantly CAPTCHA'd, returns Russian/German noise
 *   - mojeek: access denied in a loop, English-biased, no French local content
 */
export const SEARXNG_ENGINES = "presearch,bing,aol";

const ENGINE_COOLDOWN_MS = 30 * 60 * 1000;
const ENGINE_FAILURE_THRESHOLD = 2;
const ENGINE_FAILURE_PATTERNS =
  /(access denied|captcha|too many requests|http protocol error|timed out|network|forbidden)/i;

const engineFailureState = new Map<
  string,
  { failures: number; suspendedUntil: number; lastReason: string }
>();

export function getHealthyEngineList(): string {
  const now = Date.now();
  const healthy = SEARXNG_ENGINES.split(",")
    .map((engine) => engine.trim())
    .filter(Boolean)
    .filter((engine) => (engineFailureState.get(engine)?.suspendedUntil ?? 0) <= now);
  return healthy.join(",") || SEARXNG_ENGINES;
}

export function noteEngineFailures(unresponsiveEngines: [string, string][]): void {
  const now = Date.now();
  for (const [engine, reason] of unresponsiveEngines) {
    if (!ENGINE_FAILURE_PATTERNS.test(reason)) continue;
    const prev = engineFailureState.get(engine) ?? {
      failures: 0,
      suspendedUntil: 0,
      lastReason: reason,
    };
    const failures = prev.failures + 1;
    const suspendedUntil =
      failures >= ENGINE_FAILURE_THRESHOLD ? now + ENGINE_COOLDOWN_MS : prev.suspendedUntil;
    engineFailureState.set(engine, { failures, suspendedUntil, lastReason: reason });
  }
}

export function noteSuccessfulEngines(snippets: SearchSnippet[]): void {
  for (const engine of new Set(snippets.map((snippet) => snippet.engine))) {
    const prev = engineFailureState.get(engine);
    if (!prev) continue;
    engineFailureState.set(engine, { failures: 0, suspendedUntil: 0, lastReason: prev.lastReason });
  }
}

/**
 * Reset engine failure state entirely.
 * Call on resetEnrichment() so new sessions start with a clean slate
 * even if the previous session suspended engines.
 */
export function resetEngineFailureState(): void {
  engineFailureState.clear();
}

export function countSuspendedHealthyEngines(): number {
  const now = Date.now();
  return [...engineFailureState.values()].filter((item) => item.suspendedUntil > now).length;
}

/**
 * Returns true when every configured engine is currently suspended
 * (CAPTCHA, access denied, rate-limited) and the batch should pause
 * to let the user resolve the CAPTCHA manually.
 */
export function areAllEnginesSuspended(): boolean {
  const allEngines = SEARXNG_ENGINES.split(",")
    .map((e) => e.trim())
    .filter(Boolean);
  if (allEngines.length === 0) return false;
  const now = Date.now();
  return allEngines.every((engine) => {
    const state = engineFailureState.get(engine);
    return state != null && state.suspendedUntil > now;
  });
}

/**
 * Build the URL to open in a browser tab for manual CAPTCHA resolution.
 * Uses the SearXNG proxy endpoint so the user clears the block on the
 * same IP/session as the enrichment requests.
 * Falls back to the raw SearXNG instance URL if the apiBase is a relative path.
 */
export function buildCaptchaResolveUrl(apiBase: string = "/api"): string {
  // Point the user at SearXNG's own search UI via the proxy base.
  if (apiBase.startsWith("http")) {
    return `${apiBase}/searxng-ui`;
  }
  // Relative path: build an absolute URL using the current origin
  return `${window.location.origin}${apiBase}/searxng-ui`;
}
