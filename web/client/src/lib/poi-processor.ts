// ---------------------------------------------------------------------------
// POI processor – converts raw Overpass elements into typed POIs
// Port of data_processor.py logic with deduplication and trace-distance filtering
// ---------------------------------------------------------------------------

import type { POI, TracePoint, PoiCategory } from "../types";
import type { OverpassElement } from "./overpass";
import { findCategoryForTag } from "./poi-config";
import { haversine, distanceToTrace, TraceIndex, alongTraceProjection } from "./gpx-parser";

const NON_MERGEABLE_CATEGORIES = new Set<PoiCategory>([
  "Restaurant or Bar",
  "Food shop",
  "Sleeping place",
  "Gears",
  "Medical",
  "Pharmacy",
  "Bank & ATM",
  "Post office",
  "Tourist info",
]);

let nextId = 1;
function generateId(): string {
  return `poi_${nextId++}`;
}

// ---------------------------------------------------------------------------
// Main processing function
// ---------------------------------------------------------------------------

/**
 * Process raw Overpass elements into POI objects.
 *
 * Steps:
 * 1. Match each element to a category via OSM tags
 * 2. Compute distance to nearest trace (corridor filtering)
 * 3. Deduplicate nearby POIs of the same category
 * 4. Sort by distance to trace
 *
 * @param elements - Raw Overpass API elements
 * @param traces - Array of simplified traces for distance calculation
 * @param maxDistanceM - Maximum distance from any trace to keep (default 1500m)
 * @param deduplicationRadiusM - Merge POIs within this radius (default 50m)
 * @param originalTraces - If provided, use these (full-resolution) traces
 *   for distance calculation instead of the simplified ones. This avoids
 *   missing POIs near tight curves that the 500m resampling may cut.
 *   A spatial index is built automatically so performance stays O(k) per POI.
 */
export function processElements(
  elements: OverpassElement[],
  traces: TracePoint[][],
  maxDistanceM: number = 1500,
  deduplicationRadiusM: number = 50,
  originalTraces?: TracePoint[][],
): POI[] {
  // Step 1: Convert elements to POIs
  const rawPois: POI[] = [];

  for (const el of elements) {
    const poi = elementToPoi(el);
    if (poi) rawPois.push(poi);
  }

  // Step 2: Compute distance to nearest trace and filter.
  // When original traces are available, build spatial indices for fast lookup
  // on potentially very long polylines (10k+ points for 600km routes).
  const distTraces = originalTraces ?? traces;
  const indices = distTraces.map((t) =>
    t.length > 200 ? new TraceIndex(t) : null,
  );

  const withDistance: POI[] = [];
  for (const poi of rawPois) {
    let minDist = Infinity;
    let bestTraceIdx = 0;
    for (let ti = 0; ti < distTraces.length; ti++) {
      const idx = indices[ti];
      const dist = idx
        ? idx.distanceTo(poi)
        : distanceToTrace(poi, distTraces[ti]);
      if (dist < minDist) {
        minDist = dist;
        bestTraceIdx = ti;
      }
    }
    poi.distanceToTrace = minDist;
    if (minDist <= maxDistanceM) {
      // Compute along-trace distance for ordering POIs in travel order
      poi.alongTraceDistance = alongTraceProjection(poi, distTraces[bestTraceIdx]);
      withDistance.push(poi);
    }
  }

  // Step 3: Deduplicate
  const deduped = deduplicatePois(withDistance, deduplicationRadiusM);

  // Step 4: Sort by along-trace distance (travel order from GPX start)
  deduped.sort((a, b) => a.alongTraceDistance - b.alongTraceDistance);

  return deduped;
}

// ---------------------------------------------------------------------------
// Element to POI conversion
// ---------------------------------------------------------------------------

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
    const match = findCategoryForTag(key, value);
    if (match) {
      return {
        id: generateId(),
        lat,
        lon,
        category: match.category.category,
        name: tags.name || formatFallbackName(match.category.category, key, value),
        icon: match.tag.icon,
        distanceToTrace: 0, // computed later
        alongTraceDistance: 0, // computed later
        tags,
        style: match.category.style,
        osmId: el.id,
        osmType: el.type,
      };
    }
  }

  return null;
}

function formatFallbackName(
  _category: string,
  _key: string,
  value: string,
): string {
  // Produce a readable name like "Drinking water" from "drinking_water"
  const readable = value.replace(/_/g, " ");
  return readable.charAt(0).toUpperCase() + readable.slice(1);
}

// ---------------------------------------------------------------------------
// Deduplication
// ---------------------------------------------------------------------------

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

    if (!isMergeableCategory(best.category) || effectiveRadius <= 0) {
      kept.push(best);
      continue;
    }

    for (let j = i + 1; j < pois.length; j++) {
      if (removed.has(j)) continue;
      if (pois[i].category !== pois[j].category) continue;
      if (!isMergeableCategory(pois[j].category)) continue;

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

function isMergeableCategory(category: PoiCategory): boolean {
  return !NON_MERGEABLE_CATEGORIES.has(category);
}

function computeAdaptiveDedupRadius(count: number, baseRadiusM: number): number {
  if (count >= 1200) return Math.max(baseRadiusM, 120);
  if (count >= 700) return Math.max(baseRadiusM, 80);
  if (count >= 300) return Math.max(baseRadiusM, 60);
  return baseRadiusM;
}
