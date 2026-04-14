// ---------------------------------------------------------------------------
// Map component – Leaflet map displaying traces and POIs (neobrutalist)
// Supports multiple traces with distinct colors, legend, and hover highlight
// ---------------------------------------------------------------------------

import { useEffect, useMemo, useRef, useCallback, useState } from "react";
import {
  MapContainer,
  TileLayer,
  Polyline,
  Marker,
  Popup,
  Tooltip,
  useMap,
} from "react-leaflet";
import type { LatLngBoundsExpression } from "leaflet";
import L from "leaflet";
import type { POI, TraceData, EnrichedData, TargetLanguage } from "../types";
import { buildGoogleMapsUrl } from "../lib/enrichment";
import { CATEGORY_EMOJI } from "../lib/poi-config";
import { translateCategory, translatePoiName } from "../lib/i18n";
import { getAvailabilityTags } from "../lib/export";

interface Props {
  traces: TraceData[];
  pois: POI[];
  enrichments: Map<string, EnrichedData>;
  selectedPoiId?: string | null;
  onSelectPoi?: (poiId: string | null) => void;
  /** IDs of POIs currently being enriched (pulsing animation on all in-flight) */
  enrichingPoiIds?: Set<string> | null;
  /** Target language for i18n */
  targetLanguage?: TargetLanguage;
}

function FitBounds({ traces }: { traces: TraceData[] }) {
  const map = useMap();

  useEffect(() => {
    const allPoints = traces.flatMap((t) => t.original);
    if (allPoints.length === 0) return;

    const lats = allPoints.map((p) => p.lat);
    const lons = allPoints.map((p) => p.lon);

    const bounds: LatLngBoundsExpression = [
      [Math.min(...lats), Math.min(...lons)],
      [Math.max(...lats), Math.max(...lons)],
    ];

    map.fitBounds(bounds, { padding: [40, 40] });
  }, [traces, map]);

  return null;
}

/** Fly to selected POI and open its popup */
function FlyToSelected({
  selectedPoiId,
  markerRefs,
}: {
  selectedPoiId: string | null;
  markerRefs: React.MutableRefObject<Map<string, L.Marker>>;
}) {
  const map = useMap();

  useEffect(() => {
    if (!selectedPoiId) return;
    const marker = markerRefs.current.get(selectedPoiId);
    if (!marker) return;

    const latlng = marker.getLatLng();
    map.flyTo(latlng, Math.max(map.getZoom(), 14), { duration: 0.6 });

    // Open popup after fly animation
    setTimeout(() => {
      marker.openPopup();
    }, 650);
  }, [selectedPoiId, map, markerRefs]);

  return null;
}

export function RouteMap({ traces, pois, enrichments, selectedPoiId, onSelectPoi, enrichingPoiIds, targetLanguage = "en" }: Props) {
  const markerRefs = useRef<Map<string, L.Marker>>(new Map());
  const [highlightedTraceId, setHighlightedTraceId] = useState<string | null>(null);

  const center = useMemo<[number, number]>(() => {
    const allPoints = traces.flatMap((t) => t.original);
    if (allPoints.length > 0) {
      const mid = allPoints[Math.floor(allPoints.length / 2)];
      return [mid.lat, mid.lon];
    }
    return [46.5, 2.5];
  }, [traces]);

  const setMarkerRef = useCallback((poiId: string, el: L.Marker | null) => {
    if (el) {
      markerRefs.current.set(poiId, el);
    } else {
      markerRefs.current.delete(poiId);
    }
  }, []);

  const handleMarkerClick = useCallback(
    (poiId: string) => {
      if (!onSelectPoi) return;
      onSelectPoi(selectedPoiId === poiId ? null : poiId);
    },
    [onSelectPoi, selectedPoiId],
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

      <FitBounds traces={traces} />
      <FlyToSelected selectedPoiId={selectedPoiId ?? null} markerRefs={markerRefs} />

      {/* Render each trace as a distinct Polyline */}
      {traces.map((trace) => {
        const positions = trace.original.map((p) => [p.lat, p.lon] as [number, number]);
        if (positions.length === 0) return null;

        const isHighlighted = highlightedTraceId === trace.id;
        const isDimmed = highlightedTraceId !== null && !isHighlighted;

        const distanceKm = (trace.totalDistanceM / 1000).toFixed(1);
        const elevationLabel = trace.elevationGainM > 0 || trace.elevationLossM > 0
          ? `↑${trace.elevationGainM}m ↓${trace.elevationLossM}m`
          : "";

        return (
          <Polyline
            key={trace.id}
            positions={positions}
            pathOptions={{
              color: trace.color,
              weight: isHighlighted ? 6 : 4,
              opacity: isDimmed ? 0.3 : 0.9,
            }}
            eventHandlers={{
              mouseover: () => setHighlightedTraceId(trace.id),
              mouseout: () => setHighlightedTraceId(null),
            }}
          >
            <Tooltip sticky>
              {trace.name ?? trace.id} · {distanceKm} km {elevationLabel}
            </Tooltip>
          </Polyline>
        );
      })}

      {pois.map((poi) => {
        const enrichment = enrichments.get(poi.id);
        const gmapsUrl = enrichment?.googleMapsUrl ?? buildGoogleMapsUrl(poi);
        const isSelected = selectedPoiId === poi.id;
        const isEnriching = enrichingPoiIds?.has(poi.id) ?? false;
        const emoji = CATEGORY_EMOJI[poi.category] ?? "📍";
        const size = isSelected ? 32 : 24;

        const markerClasses = [
          "poi-marker",
          isSelected ? "poi-marker-selected" : "",
          isEnriching ? "poi-marker-enriching" : "",
        ].filter(Boolean).join(" ");

        const icon = L.divIcon({
          className: "poi-marker-icon",
          html: `<div class="${markerClasses}" style="border-color:${poi.style.backgroundColor};width:${size}px;height:${size}px">${emoji}</div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
          popupAnchor: [0, -size / 2],
        });

        return (
          <Marker
            key={poi.id}
            ref={(el) => setMarkerRef(poi.id, el as unknown as L.Marker | null)}
            position={[poi.lat, poi.lon]}
            icon={icon}
            eventHandlers={{
              click: () => handleMarkerClick(poi.id),
            }}
          >
            <Popup>
              <div className="poi-popup">
                <strong>{translatePoiName(poi.name, targetLanguage)}</strong>
                <div className="poi-popup-cat">{translateCategory(poi.category, targetLanguage)}</div>
                <div className="poi-popup-dist">
                  km {(poi.alongTraceDistance / 1000).toFixed(1)} &middot; {Math.round(poi.distanceToTrace)}m from route
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
                        {enrichment.priceLevel != null && (
                          <span style={{ color: "#6b6b6b" }}>
                            {" · "}{"$".repeat(enrichment.priceLevel)}
                          </span>
                        )}
                      </div>
                    )}
                    {enrichment.openingHours && enrichment.openingHours.length > 0 ? (
                      <table className="poi-hours-table" style={{ fontSize: "0.7rem", marginTop: "0.25rem" }}>
                        <tbody>
                          {enrichment.openingHours.map((entry, i) => (
                            <tr key={i}>
                              <td className="poi-hours-day">{entry.day}</td>
                              <td className="poi-hours-time">
                                {entry.open === "closed" ? "Closed" : `${entry.open}–${entry.close ?? ""}`}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : enrichment.hours ? (
                      <div style={{ fontSize: "0.75rem", whiteSpace: "pre-line" }}>
                        {enrichment.hours
                          .split(/[;\n]|(?:\s\/\s)/)
                          .map((s) => s.trim())
                          .filter((s) => s.length > 0)
                          .join("\n")}
                      </div>
                    ) : null}
                    {(() => {
                      const avail = getAvailabilityTags(enrichment.hours, poi.tags.opening_hours, targetLanguage as "fr" | "en");
                      return avail.length > 0 ? (
                        <div style={{ fontSize: "0.75rem", color: "#16a34a", fontWeight: 600 }}>
                          {avail.join(" · ")}
                        </div>
                      ) : null;
                    })()}
                    {enrichment.description && (
                      <div
                        style={{
                          marginTop: "0.25rem",
                          fontSize: "0.75rem",
                          lineHeight: "1.3",
                        }}
                      >
                        {enrichment.description}
                      </div>
                    )}
                    {enrichment.review && (
                      <div
                        style={{
                          marginTop: "0.15rem",
                          fontSize: "0.7rem",
                          lineHeight: "1.3",
                          fontStyle: "italic",
                          color: "#6b6b6b",
                        }}
                      >
                        {enrichment.review}
                      </div>
                    )}
                    {/* Divergences & cautions (WS12) */}
                    {enrichment.structured?.divergences && enrichment.structured.divergences.length > 0 && (
                      <div style={{ marginTop: "0.25rem", fontSize: "0.7rem", color: "#dc2626", lineHeight: "1.3" }}>
                        {enrichment.structured.divergences.map((d, i) => (
                          <div key={`div-${i}`}>⚠ {d}</div>
                        ))}
                      </div>
                    )}
                    {enrichment.structured?.cautions && enrichment.structured.cautions.length > 0 && (
                      <div style={{ marginTop: "0.15rem", fontSize: "0.65rem", color: "#6b6b6b", fontStyle: "italic", lineHeight: "1.3" }}>
                        {enrichment.structured.cautions.slice(0, 2).map((c, i) => (
                          <div key={`caut-${i}`}>{c}</div>
                        ))}
                      </div>
                    )}
                    {enrichment.sourceCount > 0 && (
                      <div style={{ marginTop: "0.25rem", fontSize: "0.65rem", color: "#6b6b6b" }}>
                        {enrichment.sourceCount} source{enrichment.sourceCount > 1 ? "s" : ""}
                        {enrichment.sourceEngines.length > 0 && (
                          <> ({enrichment.sourceEngines.join(", ")})</>
                        )}
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
                    {(() => {
                      const osmAvail = getAvailabilityTags(null, poi.tags.opening_hours, targetLanguage as "fr" | "en");
                      return osmAvail.length > 0 ? (
                        <div style={{ fontSize: "0.75rem", color: "#16a34a", fontWeight: 600 }}>
                          {osmAvail.join(" · ")}
                        </div>
                      ) : null;
                    })()}
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
          </Marker>
        );
      })}

      {/* Trace legend overlay (only when multiple traces) */}
      {traces.length > 1 && (
        <TraceLegend
          traces={traces}
          highlightedTraceId={highlightedTraceId}
          onHighlight={setHighlightedTraceId}
        />
      )}
    </MapContainer>
  );
}

// ---------------------------------------------------------------------------
// Trace legend – shows trace names + colors in a corner overlay
// ---------------------------------------------------------------------------

function TraceLegend({
  traces,
  highlightedTraceId,
  onHighlight,
}: {
  traces: TraceData[];
  highlightedTraceId: string | null;
  onHighlight: (id: string | null) => void;
}) {
  return (
    <div className="trace-legend">
      <div className="trace-legend-title">Traces</div>
      {traces.map((trace) => {
        const isHighlighted = highlightedTraceId === trace.id;
        const isDimmed = highlightedTraceId !== null && !isHighlighted;
        return (
          <div
            key={trace.id}
            className={`trace-legend-item ${isHighlighted ? "highlighted" : ""} ${isDimmed ? "dimmed" : ""}`}
            onMouseEnter={() => onHighlight(trace.id)}
            onMouseLeave={() => onHighlight(null)}
          >
            <span
              className="trace-legend-swatch"
              style={{ backgroundColor: trace.color }}
            />
            <span className="trace-legend-name">
              {trace.name ?? trace.id}
            </span>
            <span className="trace-legend-dist">
              {(trace.totalDistanceM / 1000).toFixed(0)} km
            </span>
          </div>
        );
      })}
    </div>
  );
}
