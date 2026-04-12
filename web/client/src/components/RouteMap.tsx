// ---------------------------------------------------------------------------
// Map component – Leaflet map displaying the trace and POIs (neobrutalist)
// Updated with enrichment data in popups + Google Maps link
// ---------------------------------------------------------------------------

import { useEffect, useMemo } from "react";
import {
  MapContainer,
  TileLayer,
  Polyline,
  CircleMarker,
  Popup,
  useMap,
} from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import type { POI, TraceData, EnrichedData } from "../types";
import { buildGoogleMapsUrl } from "../lib/enrichment";

interface Props {
  trace: TraceData | null;
  pois: POI[];
  enrichments: Map<string, EnrichedData>;
}

function FitBounds({ trace }: { trace: TraceData | null }) {
  const map = useMap();

  useEffect(() => {
    if (!trace || trace.original.length === 0) return;

    const lats = trace.original.map((p) => p.lat);
    const lons = trace.original.map((p) => p.lon);

    const bounds: LatLngBoundsExpression = [
      [Math.min(...lats), Math.min(...lons)],
      [Math.max(...lats), Math.max(...lons)],
    ];

    map.fitBounds(bounds, { padding: [40, 40] });
  }, [trace, map]);

  return null;
}

export function RouteMap({ trace, pois, enrichments }: Props) {
  const center = useMemo<[number, number]>(() => {
    if (trace && trace.original.length > 0) {
      const mid = trace.original[Math.floor(trace.original.length / 2)];
      return [mid.lat, mid.lon];
    }
    return [46.5, 2.5];
  }, [trace]);

  const tracePositions = useMemo(
    () =>
      trace?.original.map((p) => [p.lat, p.lon] as [number, number]) ?? [],
    [trace],
  );

  return (
    <MapContainer
      center={center}
      zoom={6}
      className="route-map"
      scrollWheelZoom={true}
    >
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/">OSM</a>'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      <FitBounds trace={trace} />

      {tracePositions.length > 0 && (
        <Polyline
          positions={tracePositions}
          pathOptions={{ color: "#1a1a1a", weight: 4, opacity: 0.9 }}
        />
      )}

      {pois.map((poi) => {
        const enrichment = enrichments.get(poi.id);
        const gmapsUrl = enrichment?.googleMapsUrl ?? buildGoogleMapsUrl(poi);

        return (
          <CircleMarker
            key={poi.id}
            center={[poi.lat, poi.lon]}
            radius={8}
            pathOptions={{
              fillColor: poi.style.backgroundColor,
              fillOpacity: 1,
              color: "#1a1a1a",
              weight: 2.5,
            }}
          >
            <Popup>
              <div className="poi-popup">
                <strong>{poi.name}</strong>
                <div className="poi-popup-cat">{poi.category}</div>
                <div className="poi-popup-dist">
                  {Math.round(poi.distanceToTrace)}m from route
                </div>

                {/* Enrichment data */}
                {enrichment && enrichment.status === "done" && (
                  <div style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>
                    {enrichment.rating != null && (
                      <div>
                        <span className="poi-rating">
                          {"★".repeat(Math.round(enrichment.rating))}
                          {"☆".repeat(5 - Math.round(enrichment.rating))}
                        </span>{" "}
                        {enrichment.rating.toFixed(1)}
                        {enrichment.reviewCount != null && (
                          <span style={{ color: "#6b6b6b" }}>
                            {" "}
                            ({enrichment.reviewCount} reviews)
                          </span>
                        )}
                      </div>
                    )}
                    {enrichment.specialty && (
                      <div style={{ fontStyle: "italic", color: "#6b6b6b" }}>
                        {enrichment.specialty}
                      </div>
                    )}
                    {enrichment.hours && (
                      <div style={{ fontSize: "0.75rem" }}>
                        {enrichment.hours}
                      </div>
                    )}
                    {enrichment.summary && (
                      <div
                        style={{
                          marginTop: "0.25rem",
                          fontSize: "0.75rem",
                          lineHeight: "1.3",
                        }}
                      >
                        {enrichment.summary}
                      </div>
                    )}
                  </div>
                )}

                {/* OSM tags fallback */}
                {(!enrichment || enrichment.status !== "done") && (
                  <>
                    {poi.tags.opening_hours && (
                      <div className="text-xs mt-1">
                        Hours: {poi.tags.opening_hours}
                      </div>
                    )}
                    {poi.tags.phone && (
                      <div className="text-xs">Tel: {poi.tags.phone}</div>
                    )}
                  </>
                )}

                {poi.tags.website && (
                  <div className="text-xs">
                    <a
                      href={poi.tags.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="underline font-bold"
                    >
                      Website
                    </a>
                  </div>
                )}

                {/* Google Maps link */}
                <div style={{ marginTop: "0.5rem" }}>
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
            </Popup>
          </CircleMarker>
        );
      })}
    </MapContainer>
  );
}
