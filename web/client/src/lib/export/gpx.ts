// ---------------------------------------------------------------------------
// GPX Export – produces a GPX file with waypoints for each POI
// This is the most widely compatible format for GPS devices.
// ---------------------------------------------------------------------------

import type { EnrichedData, POI, TraceData } from "../../types";
import { formatPoiDescriptionCompact } from "./description";
import { buildTrackSections, downloadFile, escapeXml, mapCategoryToGpxSymbol } from "./shared";

export function exportToGpx(
  pois: POI[],
  traces: TraceData[],
  filename: string = "ravitools-pois",
  enrichments?: Map<string, EnrichedData>,
): void {
  const gpxContent = buildGpxString(pois, traces, enrichments);
  downloadFile(gpxContent, `${filename}.gpx`, "application/gpx+xml");
}

export function buildGpxString(
  pois: POI[],
  traces: TraceData[],
  enrichments?: Map<string, EnrichedData>,
): string {
  const wpts = pois
    .map((poi) => {
      const desc = formatPoiDescriptionCompact(poi, enrichments?.get(poi.id));
      const sym = mapCategoryToGpxSymbol(poi.category);
      return `  <wpt lat="${poi.lat}" lon="${poi.lon}">
    <name>${escapeXml(poi.name)}</name>
    <desc>${escapeXml(desc)}</desc>
    <type>${escapeXml(poi.category)}</type>
    <sym>${sym}</sym>
  </wpt>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Ravitools" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Ravitools POIs</name>
    <desc>Points of interest along your cycling route</desc>
    <copyright author="OpenStreetMap contributors">
      <license>https://opendatacommons.org/licenses/odbl/</license>
    </copyright>
    <time>${new Date().toISOString()}</time>
  </metadata>
${wpts}${buildTrackSections(traces)}
</gpx>`;
}
