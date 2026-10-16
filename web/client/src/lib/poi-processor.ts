// POI processor: converts raw Overpass elements into typed POIs
// Tag matching, deduplication and trace-distance filtering

import type { POI, TraceData } from "../types";
import { alongTraceProjection, distanceToTrace, haversine, TraceIndex } from "./gpx-parser";
import type { OverpassElement } from "./overpass";
import { DEFAULT_MAX_DISTANCE_M, findCategoryForTag, MERGEABLE_CATEGORIES } from "./poi-config";

let nextId = 1;
function generateId(): string {
  return `poi_${nextId++}`;
}

// --- Main processing function ---

/** Same-category POIs closer than this merge (grows with POI density, see computeAdaptiveDedupRadius) */
const DEDUP_RADIUS_M = 50;

/**
 * Process raw Overpass elements into POI objects.
 *
 * Steps:
 * 1. Match each element to a category via OSM tags
 * 2. Distance to the nearest trace, on its full-resolution points (the 500 m
 *    resampling cuts tight curves); keep it if within `maxDistanceM`
 * 3. Deduplicate nearby POIs of the same category
 * 4. Sort in travel order
 */
export function processElements(
  elements: OverpassElement[],
  traces: Pick<TraceData, "id" | "original">[],
  maxDistanceM: number = DEFAULT_MAX_DISTANCE_M,
): POI[] {
  // Step 1: Convert elements to POIs
  const rawPois: POI[] = [];

  for (const el of elements) {
    const poi = elementToPoi(el);
    if (poi) rawPois.push(poi);
  }

  // Step 2: spatial indices keep long polylines (10k+ points for 600 km) fast
  const indices = traces.map((t) => (t.original.length > 200 ? new TraceIndex(t.original) : null));

  const withDistance: POI[] = [];
  for (const poi of rawPois) {
    let minDist = Infinity;
    let bestTraceIdx = 0;
    for (let ti = 0; ti < traces.length; ti++) {
      const idx = indices[ti];
      const dist = idx ? idx.distanceTo(poi) : distanceToTrace(poi, traces[ti].original);
      if (dist < minDist) {
        minDist = dist;
        bestTraceIdx = ti;
      }
    }
    poi.distanceToTrace = minDist;
    if (minDist <= maxDistanceM) {
      poi.traceId = traces[bestTraceIdx].id;
      // Along-trace distance orders POIs in travel order
      poi.alongTraceDistance = alongTraceProjection(poi, traces[bestTraceIdx].original);
      withDistance.push(poi);
    }
  }

  // Step 3: Deduplicate
  const deduped = deduplicatePois(withDistance, DEDUP_RADIUS_M);

  // Step 4: Sort by along-trace distance (travel order from GPX start)
  deduped.sort((a, b) => a.alongTraceDistance - b.alongTraceDistance);

  return deduped;
}

// --- Element to POI conversion ---

function elementToPoi(el: OverpassElement): POI | null {
  const tags = el.tags ?? {};

  // Get coordinates
  let lat: number | undefined;
  let lon: number | undefined;

  if (el.type === "node") {
    lat = el.lat;
    lon = el.lon;
  } else if (el.center) {
    lat = el.center.lat;
    lon = el.center.lon;
  }

  if (lat === undefined || lon === undefined) return null;

  // Match tags to a category
  for (const [key, value] of Object.entries(tags)) {
    const match = findCategoryForTag(key, value, tags);
    if (match) {
      return {
        id: generateId(),
        lat,
        lon,
        category: match.category.category,
        name: tags.name || formatFallbackName(value),
        icon: match.tag.icon,
        distanceToTrace: 0, // computed later
        alongTraceDistance: 0, // computed later
        traceId: "", // computed later
        tags,
        osmId: el.id,
        osmType: el.type,
      };
    }
  }

  return null;
}

function formatFallbackName(value: string): string {
  // Produce a readable name like "Drinking water" from "drinking_water"
  const readable = value.replace(/_/g, " ");
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

// --- Deduplication ---

/**
 * Remove near-duplicate POIs of the same category.
 * Keeps the one with the most OSM tags (richer metadata).
 */
function deduplicatePois(pois: POI[], radiusM: number): POI[] {
  const kept: POI[] = [];
  const removed = new Set<number>();
  const effectiveRadius = computeAdaptiveDedupRadius(pois.length, radiusM);

  for (let i = 0; i < pois.length; i++) {
    if (removed.has(i)) continue;

    let best = pois[i];

    if (!MERGEABLE_CATEGORIES[best.category] || effectiveRadius <= 0) {
      kept.push(best);
      continue;
    }

    for (let j = i + 1; j < pois.length; j++) {
      if (removed.has(j)) continue;
      if (pois[i].category !== pois[j].category) continue;

      const dist = haversine(pois[i], pois[j]);
      if (dist <= effectiveRadius) {
        // Keep the one with more tags
        if (Object.keys(pois[j].tags).length > Object.keys(best.tags).length) {
          best = pois[j];
        }
        removed.add(j);
      }
    }

    kept.push(best);
  }

  return kept;
}

function computeAdaptiveDedupRadius(count: number, baseRadiusM: number): number {
  if (count >= 1200) return Math.max(baseRadiusM, 120);
  if (count >= 700) return Math.max(baseRadiusM, 80);
  if (count >= 300) return Math.max(baseRadiusM, 60);
  return baseRadiusM;
}
