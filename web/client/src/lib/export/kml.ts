// ---------------------------------------------------------------------------
// KML Export – for Google Earth and some GPS apps
// ---------------------------------------------------------------------------

import type { EnrichedData, POI, TraceData } from "../../types";
import { formatPoiDescriptionHtml } from "./description";
import { downloadFile, escapeXml, hexToKmlColor } from "./shared";

export function exportToKml(
  pois: POI[],
  traces: TraceData[],
  filename: string = "ravitools-pois",
  enrichments?: Map<string, EnrichedData>,
): void {
  const kmlContent = buildKmlString(pois, traces, enrichments);
  downloadFile(kmlContent, `${filename}.kml`, "application/vnd.google-earth.kml+xml");
}

export function buildKmlString(
  pois: POI[],
  traces: TraceData[],
  enrichments?: Map<string, EnrichedData>,
): string {
  // Group POIs by category for folders
  const byCategory = new Map<string, POI[]>();
  for (const poi of pois) {
    let group = byCategory.get(poi.category);
    if (!group) {
      group = [];
      byCategory.set(poi.category, group);
    }
    group.push(poi);
  }

  let folders = "";
  for (const [category, catPois] of byCategory) {
    const placemarks = catPois
      .map(
        (poi) => `      <Placemark>
        <name>${escapeXml(poi.name)}</name>
        <description><![CDATA[${formatPoiDescriptionHtml(poi, enrichments?.get(poi.id))}]]></description>
        <Style>
          <IconStyle>
            <color>ff${hexToKmlColor(poi.style.backgroundColor)}</color>
            <scale>1.0</scale>
          </IconStyle>
        </Style>
        <Point>
          <coordinates>${poi.lon},${poi.lat},0</coordinates>
        </Point>
      </Placemark>`,
      )
      .join("\n");

    folders += `    <Folder>
      <name>${escapeXml(category)}</name>
${placemarks}
    </Folder>\n`;
  }

  // Track lines – one Placemark per trace
  const trackSections = traces
    .filter((t) => t.original.length > 0)
    .map((trace) => {
      const coords = trace.original.map((p) => `${p.lon},${p.lat},${p.ele ?? 0}`).join(" ");
      return `    <Placemark>
      <name>${escapeXml(trace.name ?? "Route")}</name>
      <Style>
        <LineStyle>
          <color>ff${hexToKmlColor(trace.color)}</color>
          <width>3</width>
        </LineStyle>
      </Style>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>${coords}</coordinates>
      </LineString>
    </Placemark>\n`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Ravitools POIs</name>
    <description>Points of interest along your cycling route</description>
${trackSections}${folders}  </Document>
</kml>`;
}
