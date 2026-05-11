// ---------------------------------------------------------------------------
// POI enrichment cache — client
//
// Wraps the server's /poi/* endpoints. Anonymous shared cache: a POI enriched
// by user A is reused by user B if requested within the TTL window.
//
// Graceful degradation: any network/HTTP error (including 503 when the server
// has no DATABASE_URL) returns null/empty without throwing — the enrichment
// pipeline keeps working as if no cache existed.
// ---------------------------------------------------------------------------

import type { POI, EnrichedData } from "../types";

const API_BASE = "/api";

const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_MAX_AGE_DAYS = 90;

export interface CachedEnrichment {
  osm_type: "node" | "way" | "relation";
  osm_id: string;
  category: string;
  lat: number;
  lon: number;
  name: string | null;
  enrichment: EnrichedData;
  enriched_at: string;
  is_stale: boolean;
}

interface BatchResponse {
  requested: number;
  hits: number;
  misses: number;
  results: CachedEnrichment[];
}

/** A POI is cacheable iff it has both osmType and osmId from OSM. */
export function isCacheablePoi(poi: POI): poi is POI & { osmId: number; osmType: "node" | "way" | "relation" } {
  return typeof poi.osmId === "number" && Number.isFinite(poi.osmId) && poi.osmId > 0
    && (poi.osmType === "node" || poi.osmType === "way" || poi.osmType === "relation");
}

function poiCacheKey(poi: POI): string | null {
  if (!isCacheablePoi(poi)) return null;
  return `${poi.osmType}/${poi.osmId}`;
}

/**
 * Batch lookup: returns a Map keyed by `osm_type/osm_id` for the POIs that have
 * a cached enrichment. POIs without osmId/osmType are silently skipped.
 *
 * Returns an empty Map on any failure (network, 503, malformed body).
 */
export async function lookupPoiBatch(
  pois: POI[],
  maxAgeDays: number = DEFAULT_MAX_AGE_DAYS,
): Promise<Map<string, CachedEnrichment>> {
  const result = new Map<string, CachedEnrichment>();
  const cacheable = pois.filter(isCacheablePoi);
  if (cacheable.length === 0) return result;

  const keys = cacheable.map((p) => ({
    osm_type: p.osmType,
    osm_id: String(p.osmId),
  }));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(`${API_BASE}/poi/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ keys, max_age_days: maxAgeDays }),
      signal: controller.signal,
    });
    if (!res.ok) return result;
    const body = (await res.json()) as BatchResponse;
    if (!Array.isArray(body?.results)) return result;
    for (const r of body.results) {
      result.set(`${r.osm_type}/${r.osm_id}`, r);
    }
    return result;
  } catch {
    return result;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Push an enrichment result to the shared cache.
 * No-op (returns false) if the POI has no osm identifier or any error occurs.
 */
export async function uploadPoiEnrichment(
  poi: POI,
  enrichment: EnrichedData,
): Promise<boolean> {
  if (!isCacheablePoi(poi)) return false;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(
      `${API_BASE}/poi/${poi.osmType}/${poi.osmId}`,
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: poi.category,
          lat: poi.lat,
          lon: poi.lon,
          name: poi.name,
          enrichment,
        }),
        signal: controller.signal,
      },
    );
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

/** Helper exposed for tests / callers that need to map a POI to its cache key */
export function getPoiCacheKey(poi: POI): string | null {
  return poiCacheKey(poi);
}
