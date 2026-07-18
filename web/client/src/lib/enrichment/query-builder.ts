// ---------------------------------------------------------------------------
// Search query construction — per-category tuning + name cleanup (WS6)
// ---------------------------------------------------------------------------

import type { GeoContext, POI } from "../../types";

/**
 * Category-specific search biases.
 * Each category has lightweight context keywords that improve
 * the quality of search results from SearXNG.
 * No site: dorks — SearXNG handles multi-engine discovery;
 * Google Maps, Booking, Yelp, etc. surface naturally when relevant.
 * Geographic filtering post-search handles false positives.
 * (WS6: search query quality)
 */
const CATEGORY_SEARCH_BIAS: Record<string, { contextKeywords: string }> = {
  "Restaurant or Bar": {
    contextKeywords: "avis restaurant horaires",
  },
  "Food shop": {
    contextKeywords: "horaires magasin avis",
  },
  "Sleeping place": {
    contextKeywords: "avis hébergement tarif",
  },
  Gears: {
    contextKeywords: "avis atelier vélo réparation",
  },
};

/** Default bias for categories without specific tuning */
const DEFAULT_SEARCH_BIAS = {
  contextKeywords: "avis",
};

/**
 * Clean a POI name before using it in a search query.
 * Removes noise like parenthetical annotations, extra whitespace, etc.
 * (WS6: POI name cleanup)
 */
export function cleanPoiNameForSearch(name: string): string {
  if (!name) return "";
  let cleaned = name.trim();
  // Remove parenthetical annotations often found in OSM (e.g. "Le Zinc (closed)")
  cleaned = cleaned.replace(/\s*\([^)]*\)\s*$/, "").trim();
  // Remove trailing dashes with annotations
  cleaned = cleaned.replace(/\s*[-–]\s*(fermé|closed|temporairement|temporarily).*$/i, "").trim();
  return cleaned;
}

/**
 * Build an effective search query for a POI.
 * Cleans the POI name and adds locality for disambiguation.
 * (WS6: per-category query tuning)
 */
export function buildSearchQuery(
  poi: POI,
  locality: string | null,
  geoContext?: GeoContext | null,
): string {
  const parts: string[] = [];

  // POI name — cleaned and quoted
  const rawName = poi.name.trim();
  const cleanedName = cleanPoiNameForSearch(rawName);
  const isGeneric = !cleanedName || ["Unknown", "unnamed", ""].includes(cleanedName);

  if (!isGeneric) {
    parts.push(`"${cleanedName}"`);
  }

  // Geographic precision: locality + county/state for disambiguation
  // This is critical for filtering irrelevant results from wrong cities
  const geoTerms: string[] = [];
  if (locality) geoTerms.push(locality);
  if (geoContext?.county && geoContext.county !== locality) geoTerms.push(geoContext.county);
  if (
    geoContext?.state &&
    geoContext.state !== locality &&
    geoContext.state !== geoContext?.county
  ) {
    geoTerms.push(geoContext.state);
  }
  if (geoTerms.length > 0) {
    parts.push(geoTerms.join(" "));
  }

  // Category hint for generic names or unnamed POIs
  if (isGeneric) {
    const tagHint = Object.entries(poi.tags)
      .filter(([k]) => ["amenity", "shop", "tourism", "leisure"].includes(k))
      .map(([, v]) => v.replace(/_/g, " "))
      .join(" ");
    if (tagHint) parts.push(tagHint);
  }

  // Per-category context keywords (lightweight, no site: dorks)
  const bias = CATEGORY_SEARCH_BIAS[poi.category] ?? DEFAULT_SEARCH_BIAS;
  parts.push(bias.contextKeywords);

  return parts.join(" ");
}

export function buildQueryVariants(
  poi: POI,
  locality: string | null,
  geoContext?: GeoContext | null,
): string[] {
  const base = buildSearchQuery(poi, locality, geoContext);
  const cleanName = cleanPoiNameForSearch(poi.name);

  // Keep only 2 variants to reduce noise and request count:
  //   1. Full geo-contextual query (most precise)
  //   2. Quoted name + locality fallback (simpler, catches different title formats)
  const variants = [base, [cleanName ? `"${cleanName}"` : null, locality].filter(Boolean).join(" ")]
    .map((query) => query.trim())
    .filter(Boolean);

  return [...new Set(variants)];
}
