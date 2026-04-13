// ---------------------------------------------------------------------------
// Export panel (neobrutalist)
// Two sections: GPS devices + Smartphone offline apps
// ---------------------------------------------------------------------------

import type { POI, TraceData, EnrichedData } from "../types";
import {
  exportToGpx,
  exportToKml,
  exportToGeoJson,
  exportToOsmAndGpx,
  exportToKmz,
} from "../lib/export";

interface Props {
  pois: POI[];
  traces: TraceData[];
  enrichments?: Map<string, EnrichedData>;
}

export function ExportPanel({ pois, traces, enrichments }: Props) {
  if (pois.length === 0) return null;

  const firstName = traces[0]?.name;
  const baseName = firstName
    ? traces.length === 1
      ? `ravitools-${firstName.replace(/\s+/g, "-").toLowerCase()}`
      : `ravitools-${traces.length}-routes`
    : "ravitools-pois";

  return (
    <div className="export-panel">
      <h3>Export for GPS</h3>
      <p className="text-xs text-muted font-mono mb-3">
        {pois.length} POIs ready
        {traces.length > 1 && ` (${traces.length} traces)`}
        {enrichments && enrichments.size > 0 && ` (${enrichments.size} enriched)`}
      </p>

      {/* GPS device exports */}
      <div className="flex flex-col gap-2">
        <button
          className="neo-btn-lime w-full"
          onClick={() => exportToGpx(pois, traces, baseName, enrichments)}
        >
          .GPX (Garmin, Wahoo...)
        </button>
        <button
          className="neo-btn-secondary w-full"
          onClick={() => exportToKml(pois, traces, baseName, enrichments)}
        >
          .KML (Google Earth)
        </button>
        <button
          className="neo-btn-secondary w-full"
          onClick={() => exportToGeoJson(pois, baseName, enrichments)}
        >
          .GeoJSON
        </button>
      </div>

      {/* Smartphone offline apps */}
      <div className="export-divider" />
      <h3>Export for Smartphone</h3>
      <p className="text-xs text-muted font-mono mb-3">
        Offline maps apps (OsmAnd, Organic Maps, Guru Maps)
      </p>
      <div className="flex flex-col gap-2">
        <button
          className="neo-btn-pink w-full"
          onClick={() => exportToOsmAndGpx(pois, traces, baseName, enrichments)}
        >
          .GPX OsmAnd (icons + colors)
        </button>
        <button
          className="neo-btn-secondary w-full"
          onClick={() => exportToKmz(pois, traces, baseName, enrichments)}
        >
          .KMZ (Organic Maps, Guru Maps)
        </button>
      </div>

      <p className="text-xs text-muted mt-3 leading-snug">
        <strong>OsmAnd GPX</strong> includes custom icons and colors per
        category. Other apps import it as standard GPX.
        <br />
        <strong>KMZ</strong> groups POIs by category in folders — best for
        Organic Maps and Guru Maps.
        {enrichments && enrichments.size > 0 && (
          <>
            <br />
            <strong>Enriched data</strong> (ratings, hours, reviews) is included
            in export descriptions.
          </>
        )}
      </p>
    </div>
  );
}
