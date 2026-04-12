// ---------------------------------------------------------------------------
// Map component – Leaflet map displaying the trace and POIs (neobrutalist)
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
import type { POI, TraceData } from "../types";

interface Props {
  trace: TraceData | null;
  pois: POI[];
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

export function RouteMap({ trace, pois }: Props) {
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

      {pois.map((poi) => (
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
              {poi.tags.opening_hours && (
                <div className="text-xs mt-1">
                  Hours: {poi.tags.opening_hours}
                </div>
              )}
              {poi.tags.phone && (
                <div className="text-xs">Tel: {poi.tags.phone}</div>
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
            </div>
          </Popup>
        </CircleMarker>
      ))}
    </MapContainer>
  );
}
