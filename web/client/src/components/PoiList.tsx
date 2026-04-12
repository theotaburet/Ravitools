// ---------------------------------------------------------------------------
// POI list component (neobrutalist) – with enrichment data
// ---------------------------------------------------------------------------

import type { POI, EnrichedData } from "../types";
import { buildGoogleMapsUrl } from "../lib/enrichment";

interface Props {
  pois: POI[];
  enrichments: Map<string, EnrichedData>;
}

export function PoiList({ pois, enrichments }: Props) {
  if (pois.length === 0) return null;

  return (
    <div className="neo-box overflow-hidden">
      <div className="poi-list-header">
        POIs along route ({pois.length})
      </div>
      <div className="max-h-[400px] overflow-y-auto">
        {pois.slice(0, 200).map((poi) => {
          const enrichment = enrichments.get(poi.id);
          const gmapsUrl = enrichment?.googleMapsUrl ?? buildGoogleMapsUrl(poi);

          return (
            <div key={poi.id} className="poi-list-item">
              <span
                className="poi-list-dot"
                style={{ backgroundColor: poi.style.backgroundColor }}
              />
              <div className="flex-1 min-w-0">
                <div className="poi-list-name">{poi.name}</div>
                <div className="poi-list-meta">
                  {poi.category} &middot; {Math.round(poi.distanceToTrace)}m
                  {poi.tags.opening_hours && ` · ${poi.tags.opening_hours}`}
                </div>

                {/* Enrichment data */}
                {enrichment && enrichment.status === "done" && (
                  <>
                    <div className="poi-enrichment-meta">
                      {enrichment.rating != null && (
                        <span className="poi-rating">
                          {"★".repeat(Math.round(enrichment.rating))}
                          {"☆".repeat(5 - Math.round(enrichment.rating))}
                          {" "}
                          {enrichment.rating.toFixed(1)}
                        </span>
                      )}
                      {enrichment.reviewCount != null && (
                        <span> ({enrichment.reviewCount} reviews)</span>
                      )}
                      {enrichment.specialty && (
                        <span> · {enrichment.specialty}</span>
                      )}
                      {enrichment.priceLevel != null && (
                        <span>
                          {" · "}
                          {"$".repeat(enrichment.priceLevel)}
                        </span>
                      )}
                    </div>
                    {enrichment.hours && (
                      <div className="poi-enrichment-meta">
                        {enrichment.hours}
                      </div>
                    )}
                    {enrichment.summary && (
                      <div className="poi-enrichment-summary">
                        {enrichment.summary}
                      </div>
                    )}
                  </>
                )}

                {/* Google Maps link – always shown */}
                <a
                  href={gmapsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="poi-gmaps-link"
                >
                  Google Maps →
                </a>
              </div>
            </div>
          );
        })}
        {pois.length > 200 && (
          <div className="px-3 py-2 text-center text-xs text-muted italic border-t border-black/15">
            ...and {pois.length - 200} more. Export to see all.
          </div>
        )}
      </div>
    </div>
  );
}
