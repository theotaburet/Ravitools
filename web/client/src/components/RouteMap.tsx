// ---------------------------------------------------------------------------
// Map component – Leaflet map displaying traces and POIs (neobrutalist)
// Supports multiple traces with distinct colors, legend, and hover highlight
// ---------------------------------------------------------------------------

import { useAtom, useAtomValue } from "jotai";
import type { LatLngBoundsExpression } from "leaflet";
import L from "leaflet";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, Marker, Polyline, Popup, TileLayer, Tooltip, useMap } from "react-leaflet";
import { buildGoogleMapsUrl } from "../lib/enrichment";
import { isRetryableDegradedResult } from "../lib/enrichment/provenance";
import { getAvailabilityTags } from "../lib/export";
import { t, translateCategory, translatePoiName } from "../lib/i18n";
import { CATEGORY_EMOJI } from "../lib/poi-config";
import { enrichingPoiIdsAtom, enrichmentsAtom } from "../state/enrichment";
import { filteredPoisAtom, tracesAtom } from "../state/route";
import { selectedPoiIdAtom, targetLanguageAtom } from "../state/ui";
import type { TraceData } from "../types";
import { EnrichmentDetails } from "./EnrichmentDetails";

function FitBounds({ traces }: { traces: TraceData[] }) {
  const map = useMap();

  useEffect(() => {
    const allPoints = traces.flatMap((t) => t.original);
    if (allPoints.length === 0) return;

    let minLat = Infinity,
      maxLat = -Infinity,
      minLon = Infinity,
      maxLon = -Infinity;
    for (const p of allPoints) {
      if (p.lat < minLat) minLat = p.lat;
      if (p.lat > maxLat) maxLat = p.lat;
      if (p.lon < minLon) minLon = p.lon;
      if (p.lon > maxLon) maxLon = p.lon;
    }
    const bounds: LatLngBoundsExpression = [
      [minLat, minLon],
      [maxLat, maxLon],
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
    const timer = setTimeout(() => {
      marker.openPopup();
    }, 650);
    return () => clearTimeout(timer);
  }, [selectedPoiId, map, markerRefs]);

  return null;
}

export function RouteMap() {
  const traces = useAtomValue(tracesAtom);
  const pois = useAtomValue(filteredPoisAtom);
  const enrichments = useAtomValue(enrichmentsAtom);
  const [selectedPoiId, onSelectPoi] = useAtom(selectedPoiIdAtom);
  const enrichingPoiIds = useAtomValue(enrichingPoiIdsAtom);
  const targetLanguage = useAtomValue(targetLanguageAtom);
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
    <>
      {traces.length === 0 && (
        <div className="map-empty">
          <div className="map-empty-card">
            <h2>{t("map.emptyTitle", targetLanguage)}</h2>
            <p>{t("map.emptyBody", targetLanguage)}</p>
          </div>
        </div>
      )}
      <MapContainer center={center} zoom={6} className="route-map" scrollWheelZoom={true}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL)'
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
          const elevationLabel =
            trace.elevationGainM > 0 || trace.elevationLossM > 0
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
          ]
            .filter(Boolean)
            .join(" ");

          // AUDIT U1: give the marker an accessible name (was an unlabeled emoji div).
          const markerLabel = (poi.name || poi.category).replace(/"/g, "&quot;");
          const icon = L.divIcon({
            className: "poi-marker-icon",
            html: `<div class="${markerClasses}" style="border-color:${poi.style.backgroundColor};width:${size}px;height:${size}px" role="img" aria-label="${markerLabel}" title="${markerLabel}">${emoji}</div>`,
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
                  <div className="poi-popup-cat">
                    {translateCategory(poi.category, targetLanguage)}
                  </div>
                  <div className="poi-popup-dist">
                    km {(poi.alongTraceDistance / 1000).toFixed(1)} &middot;{" "}
                    {Math.round(poi.distanceToTrace)}m from route
                  </div>

                  {/* Enrichment data (AUDIT R27: shared with PoiList) */}
                  {enrichment && enrichment.status === "done" && (
                    <div style={{ marginTop: "0.5rem", fontSize: "0.8rem" }}>
                      <EnrichmentDetails
                        poi={poi}
                        enrichment={enrichment}
                        targetLanguage={targetLanguage}
                      />
                      {enrichment.sourceCount > 0 && (
                        <div
                          style={{ marginTop: "0.25rem", fontSize: "0.65rem", color: "#6b6b6b" }}
                        >
                          {enrichment.sourceCount} source{enrichment.sourceCount > 1 ? "s" : ""}
                          {enrichment.sourceEngines.length > 0 && (
                            <> ({enrichment.sourceEngines.join(", ")})</>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* OSM tags fallback */}
                  {enrichment?.status !== "done" && (
                    <>
                      {poi.tags.opening_hours && (
                        <div className="text-xs mt-1">Hours: {poi.tags.opening_hours}</div>
                      )}
                      {(() => {
                        const osmAvail = getAvailabilityTags(
                          null,
                          poi.tags.opening_hours,
                          targetLanguage as "fr" | "en",
                        );
                        return osmAvail.length > 0 ? (
                          <div style={{ fontSize: "0.75rem", color: "#16a34a", fontWeight: 600 }}>
                            {osmAvail.join(" · ")}
                          </div>
                        ) : null;
                      })()}
                      {poi.tags.phone && <div className="text-xs">Tel: {poi.tags.phone}</div>}
                    </>
                  )}
                  {isRetryableDegradedResult(enrichment) ? (
                    <div className="poi-popup-retryable">
                      Search degraded. Retry after cooldown or IP change.
                    </div>
                  ) : null}

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
    </>
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
          // biome-ignore lint/a11y/noStaticElementInteractions: hover-only visual highlight — keyboard/tap access is R43 (P4 follow-up)
          <div
            key={trace.id}
            className={`trace-legend-item ${isHighlighted ? "highlighted" : ""} ${isDimmed ? "dimmed" : ""}`}
            onMouseEnter={() => onHighlight(trace.id)}
            onMouseLeave={() => onHighlight(null)}
          >
            <span className="trace-legend-swatch" style={{ backgroundColor: trace.color }} />
            <span className="trace-legend-name">{trace.name ?? trace.id}</span>
            <span className="trace-legend-dist">{(trace.totalDistanceM / 1000).toFixed(0)} km</span>
          </div>
        );
      })}
    </div>
  );
}
