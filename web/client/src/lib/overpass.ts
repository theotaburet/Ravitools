// ---------------------------------------------------------------------------
// Overpass query builder & client
// Port of overpass_client.py logic, adapted for client-heavy architecture
// ---------------------------------------------------------------------------

import type { TracePoint, PoiCategory } from "../types";
import { POI_CATEGORIES } from "./poi-config";
import { dlog } from "./debug-log";

/** Proxy base URL – in dev, Vite proxies /api to the server */
const PROXY_BASE =
  (typeof window !== "undefined" &&
    ((window as unknown as Record<string, unknown>).__RAVITOOLS_API_URL__ as string)) ||
  "/api";

const overpassResultCache = new Map<string, OverpassResponse>();

// ---------------------------------------------------------------------------
// Query building
// ---------------------------------------------------------------------------

/**
 * Build an Overpass QL query for the given trace corridor.
 *
 * Strategy (from architecture-decision.md):
 * - Use `around:` with simplified trace points (not a naive bbox)
 * - Group tags by OSM key to minimize query clauses
 * - Keep radius tight (default 1000m) to reduce noise
 *
 * @param points - Simplified trace points
 * @param radiusM - Search corridor radius in meters
 * @param categories - Which categories to query (defaults to all)
 */
export function buildOverpassQuery(
  points: TracePoint[],
  radiusM: number = 1000,
  categories?: PoiCategory[],
): string {
  const cats = categories
    ? POI_CATEGORIES.filter((c) => categories.includes(c.category))
    : POI_CATEGORIES;

  // Group tags by OSM key
  const tagGroups = new Map<string, Set<string>>();
  for (const cat of cats) {
    for (const tag of cat.tags) {
      if (!tagGroups.has(tag.key)) tagGroups.set(tag.key, new Set());
      tagGroups.get(tag.key)!.add(tag.value);
    }
  }

  // Build path lat,lon string
  const pathStr = points.map((p) => `${p.lat},${p.lon}`).join(",");

  // Build query clauses
  const clauses: string[] = [];
  for (const [key, values] of tagGroups) {
    const valuesStr = [...values].join("|");
    clauses.push(`nwr["${key}"~"${valuesStr}"](around:${radiusM},${pathStr});`);
  }

  return `[out:json][timeout:120];\n(\n${clauses.join("\n")}\n);\nout center;`;
}

/**
 * Split a long trace into chunks and build separate queries for each.
 * This prevents Overpass queries from becoming too large.
 *
 * @param points - Simplified trace points
 * @param radiusM - Search corridor radius
 * @param maxPointsPerQuery - Maximum points per query chunk
 * @param categories - Categories to query
 */
export function buildChunkedQueries(
  points: TracePoint[],
  radiusM: number = 1000,
  maxPointsPerQuery: number = 25,
  categories?: PoiCategory[],
): string[] {
  if (points.length <= maxPointsPerQuery) {
    return [buildOverpassQuery(points, radiusM, categories)];
  }

  const queries: string[] = [];
  // Overlap chunks by a few points to avoid gaps at boundaries
  const overlap = 3;
  for (let i = 0; i < points.length; i += maxPointsPerQuery - overlap) {
    const chunk = points.slice(i, i + maxPointsPerQuery);
    if (chunk.length >= 2) {
      queries.push(buildOverpassQuery(chunk, radiusM, categories));
    }
  }
  return queries;
}

// ---------------------------------------------------------------------------
// Overpass API communication (via proxy)
// ---------------------------------------------------------------------------

export interface OverpassElement {
  type: "node" | "way" | "relation";
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

export interface OverpassResponse {
  elements: OverpassElement[];
}

/**
 * Send a query to the Overpass API through the proxy server.
 * Includes retry logic with exponential backoff.
 */
export async function queryOverpass(
  query: string,
  retries: number = 3,
): Promise<OverpassResponse> {
  const log = dlog("overpass");
  const cached = overpassResultCache.get(query);
  if (cached) {
    log.info("Client cache hit", { elements: cached.elements.length, queryChars: query.length });
    return cached;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      const delayMs = 5000 * attempt;
      log.warn(`Retry ${attempt}/${retries} after ${delayMs}ms backoff`, { attempt });
      // Exponential backoff: 5s, 10s, 15s
      await new Promise((r) => setTimeout(r, delayMs));
    }

    try {
      const endTimer = log.time(`Overpass fetch (attempt ${attempt + 1})`);
      const res = await fetch(`${PROXY_BASE}/overpass`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      if (res.status === 429 || res.status === 504) {
        const reason = res.status === 429 ? "Rate limited by proxy" : "Overpass server timeout";
        endTimer();
        log.warn(`${reason} (HTTP ${res.status})`, { status: res.status, attempt });
        // Rate limited or timeout – wait and retry
        lastError = new Error(reason);
        continue;
      }

      if (!res.ok) {
        endTimer();
        const body = await res.text();
        throw new Error(
          `Overpass error (${res.status}): ${body.slice(0, 200)}`,
        );
      }

      const data: OverpassResponse = await res.json();
      const elapsedMs = endTimer();
      const cacheHeader = res.headers.get("X-Cache") || "UNKNOWN";
      log.info(`Got ${data.elements.length} elements`, {
        elements: data.elements.length,
        elapsedMs: Math.round(elapsedMs),
        serverCache: cacheHeader,
        queryChars: query.length,
      });
      overpassResultCache.set(query, data);
      return data;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      log.error(`Fetch error: ${lastError.message}`, { attempt, error: lastError.message });
      if (attempt < retries) continue;
    }
  }

  throw lastError ?? new Error("Overpass query failed");
}

/** Result of queryAllPois — includes chunk failure info for user feedback */
export interface QueryAllPoisResult {
  elements: OverpassElement[];
  failedChunks: number;
  totalChunks: number;
}

/** Progress info sent to the onProgress callback */
export interface QueryProgress {
  /** Current chunk being processed (1-indexed) */
  completedChunks: number;
  /** Total chunks */
  totalChunks: number;
  /** Current retry round (0 = initial pass) */
  retryRound: number;
  /** How many chunks are being retried this round */
  retryingCount: number;
}

/**
 * Query Overpass for all categories along a trace, chunking if necessary.
 * Returns raw elements from all chunks, deduplicated by OSM ID,
 * plus chunk failure counts so the caller can warn the user.
 *
 * Failed chunks are automatically retried up to `maxRetryRounds` times
 * with increasing backoff between rounds. This handles transient 504
 * timeouts from the Overpass public API.
 *
 * Sends up to `concurrency` requests in parallel to reduce total latency
 * while staying friendly to the Overpass public API.
 */
export async function queryAllPois(
  simplifiedPoints: TracePoint[],
  radiusM: number = 1000,
  categories?: PoiCategory[],
  onProgress?: (progress: QueryProgress) => void,
  maxPointsPerQuery: number = 50,
  concurrency: number = 2,
  maxRetryRounds: number = 3,
): Promise<QueryAllPoisResult> {
  const log = dlog("overpass");
  const queries = buildChunkedQueries(
    simplifiedPoints,
    radiusM,
    maxPointsPerQuery,
    categories,
  );

  log.info(`Built ${queries.length} chunks from ${simplifiedPoints.length} simplified points`, {
    chunks: queries.length,
    simplifiedPoints: simplifiedPoints.length,
    radiusM,
    maxPointsPerQuery,
    concurrency,
    avgQueryChars: Math.round(queries.reduce((s, q) => s + q.length, 0) / queries.length),
  });

  const seenIds = new Set<string>();
  const allElements: OverpassElement[] = [];

  // Track which chunk indices still need to be fetched
  let pendingIndices = queries.map((_, i) => i);
  let retryRound = 0;

  const endTotal = log.time(`All ${queries.length} chunks`);

  while (pendingIndices.length > 0 && retryRound <= maxRetryRounds) {
    if (retryRound > 0) {
      // Backoff before retry round: 10s, 20s, 30s
      const backoffMs = 10_000 * retryRound;
      log.warn(`Retry round ${retryRound}/${maxRetryRounds}: ${pendingIndices.length} chunks to retry after ${backoffMs / 1000}s backoff`, {
        retryRound,
        pendingCount: pendingIndices.length,
        backoffMs,
      });
      await new Promise((r) => setTimeout(r, backoffMs));
    }

    const failedThisRound: number[] = [];
    let completedOverall = queries.length - pendingIndices.length;

    // Process pending chunks with limited concurrency
    let i = 0;
    while (i < pendingIndices.length) {
      const batch = pendingIndices.slice(i, i + concurrency);
      log.debug(`${retryRound > 0 ? `[retry ${retryRound}] ` : ""}Sending batch (chunks ${batch.map((c) => c + 1).join(",")})`, {
        batchSize: batch.length,
        retryRound,
      });

      const results = await Promise.allSettled(
        batch.map((chunkIdx) =>
          queryOverpass(queries[chunkIdx]).then((r) => ({ chunkIndex: chunkIdx, result: r })),
        ),
      );

      for (const r of results) {
        if (r.status === "fulfilled") {
          const { chunkIndex, result } = r.value;
          let newCount = 0;
          for (const el of result.elements) {
            const uid = `${el.type}_${el.id}`;
            if (!seenIds.has(uid)) {
              seenIds.add(uid);
              allElements.push(el);
              newCount++;
            }
          }
          log.debug(`Chunk ${chunkIndex + 1}: ${result.elements.length} elements, ${newCount} new (${result.elements.length - newCount} deduped)`);
        } else {
          failedThisRound.push(batch[results.indexOf(r)]);
          log.error(`Chunk ${batch[results.indexOf(r)] + 1} failed: ${r.reason}`);
        }
        completedOverall++;
        onProgress?.({
          completedChunks: completedOverall,
          totalChunks: queries.length,
          retryRound,
          retryingCount: retryRound > 0 ? pendingIndices.length : 0,
        });
      }

      i += concurrency;
    }

    pendingIndices = failedThisRound;
    retryRound++;
  }

  const finalFailed = pendingIndices.length;

  endTotal();
  log.info(`Total: ${allElements.length} unique elements from ${queries.length} chunks (${finalFailed} permanently failed after ${retryRound - 1} retry rounds)`, {
    totalElements: allElements.length,
    totalDeduped: queries.length > 0 ? seenIds.size - allElements.length : 0,
    failedChunks: finalFailed,
    totalChunks: queries.length,
    retryRounds: retryRound - 1,
  });

  return { elements: allElements, failedChunks: finalFailed, totalChunks: queries.length };
}
