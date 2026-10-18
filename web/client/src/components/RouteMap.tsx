// Map component: Leaflet map displaying traces and POIs (neobrutalist)
// Supports multiple traces with distinct colors, legend, and hover highlight

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import L from "leaflet";
import { Maximize } from "lucide";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AttributionControl,
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  Tooltip,
  useMap,
  ZoomControl,
} from "react-leaflet";
import { buildGoogleMapsUrl } from "../lib/enrichment";
import { osmFacts } from "../lib/enrichment/osm-facts";
import { isRetryableDegradedResult } from "../lib/enrichment/provenance";
import { getAvailabilityTags } from "../lib/export";
import { km } from "../lib/format";
import { haversine } from "../lib/gpx-parser";
import { t, translateCategory, translatePoiName } from "../lib/i18n";
import { clusterPois, type PoiCluster } from "../lib/poi-cluster";
import { CATEGORY_COLORS, poiEmoji } from "../lib/poi-config";
import { DESKTOP_QUERY, detentPx, type SheetDetent } from "../lib/shell";
import { enrichingPoiIdsAtom, enrichmentsAtom } from "../state/enrichment";
import { filteredPoisAtom, tracesAtom } from "../state/route";
import {
  type MapViewBounds,
  mapFocusAtom,
  mapTraceHoverAtom,
  mapViewBoundsAtom,
  profileHoverAtom,
  selectedPoiIdAtom,
  sheetDetentAtom,
  showTabAtom,
  targetLanguageAtom,
} from "../state/ui";
import type { EnrichedData, POI, TargetLanguage, TraceData, TracePoint } from "../types";
import { EnrichmentDetails } from "./EnrichmentDetails";
import { Icon } from "./Icon";

/** Smallest box around some points */
function boundsOf(points: readonly { lat: number; lon: number }[]): MapViewBounds {
  let south = Infinity;
  let west = Infinity;
  let north = -Infinity;
  let east = -Infinity;
  for (const p of points) {
    if (p.lat < south) south = p.lat;
    if (p.lat > north) north = p.lat;
    if (p.lon < west) west = p.lon;
    if (p.lon > east) east = p.lon;
  }
  return { south, west, north, east };
}

/** Map pixels hidden by the sheet (mobile) or by the panel and header strip (desktop), plus a margin */
function cameraPadding(detent: SheetDetent): { topLeft: L.PointTuple; bottomRight: L.PointTuple } {
  const m = 16;
  if (!window.matchMedia(DESKTOP_QUERY).matches) {
    // The sheet may still be sliding to its detent: compute its height, never measure it
    return { topLeft: [m, 72], bottomRight: [m, detentPx(detent, window.innerHeight) + m] };
  }
  // ponytail: the panel and strip never animate on desktop, so measuring them is exact
  const panel =
    detent === "low" ? 0 : (document.querySelector(".sheet")?.getBoundingClientRect().right ?? 0);
  const strip = document.querySelector(".sheet-strip")?.getBoundingClientRect().height ?? 0;
  return { topLeft: [panel + m, m], bottomRight: [72, strip + 2 * m] };
}

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
  const detent = useAtomValue(sheetDetentAtom);

  useEffect(() => {
    if (!focus) return;
    const { topLeft, bottomRight } = cameraPadding(detent);
    map.fitBounds(
      [
        [focus.south, focus.west],
        [focus.north, focus.east],
      ],
      { paddingTopLeft: topLeft, paddingBottomRight: bottomRight, maxZoom: 17 },
    );
    setFocus(null);
  }, [focus, map, setFocus, detent]);

  return null;
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
  const setMapTraceHover = useSetAtom(mapTraceHoverAtom);
  const clearTimer = useRef<number>(0);
  useEffect(() => () => clearTimeout(clearTimer.current), []);
  const positions = useMemo(
    () => trace.original.map((p) => [p.lat, p.lon] as [number, number]),
    [trace],
  );
  // Cumulative meters per point: same referential as the elevation profile
  const cumDist = useMemo(() => {
    const d = new Float64Array(trace.original.length);
    for (let i = 1; i < trace.original.length; i++) {
      d[i] = d[i - 1] + haversine(trace.original[i - 1], trace.original[i]);
    }
    return d;
  }, [trace]);
  if (positions.length === 0) return null;

  const distanceKm = km(trace.totalDistanceM);
  const elevationLabel =
    trace.elevationGainM > 0 || trace.elevationLossM > 0
      ? `↑${trace.elevationGainM}m ↓${trace.elevationLossM}m`
      : "";

  return (
    <>
      <Polyline
        positions={positions}
        interactive={false}
        pathOptions={{
          color: trace.color,
          weight: isHighlighted ? 6 : 4,
          opacity: isDimmed ? 0.3 : 0.9,
        }}
      />
      {/* Antpath = dashed overlay + CSS keyframes, no leaflet-ant-path dep */}
      <Polyline
        positions={positions}
        interactive={false}
        pathOptions={{
          color: "#ffffff",
          weight: isHighlighted ? 3 : 2,
          opacity: isDimmed ? 0.15 : 0.7,
          dashArray: "10 20",
          className: "trace-antpath",
        }}
      />
      {/* Invisible wide hit zone: forgiving hover + 600ms grace before clearing */}
      <Polyline
        positions={positions}
        pathOptions={{ color: "#000", weight: 20, opacity: 0 }}
        eventHandlers={{
          mouseover: () => {
            clearTimeout(clearTimer.current);
            onHighlight(trace.id);
          },
          mouseout: () => {
            clearTimer.current = window.setTimeout(() => {
              onHighlight(null);
              setMapTraceHover(null);
            }, 600);
          },
          // Argmin over all points per mousemove: O(n) is µs even at 20k pts
          mousemove: (e) => {
            clearTimeout(clearTimer.current);
            const { lat, lng } = e.latlng;
            const cos = Math.cos((lat * Math.PI) / 180);
            let best = 0;
            let bestD = Infinity;
            for (let i = 0; i < positions.length; i++) {
              const dLat = positions[i][0] - lat;
              const dLon = (positions[i][1] - lng) * cos;
              const d2 = dLat * dLat + dLon * dLon;
              if (d2 < bestD) {
                bestD = d2;
                best = i;
              }
            }
            setMapTraceHover({ traceId: trace.id, dist: cumDist[best] });
          },
        }}
      >
        <Tooltip sticky>
          {trace.name ?? trace.id} · {distanceKm} km {elevationLabel}
        </Tooltip>
      </Polyline>
    </>
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

/** Count bubble for a dense cell: click zooms onto its members */
const ClusterMarker = memo(function ClusterMarker({ cluster }: { cluster: PoiCluster }) {
  const setFocus = useSetAtom(mapFocusAtom);
  const icon = useMemo(() => {
    const size = cluster.count >= 50 ? 40 : cluster.count >= 15 ? 36 : 30;
    return L.divIcon({
      className: "poi-cluster-icon",
      html: `<div class="poi-cluster" style="width:${size}px;height:${size}px">${cluster.count}</div>`,
      iconSize: [size, size],
      iconAnchor: [size / 2, size / 2],
    });
  }, [cluster.count]);

  return (
    <Marker
      position={[cluster.lat, cluster.lon]}
      icon={icon}
      eventHandlers={{ click: () => setFocus(boundsOf(cluster.members)) }}
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
  const facts = osmFacts(poi.tags, targetLanguage);

  const icon = useMemo(() => {
    const emoji = poiEmoji(poi);
    const size = isSelected ? 32 : 24;
    const markerClasses = [
      "poi-marker",
      isSelected ? "poi-marker-selected" : "",
      isEnriching ? "poi-marker-enriching" : "",
    ]
      .filter(Boolean)
      .join(" ");
    // Accessible name, HTML-escaped (injected into divIcon markup).
    const markerLabel = (poi.name || poi.category).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
    );
    return L.divIcon({
      className: "poi-marker-icon",
      html: `<div class="${markerClasses}" style="border-color:${CATEGORY_COLORS[poi.category]};width:${size}px;height:${size}px" role="img" aria-label="${markerLabel}" title="${markerLabel}">${emoji}</div>`,
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
            km {km(poi.alongTraceDistance)} &middot; {Math.round(poi.distanceToTrace)}
            {t("map.fromRoute", targetLanguage)}
          </div>
          {facts.length > 0 && <div className="poi-popup-dist">{facts.join(" · ")}</div>}

          {/* Enrichment data */}
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

/** Fly to selected POI and open its popup */
function FlyToSelected({
  selectedPoiId,
  markerRefs,
}: {
  selectedPoiId: string | null;
  markerRefs: React.MutableRefObject<Map<string, L.Marker>>;
}) {
  const map = useMap();
  const detent = useAtomValue(sheetDetentAtom);

  useEffect(() => {
    if (!selectedPoiId) return;
    const marker = markerRefs.current.get(selectedPoiId);
    if (!marker) return;

    // Centre the POI in the part of the map left visible by the sheet or panel
    const zoom = Math.max(map.getZoom(), 14);
    const { topLeft, bottomRight } = cameraPadding(detent);
    const shift = L.point((bottomRight[0] - topLeft[0]) / 2, (bottomRight[1] - topLeft[1]) / 2);
    map.flyTo(map.unproject(map.project(marker.getLatLng(), zoom).add(shift), zoom), zoom, {
      duration: 0.6,
    });

    // Open popup after fly animation
    const timer = setTimeout(() => {
      marker.openPopup();
    }, 650);
    return () => clearTimeout(timer);
  }, [selectedPoiId, map, markerRefs, detent]);

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
  const setFocus = useSetAtom(mapFocusAtom);
  const showTab = useSetAtom(showTabAtom);

  const fitRoute = useCallback(() => {
    const points = traces.flatMap((t) => t.original);
    if (points.length > 0) setFocus(boundsOf(points));
  }, [traces, setFocus]);
  // A new route: frame it
  useEffect(fitRoute, [fitRoute]);

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
      showTab("poi");
    },
    [onSelectPoi, showTab],
  );

  return (
    <>
      {traces.length > 0 && (
        <button
          type="button"
          className="fab fab-fit"
          aria-label={t("map.fit", targetLanguage)}
          onClick={fitRoute}
        >
          <Icon node={Maximize} />
        </button>
      )}
      <MapContainer
        center={center}
        zoom={6}
        className="route-map"
        scrollWheelZoom={true}
        zoomControl={false}
        attributionControl={false}
      >
        <ZoomControl position="bottomright" />
        <AttributionControl position="topright" prefix={false} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors (ODbL)'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

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

// --- Trace legend: shows trace names + colors in a corner overlay ---

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
          // Button so keyboard focus and touch also drive the highlight
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
