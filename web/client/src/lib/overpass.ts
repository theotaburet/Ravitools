// ---------------------------------------------------------------------------
// Overpass query builder & client
// Port of overpass_client.py logic, adapted for client-heavy architecture
// ---------------------------------------------------------------------------

import type { TracePoint, PoiCategory } from "../types";
import { POI_CATEGORIES } from "./poi-config";

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
  const cached = overpassResultCache.get(query);
  if (cached) {
    return cached;
  }

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    if (attempt > 0) {
      // Exponential backoff: 5s, 10s, 15s
      await new Promise((r) => setTimeout(r, 5000 * attempt));
    }

    try {
      const res = await fetch(`${PROXY_BASE}/overpass`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query }),
      });

      if (res.status === 429 || res.status === 504) {
        // Rate limited or timeout – wait and retry
        lastError = new Error(
          res.status === 429
            ? "Rate limited by proxy"
            : "Overpass server timeout",
        );
        continue;
      }

      if (!res.ok) {
        const body = await res.text();
        throw new Error(
          `Overpass error (${res.status}): ${body.slice(0, 200)}`,
        );
      }

      const data: OverpassResponse = await res.json();
      overpassResultCache.set(query, data);
      return data;
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retries) continue;
    }
  }

  throw lastError ?? new Error("Overpass query failed");
}

/**
 * Query Overpass for all categories along a trace, chunking if necessary.
 * Returns raw elements from all chunks, deduplicated by OSM ID.
 */
export async function queryAllPois(
  simplifiedPoints: TracePoint[],
  radiusM: number = 1000,
  categories?: PoiCategory[],
  onProgress?: (done: number, total: number) => void,
): Promise<OverpassElement[]> {
  const queries = buildChunkedQueries(
    simplifiedPoints,
    radiusM,
    25,
    categories,
  );

  const seenIds = new Set<string>();
  const allElements: OverpassElement[] = [];

  for (let i = 0; i < queries.length; i++) {
    onProgress?.(i, queries.length);

    const result = await queryOverpass(queries[i]);

    for (const el of result.elements) {
      const uid = `${el.type}_${el.id}`;
      if (!seenIds.has(uid)) {
        seenIds.add(uid);
        allElements.push(el);
      }
    }
  }

  onProgress?.(queries.length, queries.length);
  return allElements;
}
