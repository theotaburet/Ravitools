// Map component: Leaflet map with the traces and the POI pastilles (design.md, section 6)

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import L from "leaflet";
import { Flag, type IconNode, Maximize, Play } from "lucide";
import { memo, useCallback, useEffect, useMemo, useRef } from "react";
import {
  AttributionControl,
  CircleMarker,
  MapContainer,
  Marker,
  Polyline,
  TileLayer,
  Tooltip,
  useMap,
  ZoomControl,
} from "react-leaflet";
import { km } from "../lib/format";
import { haversine } from "../lib/gpx-parser";
import { t } from "../lib/i18n";
import { clusterPois, type PoiCluster } from "../lib/poi-cluster";
import { CATEGORY_FAMILIES, FAMILY_COLORS, poiGlyph } from "../lib/poi-config";
import { DESKTOP_QUERY, detentPx, type SheetDetent } from "../lib/shell";
import { enrichingPoiIdsAtom } from "../state/enrichment";
import { filteredPoisAtom, tracesAtom } from "../state/route";
import {
  type MapViewBounds,
  mapFocusAtom,
  mapTraceHoverAtom,
  mapViewBoundsAtom,
  paletteAtom,
  profileHoverAtom,
  selectedPoiIdAtom,
  selectedTraceIdAtom,
  sheetDetentAtom,
  showTabAtom,
  targetLanguageAtom,
} from "../state/ui";
import type { Palette, POI, TraceData, TracePoint } from "../types";
import { Icon, iconSvg } from "./Icon";

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
      pathOptions={{ className: "profile-hover-dot", weight: 3, fillOpacity: 1 }}
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

/** Start or finish: a small ink pastille */
function endIcon(node: IconNode, label: string): L.DivIcon {
  return L.divIcon({
    className: "trace-end-icon",
    html: `<span class="trace-end" role="img" aria-label="${label}">${iconSvg(node, 12)}</span>`,
    iconSize: [20, 20],
    iconAnchor: [10, 10],
  });
}

/** One trace: accent line over a paper casing, memoized (2000+ setLatLngs on unrelated re-renders is jank) */
const TraceLine = memo(function TraceLine({
  trace,
  isSelected,
  isDimmed,
  onSelect,
}: {
  trace: TraceData;
  isSelected: boolean;
  isDimmed: boolean;
  onSelect: (id: string) => void;
}) {
  const setMapTraceHover = useSetAtom(mapTraceHoverAtom);
  const clearTimer = useRef<number>(0);
  const casing = useRef<L.Polyline>(null);
  const line = useRef<L.Polyline>(null);
  useEffect(() => () => clearTimeout(clearTimer.current), []);
  // The selected trace is drawn over the others
  useEffect(() => {
    if (!isSelected) return;
    casing.current?.bringToFront();
    line.current?.bringToFront();
  }, [isSelected]);
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
  const opacity = isDimmed ? 0.5 : 1;

  return (
    <>
      <Polyline
        ref={casing}
        positions={positions}
        interactive={false}
        pathOptions={{ className: "trace-casing", weight: isSelected ? 11 : 8, opacity }}
      />
      <Polyline
        ref={line}
        positions={positions}
        interactive={false}
        pathOptions={{ className: "trace-line", weight: isSelected ? 6 : 4, opacity }}
      />
      {/* Invisible wide hit zone: a tap selects; the hover feeds the profile, 600ms grace before clearing */}
      <Polyline
        positions={positions}
        pathOptions={{ color: "#000", weight: 20, opacity: 0 }}
        eventHandlers={{
          click: () => onSelect(trace.id),
          mouseover: () => clearTimeout(clearTimer.current),
          mouseout: () => {
            clearTimer.current = window.setTimeout(() => setMapTraceHover(null), 600);
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

/** Direction arrows + start/finish for one trace; decorative, so out of the tab order */
const TraceDirection = memo(function TraceDirection({ trace }: { trace: TraceData }) {
  const targetLanguage = useAtomValue(targetLanguageAtom);
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
          keyboard={false}
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
        keyboard={false}
        icon={endIcon(Play, t("map.start", targetLanguage))}
      />
      <Marker
        position={[pts[pts.length - 1].lat, pts[pts.length - 1].lon]}
        interactive={false}
        keyboard={false}
        icon={endIcon(Flag, t("map.finish", targetLanguage))}
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
      // A 44 px target whatever the bubble size
      iconSize: [44, 44],
      iconAnchor: [22, 22],
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

/** One POI pastille, memoized: map pans and profile hovers must not rebuild hundreds of divIcons */
const PoiMarker = memo(function PoiMarker({
  poi,
  palette,
  isSelected,
  isEnriching,
  onSelect,
}: {
  poi: POI;
  palette: Palette;
  isSelected: boolean;
  isEnriching: boolean;
  onSelect: (poiId: string) => void;
}) {
  const icon = useMemo(() => {
    const { fill, glyph } = FAMILY_COLORS[palette][CATEGORY_FAMILIES[poi.category]];
    const classes = `pastille${isSelected ? " is-selected" : ""}${isEnriching ? " is-enriching" : ""}`;
    // Accessible name, HTML-escaped (injected into divIcon markup).
    const markerLabel = (poi.name || poi.category).replace(
      /[&<>"]/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string,
    );
    return L.divIcon({
      // A 44 px target around the 28 px pastille (36 px selected)
      className: "pastille-icon",
      html: `<div class="${classes}" style="background:${fill};color:${glyph}" role="img" aria-label="${markerLabel}" title="${markerLabel}">${iconSvg(poiGlyph(poi), isSelected ? 20 : 16)}</div>`,
      iconSize: [44, 44],
      iconAnchor: [22, 22],
    });
  }, [poi, palette, isSelected, isEnriching]);

  return (
    <Marker
      position={[poi.lat, poi.lon]}
      icon={icon}
      zIndexOffset={isSelected ? 1000 : 0}
      eventHandlers={{ click: () => onSelect(poi.id) }}
    />
  );
});

/** Fly to the selected POI */
function FlyToSelected({ poi }: { poi: POI | undefined }) {
  const map = useMap();
  const detent = useAtomValue(sheetDetentAtom);

  useEffect(() => {
    if (!poi) return;
    // Centre the POI in the part of the map left visible by the sheet or panel
    const zoom = Math.max(map.getZoom(), 14);
    const { topLeft, bottomRight } = cameraPadding(detent);
    const shift = L.point((bottomRight[0] - topLeft[0]) / 2, (bottomRight[1] - topLeft[1]) / 2);
    map.flyTo(map.unproject(map.project([poi.lat, poi.lon], zoom).add(shift), zoom), zoom, {
      duration: 0.6,
    });
  }, [poi, map, detent]);

  return null;
}

export function RouteMap() {
  const traces = useAtomValue(tracesAtom);
  const pois = useAtomValue(filteredPoisAtom);
  const [selectedPoiId, onSelectPoi] = useAtom(selectedPoiIdAtom);
  const [selectedTraceId, setSelectedTraceId] = useAtom(selectedTraceIdAtom);
  const enrichingPoiIds = useAtomValue(enrichingPoiIdsAtom);
  const targetLanguage = useAtomValue(targetLanguageAtom);
  const palette = useAtomValue(paletteAtom);
  const mapBounds = useAtomValue(mapViewBoundsAtom);
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

  // Functional update keeps this callback stable → memoized markers survive selection changes
  const handleMarkerClick = useCallback(
    (poiId: string) => {
      onSelectPoi((prev) => (prev === poiId ? null : poiId));
      showTab("poi");
    },
    [onSelectPoi, showTab],
  );
  const selectTrace = useCallback(
    (id: string) => setSelectedTraceId((prev) => (prev === id ? null : id)),
    [setSelectedTraceId],
  );
  // A selection left over from a previous route selects nothing
  const selectedTrace = traces.some((tr) => tr.id === selectedTraceId) ? selectedTraceId : null;

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
        <FlyToSelected poi={pois.find((p) => p.id === selectedPoiId)} />

        {traces.map((trace) => (
          <TraceLine
            key={trace.id}
            trace={trace}
            isSelected={selectedTrace === trace.id}
            isDimmed={selectedTrace !== null && selectedTrace !== trace.id}
            onSelect={selectTrace}
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
            palette={palette}
            isSelected={selectedPoiId === poi.id}
            isEnriching={enrichingPoiIds?.has(poi.id) ?? false}
            onSelect={handleMarkerClick}
          />
        ))}
        {clusters.map((c) => (
          <ClusterMarker key={`c${c.lat.toFixed(4)}_${c.lon.toFixed(4)}_${c.count}`} cluster={c} />
        ))}
        {/* Position mirrored from the elevation profile hover */}
        <ProfileHoverMarker />
      </MapContainer>
    </>
  );
}
