// ---------------------------------------------------------------------------
// SearXNG search adapter — searchPoi + re-exports of the search submodules
// (engine-health, query-builder, snippet-filters, websites, google-maps, geocode)
// ---------------------------------------------------------------------------

import type { GeoContext, POI, SearchSnippet } from "../../types";
import { dlog } from "../debug-log";
import { getHealthyEngineList, noteEngineFailures, noteSuccessfulEngines } from "./engine-health";
import { REQUEST_TIMEOUT, timeoutSignal } from "./proxy-api";
import { buildQueryVariants, buildSearchQuery } from "./query-builder";
import { isObviousNoiseSnippet, isSnippetGeographicallyCoherent } from "./snippet-filters";
import { normalizeUrlForDedup } from "./websites";

// Re-exports kept on this module for existing import sites (tests, hooks, barrel).
export {
  areAllEnginesSuspended,
  buildCaptchaResolveUrl,
  countSuspendedHealthyEngines,
  resetEngineFailureState,
} from "./engine-health";
export { reverseGeocode } from "./geocode";
export {
  buildGoogleMapsSnippets,
  buildGoogleMapsUrl,
  enqueueGoogleMapsPreview,
  fetchGoogleMapsJobStats,
  pollGoogleMapsPreviewJob,
} from "./google-maps";
export { buildSearchQuery, cleanPoiNameForSearch } from "./query-builder";
export { isSnippetGeographicallyCoherent } from "./snippet-filters";
export {
  buildOfficialWebsiteSnippets,
  classifySourcePlatform,
  fetchWebsitePreview,
  getOfficialWebsiteUrl,
  isRejectedOfficialDomain,
  normalizeUrlForDedup,
} from "./websites";

/** Max snippets to keep per POI search */
const MAX_SNIPPETS = 8;

/** Raw SearXNG result from the JSON API */
interface SearXNGResult {
  title: string;
  url: string;
  content?: string;
  engine: string;
  score?: number;
}

/** SearXNG JSON API response */
interface SearXNGResponse {
  results: SearXNGResult[];
  query: string;
  number_of_results?: number;
  /** Engines that failed to respond: [[engine_name, error_message], ...] */
  unresponsive_engines?: [string, string][];
}

/**
 * Search for POI information via the server-side SearXNG proxy.
 * Returns cleaned snippets ready for LLM synthesis.
 * Applies geographic filtering to reject results from wrong locations.
 * Retries on 429 (rate-limited) and network errors with exponential backoff.
 */
export async function searchPoi(
  poi: POI,
  locality: string | null,
  apiBase: string = "/api",
  signal?: AbortSignal,
  maxRetries: number = 3,
  geoContext?: GeoContext | null,
): Promise<{ snippets: SearchSnippet[]; query: string; unresponsiveEngines: [string, string][] }> {
  let lastError: Error | null = null;
  let lastUnresponsiveEngines: [string, string][] = [];
  const queries = buildQueryVariants(poi, locality, geoContext);
  const requestedEngines = getHealthyEngineList();
  const log = dlog("search");

  queryLoop: for (const query of queries) {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      if (signal?.aborted) throw new Error("Cancelled");

      if (attempt > 0) {
        const delayMs = 2000 * 2 ** (attempt - 1);
        await new Promise((r) => setTimeout(r, delayMs));
      }

      // AUDIT R25: native timeout+signal combination — no manual listeners to leak (R20)
      const fetchSignal = timeoutSignal(REQUEST_TIMEOUT, signal);

      try {
        const res = await fetch(`${apiBase}/search`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            query,
            language: "fr",
            engines: requestedEngines,
          }),
          signal: fetchSignal,
        });

        if (res.status === 429) {
          lastError = new Error("Search rate-limited (429)");
          continue;
        }

        if (res.status === 502 || res.status === 503 || res.status === 504) {
          lastError = new Error(`Search server error (${res.status})`);
          continue;
        }

        if (!res.ok) {
          throw new Error(`Search failed: ${res.status} ${res.statusText}`);
        }

        const data: SearXNGResponse = await res.json();
        lastUnresponsiveEngines = data.unresponsive_engines ?? [];
        noteEngineFailures(lastUnresponsiveEngines);

        const seen = new Set<string>();
        const rawSnippets: SearchSnippet[] = [];

        for (const result of data.results) {
          if (rawSnippets.length >= MAX_SNIPPETS * 2) break;
          if (!result.content?.trim()) continue;

          const normalizedUrl = normalizeUrlForDedup(result.url);
          if (seen.has(normalizedUrl)) continue;
          seen.add(normalizedUrl);

          rawSnippets.push({
            title: result.title || "",
            url: result.url,
            content: result.content.trim(),
            engine: result.engine || "unknown",
          });
        }

        const snippets: SearchSnippet[] = [];
        let filteredCount = 0;
        for (const s of rawSnippets) {
          if (snippets.length >= MAX_SNIPPETS) break;
          if (isObviousNoiseSnippet(s, poi, locality)) {
            filteredCount++;
            continue;
          }
          if (isSnippetGeographicallyCoherent(s, geoContext ?? null, locality)) {
            snippets.push(s);
          } else {
            filteredCount++;
          }
        }

        log.info(`SearXNG results for "${poi.name}"`, {
          query,
          requestedEngines,
          totalResults: data.results.length,
          rawKept: rawSnippets.length,
          geoFiltered: filteredCount,
          keptSnippets: snippets.length,
          unresponsiveEngines: data.unresponsive_engines?.length ?? 0,
        });
        for (const s of snippets) {
          log.debug(`  [${s.engine}] ${s.title}`, { url: s.url, content: s.content.slice(0, 120) });
        }
        if (data.unresponsive_engines && data.unresponsive_engines.length > 0) {
          log.info(
            `Unresponsive engines for "${poi.name}": ${data.unresponsive_engines.map(([e, r]) => `${e} (${r})`).join(", ")}`,
            {
              engines: data.unresponsive_engines,
            },
          );
        }

        if (snippets.length > 0) {
          noteSuccessfulEngines(snippets);
          return { snippets, query, unresponsiveEngines: data.unresponsive_engines ?? [] };
        }

        // AUDIT R13: 0 kept snippets is a soft miss — try the next query
        // variant instead of returning (the fallback was dead code).
        continue queryLoop;
      } catch (err) {
        if (signal?.aborted) throw new Error("Cancelled");

        lastError = err instanceof Error ? err : new Error(String(err));

        if (/^Search failed: /i.test(lastError.message)) {
          throw lastError;
        }

        // Timeout (TimeoutError) and cancellation (AbortError) are not retried.
        if (
          attempt < maxRetries &&
          lastError.name !== "AbortError" &&
          lastError.name !== "TimeoutError"
        ) {
          continue;
        }

        break;
      }
    }
  }

  log.warn(`No useful snippets retained for "${poi.name}" after query fallbacks`, {
    queriesTried: queries,
    requestedEngines,
    unresponsiveEngines: lastUnresponsiveEngines,
  });
  return {
    snippets: [],
    query: queries[queries.length - 1] ?? buildSearchQuery(poi, locality, geoContext),
    unresponsiveEngines: lastUnresponsiveEngines,
  };
}
