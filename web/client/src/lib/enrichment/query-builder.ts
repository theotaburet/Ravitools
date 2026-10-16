// --- Search query construction: per-category tuning + name cleanup ---

import type { POI } from "../../types";
import { isGenericPoiName } from "./deterministic";
import { type SearchLanguage, WORDS } from "./vocabulary";

/**
 * Per-category context words in the country's language. Lightweight, no site:
 * dorks: SearXNG handles multi-engine discovery and geographic filtering
 * handles false positives afterwards. The category word doubles as a type hint.
 */
function contextKeywords(category: string, language: SearchLanguage): string {
  const w = WORDS[language];
  switch (category) {
    case "Restaurant or Bar":
      return `${w.reviews} ${w.restaurant} ${w.hours}`;
    case "Food shop":
      return `${w.hours} ${w.shop} ${w.reviews}`;
    case "Sleeping place":
      return `${w.reviews} ${w.lodging} ${w.prices}`;
    case "Gears":
      return `${w.reviews} ${w.bikeShop}`;
    default:
      return w.reviews;
  }
}

/**
 * Clean a POI name before using it in a search query.
 * Removes noise like parenthetical annotations, extra whitespace, etc.
 *
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
 *
 */
export function buildSearchQuery(
  poi: POI,
  locality: string | null,
  language: SearchLanguage = "en",
): string {
  const parts: string[] = [];

  // POI name: cleaned and quoted
  const cleanedName = cleanPoiNameForSearch(poi.name);
  const isGeneric = isGenericPoiName(cleanedName);

  if (!isGeneric) {
    parts.push(`"${cleanedName}"`);
  }

  // Locality only: adding county and region made Bing drift to regional portals.
  if (locality) parts.push(locality);

  // Generic or no name (single-POI enrichment does not skip those): the OSM tags hint the type
  if (isGeneric) {
    const tagHint = Object.entries(poi.tags)
      .filter(([k]) => ["amenity", "shop", "tourism", "leisure"].includes(k))
      .map(([, v]) => v.replace(/_/g, " "))
      .join(" ");
    if (tagHint) parts.push(tagHint);
  }

  parts.push(contextKeywords(poi.category, language));

  return parts.join(" ");
}

export function buildQueryVariants(
  poi: POI,
  locality: string | null,
  language: SearchLanguage = "en",
): string[] {
  const base = buildSearchQuery(poi, locality, language);
  const cleanName = cleanPoiNameForSearch(poi.name);

  // Keep only 2 variants to reduce noise and request count:
  //   1. Full geo-contextual query (most precise)
  //   2. Quoted name + locality fallback (simpler, catches different title formats)
  const variants = [base, [cleanName ? `"${cleanName}"` : null, locality].filter(Boolean).join(" ")]
    .map((query) => query.trim())
    .filter(Boolean);

  return [...new Set(variants)];
}
