// ---------------------------------------------------------------------------
// Map component – Leaflet map displaying traces and POIs (neobrutalist)
// Supports multiple traces with distinct colors, legend, and hover highlight
// ---------------------------------------------------------------------------

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import type { LatLngBoundsExpression } from "leaflet";
import L from "leaflet";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import { buildGoogleMapsUrl } from "../lib/enrichment";
import { isRetryableDegradedResult } from "../lib/enrichment/provenance";
import { getAvailabilityTags } from "../lib/export";
import { t, translateCategory, translatePoiName } from "../lib/i18n";
import { clusterPois, type PoiCluster } from "../lib/poi-cluster";
import { CATEGORY_EMOJI } from "../lib/poi-config";
import { enrichingPoiIdsAtom, enrichmentsAtom } from "../state/enrichment";
import { filteredPoisAtom, tracesAtom } from "../state/route";
import {
  mapFocusAtom,
  mapViewBoundsAtom,
  profileHoverAtom,
  selectedPoiIdAtom,
  targetLanguageAtom,
} from "../state/ui";
import type { EnrichedData, POI, TargetLanguage, TraceData, TracePoint } from "../types";
import { EnrichmentDetails } from "./EnrichmentDetails";

/** Reads the profile-hover atom itself so a mousemove on the profile only
 *  re-renders this marker, not the whole map (400 POI icons). */
function ProfileHoverMarker() {
  const profileHover = useAtomValue(profileHoverAtom);
  if (!profileHover) return null;
  return (
    <CircleMarker
      center={[profileHover.lat, profileHover.lon]}
      radius={7}
      pathOptions={{ color: "#000", weight: 3, fillColor: "#a3e635", fillOpacity: 1 }}
      interactive={false}
    />
  );
}

/** Publish the viewport to mapViewBoundsAtom so the profile can window itself */
function MapViewSync() {
  const map = useMap();
  const setBounds = useSetAtom(mapViewBoundsAtom);

  useEffect(() => {
    const update = () => {
      const b = map.getBounds();
      setBounds({
        south: b.getSouth(),
        west: b.getWest(),
        north: b.getNorth(),
        east: b.getEast(),
      });
    };
    map.on("moveend", update);
    update();
    return () => {
      map.off("moveend", update);
      setBounds(null);
    };
  }, [map, setBounds]);

  return null;
}

/** Consume one-shot zoom requests (profile cluster clicks) */
function MapFocus() {
  const map = useMap();
  const [focus, setFocus] = useAtom(mapFocusAtom);

  useEffect(() => {
    if (!focus) return;
    map.fitBounds(
      [
        [focus.south, focus.west],
        [focus.north, focus.east],
      ],
      { padding: [60, 60], maxZoom: 17 },
    );
    setFocus(null);
  }, [focus, map, setFocus]);

  return null;
}

/**
 * Polyline that draws itself start→end (stroke-dashoffset). The animation
 * waits for the post-upload fitBounds to settle (moveend, 600ms fallback):
 * animating before it plays on a path that gets redrawn mid-flight.
 */
function AnimatedPolyline({ children, ...props }: React.ComponentProps<typeof Polyline>) {
  const ref = useRef<L.Polyline | null>(null);
  const map = useMap();
  const played = useRef(false);

  useEffect(() => {
    let cleanupId: ReturnType<typeof setTimeout> | undefined;
    const play = () => {
      if (played.current) return;
      played.current = true;
      if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
      const el = ref.current?.getElement();
      if (!(el instanceof SVGPathElement)) return;
      const len = el.getTotalLength();
      el.style.strokeDasharray = `${len}`;
      el.style.strokeDashoffset = `${len}`;
      el.getBoundingClientRect(); // flush so the transition starts from the hidden state
      el.style.transition = "stroke-dashoffset 2.5s ease-out";
      el.style.strokeDashoffset = "0";
      cleanupId = setTimeout(() => {
        el.style.strokeDasharray = "";
        el.style.strokeDashoffset = "";
        el.style.transition = "";
      }, 2600);
    };
    map.once("moveend", play);
    const fallbackId = setTimeout(play, 600);
    return () => {
      map.off("moveend", play);
      clearTimeout(fallbackId);
      if (cleanupId) clearTimeout(cleanupId);
    };
  }, [map]);

  return (
    <Polyline ref={ref} {...props}>
      {children}
    </Polyline>
  );
}

/** Bearing a→b in degrees clockwise from north (flat-earth approx, fine at 500m) */
function bearing(a: TracePoint, b: TracePoint): number {
  return (
    (Math.atan2((b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180), b.lat - a.lat) * 180) / Math.PI
  );
}

function flagIcon(emoji: string, label: string): L.DivIcon {
  return L.divIcon({
    className: "trace-flag-icon",
    html: `<span class="trace-flag" role="img" aria-label="${label}">${emoji}</span>`,
    iconSize: [24, 24],
    iconAnchor: [3, 22],
  });
}

/** One trace polyline, memoized (2000+ setLatLngs on unrelated re-renders is jank) */
const TraceLine = memo(function TraceLine({
  trace,
  isHighlighted,
  isDimmed,
  onHighlight,
}: {
  trace: TraceData;
  isHighlighted: boolean;
  isDimmed: boolean;
  onHighlight: (id: string | null) => void;
}) {
  const positions = useMemo(
    () => trace.original.map((p) => [p.lat, p.lon] as [number, number]),
    [trace],
  );
  if (positions.length === 0) return null;

  const distanceKm = (trace.totalDistanceM / 1000).toFixed(1);
  const elevationLabel =
    trace.elevationGainM > 0 || trace.elevationLossM > 0
      ? `↑${trace.elevationGainM}m ↓${trace.elevationLossM}m`
      : "";

  return (
    <AnimatedPolyline
      positions={positions}
      pathOptions={{
        color: trace.color,
        weight: isHighlighted ? 6 : 4,
        opacity: isDimmed ? 0.3 : 0.9,
      }}
      eventHandlers={{
        mouseover: () => onHighlight(trace.id),
        mouseout: () => onHighlight(null),
      }}
    >
      <Tooltip sticky>
        {trace.name ?? trace.id} · {distanceKm} km {elevationLabel}
      </Tooltip>
    </AnimatedPolyline>
  );
});

/** Direction arrows + start/finish flags for one trace */
const TraceDirection = memo(function TraceDirection({ trace }: { trace: TraceData }) {
  const pts = trace.original;
  if (pts.length < 2) return null;
  const simplified = trace.simplified.length >= 2 ? trace.simplified : pts;
  // ~15 arrows per trace whatever its length
  const stride = Math.max(1, Math.floor(simplified.length / 15));
  const arrows: { p: TracePoint; deg: number }[] = [];
  for (let i = stride; i < simplified.length - 1; i += stride) {
    arrows.push({ p: simplified[i], deg: bearing(simplified[i - 1], simplified[i + 1]) });
  }
  return (
    <>
      {arrows.map((a) => (
        <Marker
          key={`${trace.id}-${a.p.lat}-${a.p.lon}`}
          position={[a.p.lat, a.p.lon]}
          interactive={false}
          icon={L.divIcon({
            className: "trace-arrow-icon",
            // ➤ points east; bearing is from north → rotate by (deg - 90)
            html: `<span class="trace-arrow" style="transform:rotate(${Math.round(a.deg - 90)}deg)">➤</span>`,
            iconSize: [14, 14],
            iconAnchor: [7, 7],
          })}
        />
      ))}
      <Marker
        position={[pts[0].lat, pts[0].lon]}
        interactive={false}
        icon={flagIcon("🚩", "Start")}
      />
      <Marker
        position={[pts[pts.length - 1].lat, pts[pts.length - 1].lon]}
        interactive={false}
        icon={flagIcon("🏁", "Finish")}
      />
    </>
  );
});

/** Count bubble for a dense cell — click zooms onto its members */
const ClusterMarker = memo(function ClusterMarker({ cluster }: { cluster: PoiCluster }) {
  const map = useMap();
  const icon = useMemo(() => {
    const size = cluster.count >= 50 ? 40 : cluster.count >= 15 ? 36 : 30;
    return L.divIcon({
      className: "poi-cluster-icon",
      html: `<div class="poi-cluster" style="width:${size}px;height:${size}px">${cluster.count}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }, [cluster.count]);

  const handleClick = () => {
    let s = Infinity;
    let w = Infinity;
    let n = -Infinity;
    let e = -Infinity;
    for (const m of cluster.members) {
      if (m.lat < s) s = m.lat;
      if (m.lat > n) n = m.lat;
      if (m.lon < w) w = m.lon;
      if (m.lon > e) e = m.lon;
    }
    map.fitBounds(
      [
        [s, w],
        [n, e],
      ],
      { padding: [60, 60], maxZoom: 17 },
    );
  };

  return (
    <Marker
      position={[cluster.lat, cluster.lon]}
      icon={icon}
      eventHandlers={{ click: handleClick }}
    />
  );
});

/** One POI marker + popup, memoized: map pans and profile hovers must not
 *  rebuild hundreds of divIcons. */
const PoiMarker = memo(function PoiMarker({
  poi,
  enrichment,
  isSelected,
  isEnriching,
  targetLanguage,
  onSelect,
  setMarkerRef,
}: {
  poi: POI;
  enrichment: EnrichedData | undefined;
  isSelected: boolean;
  isEnriching: boolean;
  targetLanguage: TargetLanguage;
  onSelect: (poiId: string) => void;
  setMarkerRef: (poiId: string, el: L.Marker | null) => void;
}) {
  const gmapsUrl = enrichment?.googleMapsUrl ?? buildGoogleMapsUrl(poi);

  const icon = useMemo(() => {
    const emoji = CATEGORY_EMOJI[poi.category] ?? "📍";
    const size = isSelected ? 32 : 24;
    const markerClasses = [
      "poi-marker",
      isSelected ? "poi-marker-selected" : "",
      isEnriching ? "poi-marker-enriching" : "",
    ]
      .filter(Boolean)
      .join(" ");
    // AUDIT U1: accessible name, HTML-escaped (injected into divIcon markup).
    const markerLabel = (poi.name || poi.category).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
    );
    return L.divIcon({
      className: "poi-marker-icon",
      html: `<div class="${markerClasses}" style="border-color:${poi.style.backgroundColor};width:${size}px;height:${size}px" role="img" aria-label="${markerLabel}" title="${markerLabel}">${emoji}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
      popupAnchor: [0, -size / 2],
    });
  }, [poi, isSelected, isEnriching]);

  return (
    <Marker
      ref={(el) => setMarkerRef(poi.id, el as unknown as L.Marker | null)}
      position={[poi.lat, poi.lon]}
      icon={icon}
      eventHandlers={{
        click: () => onSelect(poi.id),
      }}
    >
      <Popup>
        <div className="poi-popup">
          <strong>{translatePoiName(poi.name, targetLanguage)}</strong>
          <div className="poi-popup-cat">{translateCategory(poi.category, targetLanguage)}</div>
          <div className="poi-popup-dist">
            km {(poi.alongTraceDistance / 1000).toFixed(1)} &middot;{" "}
            {Math.round(poi.distanceToTrace)}
            {t("map.fromRoute", targetLanguage)}
          </div>

          {/* Enrichment data (AUDIT R27: shared with PoiList) */}
          {enrichment && enrichment.status === "done" && (
            <div className="poi-popup-enrichment">
              <EnrichmentDetails
                poi={poi}
                enrichment={enrichment}
                targetLanguage={targetLanguage}
              />
              {enrichment.sourceCount > 0 && (
                <div className="poi-popup-sources">
                  {enrichment.sourceCount} {t("poi.sourceWord", targetLanguage)}
                  {enrichment.sourceCount > 1 ? "s" : ""}
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
                <div className="text-xs mt-1">
                  {t("map.hours", targetLanguage)} {poi.tags.opening_hours}
                </div>
              )}
              {(() => {
                const osmAvail = getAvailabilityTags(
                  null,
                  poi.tags.opening_hours,
                  targetLanguage as "fr" | "en",
                );
                return osmAvail.length > 0 ? (
                  <div className="poi-popup-avail">{osmAvail.join(" · ")}</div>
                ) : null;
              })()}
              {poi.tags.phone && (
                <div className="text-xs">
                  {t("map.tel", targetLanguage)} {poi.tags.phone}
                </div>
              )}
            </>
          )}
          {isRetryableDegradedResult(enrichment) ? (
            <div className="poi-popup-retryable">{t("map.searchDegraded", targetLanguage)}</div>
          ) : null}

          {poi.tags.website && (
            <div className="text-xs">
              <a
                href={poi.tags.website}
                target="_blank"
                rel="noopener noreferrer"
                className="underline font-bold"
              >
                {t("map.website", targetLanguage)}
              </a>
            </div>
          )}

          {/* Google Maps link */}
          <div className="poi-popup-gmaps">
            <a href={gmapsUrl} target="_blank" rel="noopener noreferrer" className="poi-gmaps-link">
              Google Maps →
            </a>
          </div>
        </div>
      </Popup>
    </Marker>
  );
});

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
  const mapBounds = useAtomValue(mapViewBoundsAtom);
  const markerRefs = useRef<Map<string, L.Marker>>(new Map());
  const [highlightedTraceId, setHighlightedTraceId] = useState<string | null>(null);

  // POI-dense areas: grid clustering. Below ~60 POIs everything is readable
  // as-is; above, dense cells collapse into count bubbles that dissolve on zoom.
  const { singles, clusters } = useMemo(() => {
    if (!mapBounds || pois.length <= 60) return { singles: pois, clusters: [] as PoiCluster[] };
    return clusterPois(pois, mapBounds, { keepId: selectedPoiId ?? null });
  }, [pois, mapBounds, selectedPoiId]);

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

  // Functional update keeps this callback stable → memoized markers survive selection changes
  const handleMarkerClick = useCallback(
    (poiId: string) => {
      onSelectPoi((prev) => (prev === poiId ? null : poiId));
    },
    [onSelectPoi],
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
        <MapViewSync />
        <MapFocus />
        <FlyToSelected selectedPoiId={selectedPoiId ?? null} markerRefs={markerRefs} />

        {/* Render each trace as a distinct Polyline */}
        {traces.map((trace) => (
          <TraceLine
            key={trace.id}
            trace={trace}
            isHighlighted={highlightedTraceId === trace.id}
            isDimmed={highlightedTraceId !== null && highlightedTraceId !== trace.id}
            onHighlight={setHighlightedTraceId}
          />
        ))}

        {/* Direction arrows + start/finish flags */}
        {traces.map((trace) => (
          <TraceDirection key={`dir-${trace.id}`} trace={trace} />
        ))}

        {singles.map((poi) => (
          <PoiMarker
            key={poi.id}
            poi={poi}
            enrichment={enrichments.get(poi.id)}
            isSelected={selectedPoiId === poi.id}
            isEnriching={enrichingPoiIds?.has(poi.id) ?? false}
            targetLanguage={targetLanguage}
            onSelect={handleMarkerClick}
            setMarkerRef={setMarkerRef}
          />
        ))}
        {clusters.map((c) => (
          <ClusterMarker key={`c${c.lat.toFixed(4)}_${c.lon.toFixed(4)}_${c.count}`} cluster={c} />
        ))}
        {/* Position mirrored from the elevation profile hover */}
        <ProfileHoverMarker />

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
          // R43: button so keyboard focus and touch also drive the highlight
          <button
            type="button"
            key={trace.id}
            className={`trace-legend-item ${isHighlighted ? "highlighted" : ""} ${isDimmed ? "dimmed" : ""}`}
            onMouseEnter={() => onHighlight(trace.id)}
            onMouseLeave={() => onHighlight(null)}
            onFocus={() => onHighlight(trace.id)}
            onBlur={() => onHighlight(null)}
          >
            <span className="trace-legend-swatch" style={{ backgroundColor: trace.color }} />
            <span className="trace-legend-name">{trace.name ?? trace.id}</span>
            <span className="trace-legend-dist">{(trace.totalDistanceM / 1000).toFixed(0)} km</span>
          </button>
        );
      })}
    </div>
  );
}
