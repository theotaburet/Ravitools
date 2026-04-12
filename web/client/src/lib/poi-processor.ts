// ---------------------------------------------------------------------------
// POI processor – converts raw Overpass elements into typed POIs
// Port of data_processor.py logic with deduplication and trace-distance filtering
// ---------------------------------------------------------------------------

import type { POI, TracePoint, PoiCategory } from "../types";
import type { OverpassElement } from "./overpass";
import { findCategoryForTag } from "./poi-config";
import { haversine, distanceToTrace } from "./gpx-parser";

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
 * 2. Compute distance to trace (corridor filtering)
 * 3. Deduplicate nearby POIs of the same category
 * 4. Sort by distance to trace
 *
 * @param elements - Raw Overpass API elements
 * @param trace - Simplified trace for distance calculation
 * @param maxDistanceM - Maximum distance from trace to keep (default 1500m)
 * @param deduplicationRadiusM - Merge POIs within this radius (default 50m)
 */
export function processElements(
  elements: OverpassElement[],
  trace: TracePoint[],
  maxDistanceM: number = 1500,
  deduplicationRadiusM: number = 50,
): POI[] {
  // Step 1: Convert elements to POIs
  const rawPois: POI[] = [];

  for (const el of elements) {
    const poi = elementToPoi(el);
    if (poi) rawPois.push(poi);
  }

  // Step 2: Compute distance to trace and filter
  const withDistance: POI[] = [];
  for (const poi of rawPois) {
    const dist = distanceToTrace(poi, trace);
    poi.distanceToTrace = dist;
    if (dist <= maxDistanceM) {
      withDistance.push(poi);
    }
  }

  // Step 3: Deduplicate
  const deduped = deduplicatePois(withDistance, deduplicationRadiusM);

  // Step 4: Sort by distance to trace
  deduped.sort((a, b) => a.distanceToTrace - b.distanceToTrace);

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
  category: string,
  key: string,
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

  for (let i = 0; i < pois.length; i++) {
    if (removed.has(i)) continue;

    let best = pois[i];

    for (let j = i + 1; j < pois.length; j++) {
      if (removed.has(j)) continue;
      if (pois[i].category !== pois[j].category) continue;

      const dist = haversine(pois[i], pois[j]);
      if (dist <= radiusM) {
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
