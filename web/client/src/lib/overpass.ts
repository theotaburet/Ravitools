// Overpass query builder & client

import type { PoiCategory, TracePoint } from "../types";
import { dlog } from "./debug-log";
import { API_BASE } from "./enrichment/proxy-api";
import { POI_CATEGORIES } from "./poi-config";

// Static build (VITE_STANDALONE=true, e.g. GitHub Pages): no proxy, the browser
// asks Overpass itself. Both mirrors send CORS headers; each retry round moves on to the next.
const DIRECT_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://maps.mail.ru/osm/tools/overpass/api/interpreter",
];

const OVERPASS_CACHE_MAX_ENTRIES = 50;
// TTL so stale OSM data isn't served for the whole page lifetime.
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

// --- Query building ---

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

/** Simplified points per Overpass query: bounds the query size */
const MAX_POINTS_PER_QUERY = 50;
/** Failed chunks keep retrying until this budget is spent: an outage passes without a click */
const RETRY_BUDGET_MS = 8 * 60_000;

/** Split trace points into overlapping chunks (overlap avoids boundary gaps). */
export function chunkPoints(
  points: TracePoint[],
  maxPointsPerQuery: number = MAX_POINTS_PER_QUERY,
): TracePoint[][] {
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
 * Halve a chunk (1-point overlap): used when a chunk keeps failing: POI-dense
 * areas (cities) time Overpass out, and a smaller corridor is much cheaper.
 */
export function splitChunk(points: TracePoint[]): TracePoint[][] {
  if (points.length < 4) return [points];
  const mid = Math.floor(points.length / 2);
  return [points.slice(0, mid + 1), points.slice(mid)];
}

// --- Overpass API communication (via proxy) ---

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
  /** Set on a server-side failure answered with 200 (e.g. "runtime error: Query timed out") */
  remark?: string;
}

/**
 * One Overpass request: through the server proxy, which tries every mirror, or
 * straight to a mirror in the static build (`attempt` picks it, so a retry
 * round moves on to the next). Throws on any failure: queryAllPois retries.
 */
export async function queryOverpass(
  query: string,
  attempt = 0,
  signal?: AbortSignal,
): Promise<OverpassResponse> {
  const log = dlog("overpass");
  const cached = cacheGet(query);
  if (cached) {
    log.info("Client cache hit", { elements: cached.elements.length, queryChars: query.length });
    return cached;
  }

  const endTimer = log.time(`Overpass fetch (attempt ${attempt + 1})`);
  const res =
    import.meta.env.VITE_STANDALONE === "true"
      ? await fetch(DIRECT_URLS[attempt % DIRECT_URLS.length], {
          method: "POST",
          body: new URLSearchParams({ data: query }),
          signal,
        })
      : await fetch(`${API_BASE}/overpass`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query }),
          signal,
        });

  if (!res.ok) {
    endTimer();
    const body = await res.text();
    throw new Error(`Overpass error (${res.status}): ${body.slice(0, 200)}`);
  }

  const data: OverpassResponse = await res.json();
  const elapsedMs = endTimer();
  // A timed-out query still answers 200, with partial elements: a failure, not a result
  if (data.remark?.includes("runtime error")) throw new Error(`Overpass ${data.remark}`);
  log.info(`Got ${data.elements.length} elements`, {
    elements: data.elements.length,
    elapsedMs: Math.round(elapsedMs),
    serverCache: res.headers.get("X-Cache") || "UNKNOWN",
    queryChars: query.length,
  });
  cacheSet(query, data);
  return data;
}

/** Result of queryAllPois: includes chunk failure info for user feedback */
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
 * Query Overpass for all categories along a trace, one chunk at a time
 * (Overpass-friendly). Returns raw elements from all chunks, deduplicated by
 * OSM ID, plus chunk failure counts so the caller can warn the user.
 *
 * The only retry level: failed chunks go again in rounds with a growing
 * backoff until RETRY_BUDGET_MS is spent. A chunk too heavy for Overpass (a
 * POI-dense city corridor times it out) is split in four and retried at once. An aborted
 * `signal` stops between chunks and cancels the request in flight.
 *
 * One point list per trace: chunks never span two traces, since `around:`
 * over several points is a polyline and would scan the gap between them.
 */
export async function queryAllPois(
  traces: TracePoint[][],
  radiusM: number = 1000,
  categories?: PoiCategory[],
  onProgress?: (progress: QueryProgress) => void,
  signal?: AbortSignal,
): Promise<QueryAllPoisResult> {
  const log = dlog("overpass");
  const initialChunks = traces.flatMap((points) => chunkPoints(points));

  log.info(`Built ${initialChunks.length} chunks from ${traces.length} traces`, {
    chunks: initialChunks.length,
    traces: traces.length,
    radiusM,
  });

  const seenIds = new Set<string>();
  const allElements: OverpassElement[] = [];
  let dedupedCount = 0; // running count of cross-chunk duplicates dropped

  let pending: TracePoint[][] = initialChunks;
  let totalChunks = initialChunks.length;
  let completed = 0;
  let retryRound = 0;

  const endTotal = log.time(`All ${initialChunks.length} chunks`);
  const startedAt = Date.now();

  while (pending.length > 0 && Date.now() - startedAt < RETRY_BUDGET_MS) {
    if (retryRound > 0) {
      // Backoff before retry round: 10s, 20s, 30s... capped at 60s
      const backoffMs = Math.min(10_000 * retryRound, 60_000);
      log.warn(
        `Retry round ${retryRound}: ${pending.length} chunks to retry after ${backoffMs / 1000}s backoff`,
        { retryRound, pendingCount: pending.length, backoffMs },
      );
      await new Promise((r) => setTimeout(r, backoffMs));
    }

    const failedThisRound: TracePoint[][] = [];

    for (const chunk of pending) {
      signal?.throwIfAborted();
      try {
        const result = await queryOverpass(
          buildOverpassQuery(chunk, radiusM, categories),
          retryRound,
          signal,
        );
        completed++;
        let newCount = 0;
        for (const el of result.elements) {
          const uid = `${el.type}_${el.id}`;
          if (!seenIds.has(uid)) {
            seenIds.add(uid);
            allElements.push(el);
            newCount++;
          }
        }
        dedupedCount += result.elements.length - newCount;
        log.debug(`Chunk ok: ${result.elements.length} elements, ${newCount} new`);
      } catch (err) {
        signal?.throwIfAborted();
        if (/runtime error|\(504\)/.test(String(err)) && chunk.length >= 4) {
          // Too heavy, not a sick server: the quarters join this round (the
          // loop reaches what is pushed), no backoff
          const quarters = splitChunk(chunk).flatMap(splitChunk);
          pending.push(...quarters);
          totalChunks += quarters.length - 1;
          log.warn(`Chunk of ${chunk.length} pts timed out: split, retried now`);
        } else {
          failedThisRound.push(chunk);
          log.error(`Chunk failed: ${err}`);
        }
      }
      onProgress?.({
        completedChunks: completed,
        totalChunks,
        retryRound,
        retryingCount: retryRound > 0 ? pending.length : 0,
      });
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
