// ---------------------------------------------------------------------------
// Overpass query builder & client
// Port of overpass_client.py logic, adapted for client-heavy architecture
// ---------------------------------------------------------------------------

import type { PoiCategory, TracePoint } from "../types";
import { dlog } from "./debug-log";
import { POI_CATEGORIES } from "./poi-config";

/** Proxy base URL – in dev, Vite proxies /api to the server */
const PROXY_BASE =
  (typeof window !== "undefined" &&
    ((window as unknown as Record<string, unknown>).__RAVITOOLS_API_URL__ as string)) ||
  "/api";

const OVERPASS_CACHE_MAX_ENTRIES = 50;
// ponytail: TTL so stale OSM data isn't served for the whole page lifetime (AUDIT C4).
// OSM POIs don't change minute-to-minute; 1h is plenty for a planning session.
const OVERPASS_CACHE_TTL_MS = 60 * 60 * 1000;
const overpassResultCache = new Map<string, { value: OverpassResponse; ts: number }>();

/** Evict oldest entries when cache exceeds max size (simple FIFO). */
function cacheSet(key: string, value: OverpassResponse) {
  if (overpassResultCache.size >= OVERPASS_CACHE_MAX_ENTRIES) {
    // Map iteration order = insertion order → first key is oldest
    const oldest = overpassResultCache.keys().next().value;
    if (oldest !== undefined) overpassResultCache.delete(oldest);
  }
  overpassResultCache.set(key, { value, ts: Date.now() });
}

/** Read a cache entry, dropping it if older than the TTL. */
function cacheGet(key: string): OverpassResponse | undefined {
  const entry = overpassResultCache.get(key);
  if (!entry) return undefined;
  if (Date.now() - entry.ts > OVERPASS_CACHE_TTL_MS) {
    overpassResultCache.delete(key);
    return undefined;
  }
  return entry.value;
}

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
      let group = tagGroups.get(tag.key);
      if (!group) {
        group = new Set();
        tagGroups.set(tag.key, group);
      }
      group.add(tag.value);
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
/** Split trace points into overlapping chunks (overlap avoids boundary gaps). */
export function chunkPoints(points: TracePoint[], maxPointsPerQuery: number = 25): TracePoint[][] {
  if (points.length <= maxPointsPerQuery) return [points];
  const chunks: TracePoint[][] = [];
  const overlap = 3;
  for (let i = 0; i < points.length; i += maxPointsPerQuery - overlap) {
    const chunk = points.slice(i, i + maxPointsPerQuery);
    if (chunk.length >= 2) chunks.push(chunk);
  }
  return chunks;
}

/**
 * Halve a chunk (1-point overlap) — used when a chunk keeps failing: POI-dense
 * areas (cities) time Overpass out, and a smaller corridor is much cheaper.
 */
export function splitChunk(points: TracePoint[]): TracePoint[][] {
  if (points.length < 4) return [points];
  const mid = Math.floor(points.length / 2);
  return [points.slice(0, mid + 1), points.slice(mid)];
}

export function buildChunkedQueries(
  points: TracePoint[],
  radiusM: number = 1000,
  maxPointsPerQuery: number = 25,
  categories?: PoiCategory[],
): string[] {
  return chunkPoints(points, maxPointsPerQuery).map((chunk) =>
    buildOverpassQuery(chunk, radiusM, categories),
  );
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
export async function queryOverpass(query: string, retries: number = 3): Promise<OverpassResponse> {
  const log = dlog("overpass");
  const cached = cacheGet(query);
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
        throw new Error(`Overpass error (${res.status}): ${body.slice(0, 200)}`);
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
      cacheSet(query, data);
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
  concurrency: number = 1,
  maxRetryRounds: number = 3,
): Promise<QueryAllPoisResult> {
  const log = dlog("overpass");
  const initialChunks = chunkPoints(simplifiedPoints, maxPointsPerQuery);

  log.info(
    `Built ${initialChunks.length} chunks from ${simplifiedPoints.length} simplified points`,
    {
      chunks: initialChunks.length,
      simplifiedPoints: simplifiedPoints.length,
      radiusM,
      maxPointsPerQuery,
      concurrency,
    },
  );

  const seenIds = new Set<string>();
  const allElements: OverpassElement[] = [];
  let dedupedCount = 0; // running count of cross-chunk duplicates dropped (AUDIT C+1)

  // Chunks are point arrays, not query strings: a chunk that keeps failing
  // (POI-dense city area → Overpass timeout) is split in two for the next
  // round — smaller corridors are much cheaper server-side.
  let pending: TracePoint[][] = initialChunks;
  let totalChunks = initialChunks.length;
  let completed = 0;
  let retryRound = 0;

  const endTotal = log.time(`All ${initialChunks.length} chunks`);

  while (pending.length > 0 && retryRound <= maxRetryRounds) {
    if (retryRound > 0) {
      // Backoff before retry round: 10s, 20s, 30s
      const backoffMs = 10_000 * retryRound;
      log.warn(
        `Retry round ${retryRound}/${maxRetryRounds}: ${pending.length} chunks to retry after ${backoffMs / 1000}s backoff`,
        { retryRound, pendingCount: pending.length, backoffMs },
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }

    const failedThisRound: TracePoint[][] = [];

    // Process pending chunks with limited concurrency
    let i = 0;
    while (i < pending.length) {
      const batch = pending.slice(i, i + concurrency);

      const results = await Promise.allSettled(
        batch.map((chunk) =>
          queryOverpass(buildOverpassQuery(chunk, radiusM, categories)).then((result) => result),
        ),
      );

      for (const [j, r] of results.entries()) {
        if (r.status === "fulfilled") {
          completed++;
          let newCount = 0;
          for (const el of r.value.elements) {
            const uid = `${el.type}_${el.id}`;
            if (!seenIds.has(uid)) {
              seenIds.add(uid);
              allElements.push(el);
              newCount++;
            }
          }
          dedupedCount += r.value.elements.length - newCount;
          log.debug(`Chunk ok: ${r.value.elements.length} elements, ${newCount} new`);
        } else {
          const chunk = batch[j];
          if (retryRound < maxRetryRounds && chunk.length >= 4) {
            const halves = splitChunk(chunk);
            failedThisRound.push(...halves);
            totalChunks += halves.length - 1;
            log.warn(`Chunk of ${chunk.length} pts failed — split for next round: ${r.reason}`);
          } else {
            failedThisRound.push(chunk);
            log.error(`Chunk failed: ${r.reason}`);
          }
        }
        onProgress?.({
          completedChunks: completed,
          totalChunks,
          retryRound,
          retryingCount: retryRound > 0 ? pending.length : 0,
        });
      }

      i += concurrency;
    }

    pending = failedThisRound;
    retryRound++;
  }

  const finalFailed = pending.length;

  endTotal();
  log.info(
    `Total: ${allElements.length} unique elements from ${totalChunks} chunks (${finalFailed} permanently failed after ${retryRound - 1} retry rounds)`,
    {
      totalElements: allElements.length,
      totalDeduped: dedupedCount,
      failedChunks: finalFailed,
      totalChunks,
      retryRounds: retryRound - 1,
    },
  );

  return { elements: allElements, failedChunks: finalFailed, totalChunks };
}
