// ---------------------------------------------------------------------------
// Offline export utilities
// Export POIs as GPX waypoints or KML for GPS devices
// ---------------------------------------------------------------------------

import type { POI, PoiCategory, TraceData, EnrichedData } from "../types";
import {
  OSMAND_CATEGORY_COLORS,
  OSMAND_CATEGORY_BACKGROUNDS,
  getOsmAndIcon,
} from "./poi-config";

// ---------------------------------------------------------------------------
// GPX Export – produces a GPX file with waypoints for each POI
// This is the most widely compatible format for GPS devices.
// ---------------------------------------------------------------------------

export function exportToGpx(
  pois: POI[],
  trace: TraceData | null,
  filename: string = "ravitools-pois",
  enrichments?: Map<string, EnrichedData>,
): void {
  const gpxContent = buildGpxString(pois, trace, enrichments);
  downloadFile(gpxContent, `${filename}.gpx`, "application/gpx+xml");
}

export function buildGpxString(pois: POI[], trace: TraceData | null, enrichments?: Map<string, EnrichedData>): string {
  const wpts = pois
    .map((poi) => {
      const desc = formatPoiDescription(poi, enrichments?.get(poi.id));
      const sym = mapCategoryToGpxSymbol(poi.category);
      return `  <wpt lat="${poi.lat}" lon="${poi.lon}">
    <name>${escapeXml(poi.name)}</name>
    <desc>${escapeXml(desc)}</desc>
    <type>${escapeXml(poi.category)}</type>
    <sym>${sym}</sym>
  </wpt>`;
    })
    .join("\n");

  // Include original track if available
  let trkSection = "";
  if (trace?.original && trace.original.length > 0) {
    const trkpts = trace.original
      .map((p) => {
        const elePart = p.ele != null ? `\n        <ele>${p.ele}</ele>` : "";
        return `      <trkpt lat="${p.lat}" lon="${p.lon}">${elePart}
      </trkpt>`;
      })
      .join("\n");

    trkSection = `
  <trk>
    <name>${escapeXml(trace.name ?? "Route")}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Ravitools" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Ravitools POIs</name>
    <desc>Points of interest along your cycling route</desc>
    <time>${new Date().toISOString()}</time>
  </metadata>
${wpts}${trkSection}
</gpx>`;
}

// ---------------------------------------------------------------------------
// KML Export – for Google Earth and some GPS apps
// ---------------------------------------------------------------------------

export function exportToKml(
  pois: POI[],
  trace: TraceData | null,
  filename: string = "ravitools-pois",
  enrichments?: Map<string, EnrichedData>,
): void {
  const kmlContent = buildKmlString(pois, trace, enrichments);
  downloadFile(kmlContent, `${filename}.kml`, "application/vnd.google-earth.kml+xml");
}

export function buildKmlString(pois: POI[], trace: TraceData | null, enrichments?: Map<string, EnrichedData>): string {
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

  // Track line
  let trackSection = "";
  if (trace?.original && trace.original.length > 0) {
    const coords = trace.original
      .map((p) => `${p.lon},${p.lat},${p.ele ?? 0}`)
      .join(" ");
    trackSection = `    <Placemark>
      <name>${escapeXml(trace.name ?? "Route")}</name>
      <Style>
        <LineStyle>
          <color>ff0000ff</color>
          <width>3</width>
        </LineStyle>
      </Style>
      <LineString>
        <tessellate>1</tessellate>
        <coordinates>${coords}</coordinates>
      </LineString>
    </Placemark>\n`;
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Ravitools POIs</name>
    <description>Points of interest along your cycling route</description>
${trackSection}${folders}  </Document>
</kml>`;
}

// ---------------------------------------------------------------------------
// GeoJSON Export – for web/apps that prefer GeoJSON
// ---------------------------------------------------------------------------

export function exportToGeoJson(
  pois: POI[],
  filename: string = "ravitools-pois",
  enrichments?: Map<string, EnrichedData>,
): void {
  const geojson = buildGeoJsonObject(pois, enrichments);
  downloadFile(
    JSON.stringify(geojson, null, 2),
    `${filename}.geojson`,
    "application/geo+json",
  );
}

export function buildGeoJsonObject(
  pois: POI[],
  enrichments?: Map<string, EnrichedData>,
): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: pois.map((poi) => {
      const enrichment = enrichments?.get(poi.id);
      const enrichmentProps = enrichment && enrichment.status === "done"
        ? {
            enrichment_rating: enrichment.rating,
            enrichment_reviewCount: enrichment.reviewCount,
            enrichment_hours: enrichment.hours,
            enrichment_summary: enrichment.summary,
            enrichment_translatedSummary: enrichment.translatedSummary,
            enrichment_specialty: enrichment.specialty,
            enrichment_priceLevel: enrichment.priceLevel,
            enrichment_googleMapsUrl: enrichment.googleMapsUrl,
            enrichment_locality: enrichment.locality,
            enrichment_sourceCount: enrichment.sourceCount,
            enrichment_sourceEngines: enrichment.sourceEngines.join(","),
            enrichment_confidence: enrichment.confidence,
          }
        : {};

      return {
        type: "Feature",
        geometry: {
          type: "Point",
          coordinates: [poi.lon, poi.lat],
        },
        properties: {
          name: poi.name,
          category: poi.category,
          icon: poi.icon,
          distanceToTrace: Math.round(poi.distanceToTrace),
          ...poi.tags,
          ...enrichmentProps,
        },
      };
    }),
  };
}

// ---------------------------------------------------------------------------
// OsmAnd GPX Export – GPX with osmand: extensions for icon/color/background
// Best experience on OsmAnd; other apps simply ignore the extensions.
// ---------------------------------------------------------------------------

export function exportToOsmAndGpx(
  pois: POI[],
  trace: TraceData | null,
  filename: string = "ravitools-pois-osmand",
  enrichments?: Map<string, EnrichedData>,
): void {
  const gpxContent = buildOsmAndGpxString(pois, trace, enrichments);
  downloadFile(gpxContent, `${filename}.gpx`, "application/gpx+xml");
}

export function buildOsmAndGpxString(
  pois: POI[],
  trace: TraceData | null,
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
      const desc = formatPoiDescription(poi, enrichments?.get(poi.id));
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

  // Include original track if available
  let trkSection = "";
  if (trace?.original && trace.original.length > 0) {
    const trkpts = trace.original
      .map((p) => {
        const elePart = p.ele != null ? `\n        <ele>${p.ele}</ele>` : "";
        return `      <trkpt lat="${p.lat}" lon="${p.lon}">${elePart}
      </trkpt>`;
      })
      .join("\n");

    trkSection = `
  <trk>
    <name>${escapeXml(trace.name ?? "Route")}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>`;
  }

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
${wpts}${trkSection}
</gpx>`;
}

// ---------------------------------------------------------------------------
// KMZ Export – zipped KML for Organic Maps, Guru Maps, Google Earth
// KMZ is a ZIP archive containing a single doc.kml file.
// We build the ZIP manually (no dependencies) – single file, STORE method.
// ---------------------------------------------------------------------------

export function exportToKmz(
  pois: POI[],
  trace: TraceData | null,
  filename: string = "ravitools-pois",
  enrichments?: Map<string, EnrichedData>,
): void {
  const blob = buildKmzBlob(pois, trace, enrichments);
  downloadBlob(blob, `${filename}.kmz`, "application/vnd.google-earth.kmz");
}

export function buildKmzBlob(
  pois: POI[],
  trace: TraceData | null,
  enrichments?: Map<string, EnrichedData>,
): Blob {
  const kmlContent = buildKmlString(pois, trace, enrichments);
  const kmlBytes = new TextEncoder().encode(kmlContent);
  const zipBytes = buildZipSingleFile("doc.kml", kmlBytes);
  return new Blob([zipBytes.buffer as ArrayBuffer], { type: "application/vnd.google-earth.kmz" });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function downloadFile(
  content: string,
  filename: string,
  mimeType: string,
): void {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, filename, mimeType);
}

function downloadBlob(
  blob: Blob,
  filename: string,
  _mimeType: string,
): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function formatPoiDescription(poi: POI, enrichment?: EnrichedData): string {
  const parts = [`Category: ${poi.category}`];

  // Enrichment data first (higher quality)
  if (enrichment && enrichment.status === "done") {
    if (enrichment.rating != null) {
      parts.push(`Rating: ${enrichment.rating.toFixed(1)}/5${enrichment.reviewCount != null ? ` (${enrichment.reviewCount} reviews)` : ""}`);
    }
    if (enrichment.specialty) parts.push(`Type: ${enrichment.specialty}`);
    if (enrichment.hours) parts.push(`Hours: ${enrichment.hours}`);
    if (enrichment.priceLevel != null) parts.push(`Price: ${"$".repeat(enrichment.priceLevel)}`);
    // Prefer translated summary for user-facing output
    const displaySummary = enrichment.translatedSummary ?? enrichment.summary;
    if (displaySummary) parts.push(displaySummary);
    if (enrichment.locality) parts.push(`Location: ${enrichment.locality}`);
    if (enrichment.sourceCount > 0) parts.push(`Sources: ${enrichment.sourceCount}`);
    if (enrichment.confidence > 0) parts.push(`Confidence: ${Math.round(enrichment.confidence * 100)}%`);
    if (enrichment.googleMapsUrl) parts.push(`Google Maps: ${enrichment.googleMapsUrl}`);
  } else {
    // Fallback to raw OSM tags
    if (poi.tags.opening_hours) parts.push(`Hours: ${poi.tags.opening_hours}`);
  }

  if (poi.tags.phone) parts.push(`Phone: ${poi.tags.phone}`);
  if (poi.tags.website) parts.push(`Web: ${poi.tags.website}`);
  if (poi.tags.fee) parts.push(`Fee: ${poi.tags.fee}`);
  parts.push(`Distance from route: ${Math.round(poi.distanceToTrace)}m`);
  return parts.join("\n");
}

function formatPoiDescriptionHtml(poi: POI, enrichment?: EnrichedData): string {
  const parts = [`<b>Category:</b> ${poi.category}`];

  // Enrichment data first
  if (enrichment && enrichment.status === "done") {
    if (enrichment.rating != null) {
      const stars = "★".repeat(Math.round(enrichment.rating)) + "☆".repeat(5 - Math.round(enrichment.rating));
      parts.push(`<b>Rating:</b> ${stars} ${enrichment.rating.toFixed(1)}/5${enrichment.reviewCount != null ? ` (${enrichment.reviewCount} reviews)` : ""}`);
    }
    if (enrichment.specialty) parts.push(`<b>Type:</b> ${enrichment.specialty}`);
    if (enrichment.hours) parts.push(`<b>Hours:</b> ${enrichment.hours}`);
    if (enrichment.priceLevel != null) parts.push(`<b>Price:</b> ${"$".repeat(enrichment.priceLevel)}`);
    // Prefer translated summary for user-facing output
    const displaySummary = enrichment.translatedSummary ?? enrichment.summary;
    if (displaySummary) parts.push(`<i>${displaySummary}</i>`);
    if (enrichment.locality) parts.push(`<b>Location:</b> ${enrichment.locality}`);
    if (enrichment.sourceCount > 0) parts.push(`<b>Sources:</b> ${enrichment.sourceCount}`);
    if (enrichment.confidence > 0) parts.push(`<b>Confidence:</b> ${Math.round(enrichment.confidence * 100)}%`);
    if (enrichment.googleMapsUrl) parts.push(`<a href="${enrichment.googleMapsUrl}">Google Maps</a>`);
  } else {
    if (poi.tags.opening_hours)
      parts.push(`<b>Hours:</b> ${poi.tags.opening_hours}`);
  }

  if (poi.tags.phone) parts.push(`<b>Phone:</b> ${poi.tags.phone}`);
  if (poi.tags.website)
    parts.push(
      `<b>Web:</b> <a href="${poi.tags.website}">${poi.tags.website}</a>`,
    );
  if (poi.tags.fee) parts.push(`<b>Fee:</b> ${poi.tags.fee}`);
  parts.push(
    `<b>Distance from route:</b> ${Math.round(poi.distanceToTrace)}m`,
  );
  return parts.join("<br/>");
}

function hexToKmlColor(hex: string): string {
  // KML uses aaBBGGRR format; input is #RRGGBB
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return "ffffff";
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `${b}${g}${r}`;
}

function mapCategoryToGpxSymbol(category: string): string {
  const symbols: Record<string, string> = {
    Water: "Drinking Water",
    "Sleeping place": "Campground",
    Restroom: "Restroom",
    Shelter: "Shelter",
    "Food shop": "Shopping Center",
    "Restaurant or Bar": "Restaurant",
    Gears: "Bike Trail",
    DIY: "Wrecker",
    Laundry: "Building",
    Medical: "Medical Facility",
    Pharmacy: "Pharmacy",
    "Bank & ATM": "Bank",
    "Post office": "Post Office",
    Viewpoint: "Scenic Area",
    "Tourist info": "Information",
    Charging: "Charging Station",
    Picnic: "Picnic Area",
    Wifi: "Library",
  };
  return symbols[category] ?? "Flag, Blue";
}

// ---------------------------------------------------------------------------
// Minimal ZIP builder (STORE method, single file)
// Builds a valid ZIP archive for a single uncompressed file.
// This avoids any dependency on jszip or fflate for the simple KMZ case.
// See: https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
// ---------------------------------------------------------------------------

export function buildZipSingleFile(
  filename: string,
  data: Uint8Array,
): Uint8Array {
  const enc = new TextEncoder();
  const nameBytes = enc.encode(filename);
  const crc = crc32(data);
  const size = data.length;

  // DOS date/time for "now"
  const now = new Date();
  const dosTime =
    ((now.getSeconds() >> 1) & 0x1f) |
    ((now.getMinutes() & 0x3f) << 5) |
    ((now.getHours() & 0x1f) << 11);
  const dosDate =
    (now.getDate() & 0x1f) |
    (((now.getMonth() + 1) & 0x0f) << 5) |
    (((now.getFullYear() - 1980) & 0x7f) << 9);

  // Local file header (30 + nameLen)
  const lfhSize = 30 + nameBytes.length;
  const lfh = new Uint8Array(lfhSize);
  const lfhView = new DataView(lfh.buffer);
  lfhView.setUint32(0, 0x04034b50, true); // local file header signature
  lfhView.setUint16(4, 20, true); // version needed to extract
  lfhView.setUint16(6, 0, true); // general purpose bit flag
  lfhView.setUint16(8, 0, true); // compression method (STORE)
  lfhView.setUint16(10, dosTime, true); // last mod file time
  lfhView.setUint16(12, dosDate, true); // last mod file date
  lfhView.setUint32(14, crc, true); // crc-32
  lfhView.setUint32(18, size, true); // compressed size
  lfhView.setUint32(22, size, true); // uncompressed size
  lfhView.setUint16(26, nameBytes.length, true); // file name length
  lfhView.setUint16(28, 0, true); // extra field length
  lfh.set(nameBytes, 30);

  // Central directory header (46 + nameLen)
  const cdhSize = 46 + nameBytes.length;
  const cdh = new Uint8Array(cdhSize);
  const cdhView = new DataView(cdh.buffer);
  cdhView.setUint32(0, 0x02014b50, true); // central directory file header signature
  cdhView.setUint16(4, 20, true); // version made by
  cdhView.setUint16(6, 20, true); // version needed to extract
  cdhView.setUint16(8, 0, true); // general purpose bit flag
  cdhView.setUint16(10, 0, true); // compression method (STORE)
  cdhView.setUint16(12, dosTime, true); // last mod file time
  cdhView.setUint16(14, dosDate, true); // last mod file date
  cdhView.setUint32(16, crc, true); // crc-32
  cdhView.setUint32(20, size, true); // compressed size
  cdhView.setUint32(24, size, true); // uncompressed size
  cdhView.setUint16(28, nameBytes.length, true); // file name length
  cdhView.setUint16(30, 0, true); // extra field length
  cdhView.setUint16(32, 0, true); // file comment length
  cdhView.setUint16(34, 0, true); // disk number start
  cdhView.setUint16(36, 0, true); // internal file attributes
  cdhView.setUint32(38, 0, true); // external file attributes
  cdhView.setUint32(42, 0, true); // relative offset of local header
  cdh.set(nameBytes, 46);

  // End of central directory record (22 bytes)
  const eocdSize = 22;
  const eocd = new Uint8Array(eocdSize);
  const eocdView = new DataView(eocd.buffer);
  const cdOffset = lfhSize + size; // offset of start of central directory
  eocdView.setUint32(0, 0x06054b50, true); // end of central dir signature
  eocdView.setUint16(4, 0, true); // number of this disk
  eocdView.setUint16(6, 0, true); // disk where central directory starts
  eocdView.setUint16(8, 1, true); // number of central directory records on this disk
  eocdView.setUint16(10, 1, true); // total number of central directory records
  eocdView.setUint32(12, cdhSize, true); // size of central directory
  eocdView.setUint32(16, cdOffset, true); // offset of start of central directory
  eocdView.setUint16(20, 0, true); // comment length

  // Concatenate: LFH + data + CDH + EOCD
  const totalSize = lfhSize + size + cdhSize + eocdSize;
  const zip = new Uint8Array(totalSize);
  let offset = 0;
  zip.set(lfh, offset);
  offset += lfhSize;
  zip.set(data, offset);
  offset += size;
  zip.set(cdh, offset);
  offset += cdhSize;
  zip.set(eocd, offset);

  return zip;
}

// CRC-32 lookup table (IEEE 802.3)
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (let i = 0; i < data.length; i++) {
    crc = CRC_TABLE[(crc ^ data[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
