// ---------------------------------------------------------------------------
// OsmAnd GPX Export – GPX with osmand: extensions for icon/color/background
// Best experience on OsmAnd; other apps simply ignore the extensions.
// ---------------------------------------------------------------------------

import type { EnrichedData, POI, PoiCategory, TraceData } from "../../types";
import { getOsmAndIcon, OSMAND_CATEGORY_BACKGROUNDS, OSMAND_CATEGORY_COLORS } from "../poi-config";
import { formatPoiDescriptionCompact } from "./description";
import { buildTrackSections, downloadFile, escapeXml, mapCategoryToGpxSymbol } from "./shared";

export function exportToOsmAndGpx(
  pois: POI[],
  traces: TraceData[],
  filename: string = "ravitools-pois-osmand",
  enrichments?: Map<string, EnrichedData>,
): void {
  const gpxContent = buildOsmAndGpxString(pois, traces, enrichments);
  downloadFile(gpxContent, `${filename}.gpx`, "application/gpx+xml");
}

export function buildOsmAndGpxString(
  pois: POI[],
  traces: TraceData[],
  enrichments?: Map<string, EnrichedData>,
): string {
  // Build <osmand:points_groups> for the <extensions> block
  const categoriesUsed = new Set<PoiCategory>();
  for (const poi of pois) {
    categoriesUsed.add(poi.category);
  }

  const pointsGroups = Array.from(categoriesUsed)
    .map((cat) => {
      const color = OSMAND_CATEGORY_COLORS[cat] ?? "#3b82f6";
      const bg = OSMAND_CATEGORY_BACKGROUNDS[cat] ?? "circle";
      const icon = getOsmAndIcon({ category: cat, tags: {} });
      return `      <group name="${escapeXml(cat)}" color="${color}" icon="${icon}" background="${bg}" />`;
    })
    .join("\n");

  const extensionsBlock = `  <extensions>
    <osmand:points_groups>
${pointsGroups}
    </osmand:points_groups>
  </extensions>`;

  // Build waypoints with osmand extensions
  const wpts = pois
    .map((poi) => {
      const desc = formatPoiDescriptionCompact(poi, enrichments?.get(poi.id));
      const sym = mapCategoryToGpxSymbol(poi.category);
      const osmandIcon = getOsmAndIcon(poi);
      const osmandColor = OSMAND_CATEGORY_COLORS[poi.category] ?? "#3b82f6";
      const osmandBg = OSMAND_CATEGORY_BACKGROUNDS[poi.category] ?? "circle";

      return `  <wpt lat="${poi.lat}" lon="${poi.lon}">
    <name>${escapeXml(poi.name)}</name>
    <desc>${escapeXml(desc)}</desc>
    <type>${escapeXml(poi.category)}</type>
    <sym>${sym}</sym>
    <extensions>
      <osmand:icon>${osmandIcon}</osmand:icon>
      <osmand:color>${osmandColor}</osmand:color>
      <osmand:background>${osmandBg}</osmand:background>
    </extensions>
  </wpt>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Ravitools"
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:osmand="https://osmand.net">
  <metadata>
    <name>Ravitools POIs</name>
    <desc>Points of interest along your cycling route (OsmAnd enhanced)</desc>
    <time>${new Date().toISOString()}</time>
  </metadata>
${extensionsBlock}
${wpts}${buildTrackSections(traces)}
</gpx>`;
}
