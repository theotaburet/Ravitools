// ---------------------------------------------------------------------------
// GeoJSON Export – for web/apps that prefer GeoJSON
// ---------------------------------------------------------------------------

import type { EnrichedData, POI } from "../../types";
import { downloadFile } from "./shared";

export function exportToGeoJson(
  pois: POI[],
  filename: string = "ravitools-pois",
  enrichments?: Map<string, EnrichedData>,
): void {
  const geojson = buildGeoJsonObject(pois, enrichments);
  downloadFile(JSON.stringify(geojson, null, 2), `${filename}.geojson`, "application/geo+json");
}

export function buildGeoJsonObject(
  pois: POI[],
  enrichments?: Map<string, EnrichedData>,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: pois.map((poi) => {
      const enrichment = enrichments?.get(poi.id);
      const enrichmentProps =
        enrichment && enrichment.status === "done"
          ? {
              enrichment_rating: enrichment.rating,
              enrichment_reviewCount: enrichment.reviewCount,
              enrichment_hours: enrichment.hours,
              enrichment_openingHours: enrichment.openingHours
                ? enrichment.openingHours
                    .map(
                      (e) =>
                        `${e.day}: ${e.open === "closed" ? "Closed" : `${e.open}-${e.close ?? ""}`}`,
                    )
                    .join("; ")
                : null,
              enrichment_description: enrichment.description,
              enrichment_review: enrichment.review,
              enrichment_priceLevel: enrichment.priceLevel,
              enrichment_googleMapsUrl: enrichment.googleMapsUrl,
              enrichment_locality: enrichment.locality,
              enrichment_sourceCount: enrichment.sourceCount,
              enrichment_sourceEngines: enrichment.sourceEngines.join(","),
              enrichment_confidence: enrichment.confidence,
              enrichment_synthesisSource: enrichment.synthesisSource ?? null,
              enrichment_synthesisReason: enrichment.synthesisReason ?? null,
              enrichment_googleMapsFields: enrichment.googleMapsFields?.join(",") ?? null,
              enrichment_structured_headline: enrichment.structured?.headline ?? null,
              enrichment_structured_operationalSummary:
                enrichment.structured?.operationalSummary ?? null,
              enrichment_structured_practicalities:
                enrichment.structured?.practicalities.join(" | ") ?? null,
              enrichment_structured_cautions: enrichment.structured?.cautions.join(" | ") ?? null,
              enrichment_structured_unknowns: enrichment.structured?.unknowns.join(" | ") ?? null,
              enrichment_structured_sourceRollup:
                enrichment.structured?.sourceRollup
                  .map((digest) => `${digest.platform}: ${digest.brief}`)
                  .join(" | ") ?? null,
              enrichment_structured_divergences:
                enrichment.structured?.divergences?.join(" | ") ?? null,
              enrichment_structured_sourceConfirmation:
                enrichment.structured?.sourceConfirmation ?? null,
            }
          : {};

      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [poi.lon, poi.lat],
        },
        properties: {
          name: poi.name,
          category: poi.category,
          icon: poi.icon,
          distanceToTrace: Math.round(poi.distanceToTrace),
          ...poi.tags,
          ...enrichmentProps,
        },
      };
    }),
  };
}
