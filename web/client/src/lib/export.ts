// ---------------------------------------------------------------------------
// Offline export utilities
// Export POIs as GPX waypoints or KML for GPS devices
// Supports multiple traces (multi-GPX)
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
  traces: TraceData[],
  filename: string = "ravitools-pois",
  enrichments?: Map<string, EnrichedData>,
): void {
  const gpxContent = buildGpxString(pois, traces, enrichments);
  downloadFile(gpxContent, `${filename}.gpx`, "application/gpx+xml");
}

export function buildGpxString(pois: POI[], traces: TraceData[], enrichments?: Map<string, EnrichedData>): string {
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

  // Include all tracks
  const trkSections = traces
    .filter((t) => t.original.length > 0)
    .map((trace) => {
      const trkpts = trace.original
        .map((p) => {
          const elePart = p.ele != null ? `\n        <ele>${p.ele}</ele>` : "";
          return `      <trkpt lat="${p.lat}" lon="${p.lon}">${elePart}
      </trkpt>`;
        })
        .join("\n");

      return `
  <trk>
    <name>${escapeXml(trace.name ?? "Route")}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>`;
    })
    .join("");

  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Ravitools" xmlns="http://www.topografix.com/GPX/1/1">
  <metadata>
    <name>Ravitools POIs</name>
    <desc>Points of interest along your cycling route</desc>
    <time>${new Date().toISOString()}</time>
  </metadata>
${wpts}${trkSections}
</gpx>`;
}

// ---------------------------------------------------------------------------
// KML Export – for Google Earth and some GPS apps
// ---------------------------------------------------------------------------

export function exportToKml(
  pois: POI[],
  traces: TraceData[],
  filename: string = "ravitools-pois",
  enrichments?: Map<string, EnrichedData>,
): void {
  const kmlContent = buildKmlString(pois, traces, enrichments);
  downloadFile(kmlContent, `${filename}.kml`, "application/vnd.google-earth.kml+xml");
}

export function buildKmlString(pois: POI[], traces: TraceData[], enrichments?: Map<string, EnrichedData>): string {
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
      const coords = trace.original
        .map((p) => `${p.lon},${p.lat},${p.ele ?? 0}`)
        .join(" ");
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
            enrichment_openingHours: enrichment.openingHours
              ? enrichment.openingHours.map((e) => `${e.day}: ${e.open === "closed" ? "Closed" : `${e.open}-${e.close ?? ""}`}`).join("; ")
              : null,
            enrichment_description: enrichment.description,
            enrichment_review: enrichment.review,
            // Backward compat: keep old field names populated
            enrichment_summary: enrichment.summary,
            enrichment_translatedSummary: enrichment.translatedSummary,
            enrichment_essentials: enrichment.essentials ?? null,
            enrichment_specialty: enrichment.specialty,
            enrichment_priceLevel: enrichment.priceLevel,
            enrichment_googleMapsUrl: enrichment.googleMapsUrl,
            enrichment_locality: enrichment.locality,
            enrichment_sourceCount: enrichment.sourceCount,
            enrichment_sourceEngines: enrichment.sourceEngines.join(","),
            enrichment_confidence: enrichment.confidence,
            enrichment_synthesisSource: enrichment.synthesisSource ?? null,
            enrichment_synthesisReason: enrichment.synthesisReason ?? null,
            enrichment_googleMapsFields: enrichment.googleMapsFields?.join(",") ?? null,
            enrichment_structured_headline: enrichment.structured?.headline ?? null,
            enrichment_structured_operationalSummary: enrichment.structured?.operationalSummary ?? null,
            enrichment_structured_practicalities: enrichment.structured?.practicalities.join(" | ") ?? null,
            enrichment_structured_cautions: enrichment.structured?.cautions.join(" | ") ?? null,
            enrichment_structured_unknowns: enrichment.structured?.unknowns.join(" | ") ?? null,
            enrichment_structured_sourceRollup: enrichment.structured?.sourceRollup.map((digest) => `${digest.platform}: ${digest.brief}`).join(" | ") ?? null,
            enrichment_structured_divergences: enrichment.structured?.divergences?.join(" | ") ?? null,
            enrichment_structured_sourceConfirmation: enrichment.structured?.sourceConfirmation ?? null,
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

  // Include all tracks
  const trkSections = traces
    .filter((t) => t.original.length > 0)
    .map((trace) => {
      const trkpts = trace.original
        .map((p) => {
          const elePart = p.ele != null ? `\n        <ele>${p.ele}</ele>` : "";
          return `      <trkpt lat="${p.lat}" lon="${p.lon}">${elePart}
      </trkpt>`;
        })
        .join("\n");

      return `
  <trk>
    <name>${escapeXml(trace.name ?? "Route")}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>`;
    })
    .join("");

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
${wpts}${trkSections}
</gpx>`;
}

// ---------------------------------------------------------------------------
// KMZ Export – zipped KML for Organic Maps, Guru Maps, Google Earth
// KMZ is a ZIP archive containing a single doc.kml file.
// We build the ZIP manually (no dependencies) – single file, STORE method.
// ---------------------------------------------------------------------------

export function exportToKmz(
  pois: POI[],
  traces: TraceData[],
  filename: string = "ravitools-pois",
  enrichments?: Map<string, EnrichedData>,
): void {
  const blob = buildKmzBlob(pois, traces, enrichments);
  downloadBlob(blob, `${filename}.kmz`, "application/vnd.google-earth.kmz");
}

export function buildKmzBlob(
  pois: POI[],
  traces: TraceData[],
  enrichments?: Map<string, EnrichedData>,
): Blob {
  const kmlContent = buildKmlString(pois, traces, enrichments);
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

// ---------------------------------------------------------------------------
// Hours formatting – normalize LLM-generated hours into clean per-day lines
// ---------------------------------------------------------------------------

/**
 * Normalize a raw hours string from LLM into a clean multi-line schedule.
 * Handles various separators (; , / \n) and normalizes day names.
 * Returns one line per day-range for readability.
 *
 * Examples:
 *   "Mon-Fri: 8:00-12:00, 14:00-18:00; Sat: 9:00-12:00; Sun: closed"
 *   → "Mon-Fri: 8:00-12:00, 14:00-18:00\nSat: 9:00-12:00\nSun: closed"
 */
export function formatHours(raw: string): string {
  if (!raw) return raw;

  // Split on common day-schedule separators:
  // - semicolons always separate day entries
  // - " / " (spaced slash) separates day entries
  // - newlines separate day entries
  // BUT NOT commas within time ranges (e.g. "8:00-12:00, 14:00-18:00")
  const entries = raw
    .split(/[;\n]|(?:\s\/\s)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (entries.length <= 1) {
    // Single entry — just clean up whitespace
    return raw.trim();
  }

  return entries.join("\n");
}

/**
 * Format hours for HTML output — same logic as formatHours but uses <br/> for line breaks.
 */
export function formatHoursHtml(raw: string): string {
  if (!raw) return raw;

  const entries = raw
    .split(/[;\n]|(?:\s\/\s)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);

  if (entries.length <= 1) {
    return escapeXml(raw.trim());
  }

  return entries.map((e) => escapeXml(e)).join("<br/>");
}

// ---------------------------------------------------------------------------
// Sunday / evening availability detection
// ---------------------------------------------------------------------------

/** Day abbreviations that indicate Sunday in both OSM and freeform hours */
const SUNDAY_PATTERNS = /\b(su|sun|sunday|dim|dimanche|do|domingo)\b/i;

/** Patterns indicating a day range that includes Sunday (e.g. Mo-Su, Mon-Sun, 7j/7, 7/7) */
const SUNDAY_RANGE_PATTERNS = /\b(mo|mon|lu|lun)\s*[-–]\s*(su|sun|dim|do)\b|7\s*[j/]\s*[/]?\s*7/i;

/** Patterns that explicitly say Sunday is closed */
const SUNDAY_CLOSED = /\b(su|sun|sunday|dim|dimanche)\b[^;/\n]*\b(closed|fermé|geschlossen|cerrado)\b/i;

/**
 * Detect whether a POI is open on Sunday, from either enrichment hours or OSM opening_hours.
 * Returns true if Sunday appears to have opening hours (not "closed").
 */
export function isOpenSunday(hours: string | null | undefined, osmHours?: string | null): boolean {
  const raw = hours ?? osmHours ?? "";
  if (!raw) return false;
  const lower = raw.toLowerCase();

  // Explicit "closed on Sunday" → false
  if (SUNDAY_CLOSED.test(lower)) return false;

  // Range that includes Sunday (Mo-Su, 7j/7, etc.)
  if (SUNDAY_RANGE_PATTERNS.test(lower)) return true;

  // Sunday mentioned with a time (not just "closed")
  if (SUNDAY_PATTERNS.test(lower)) {
    // Check it's not followed by "closed"
    const sunMatch = lower.match(SUNDAY_PATTERNS);
    if (sunMatch) {
      const afterSun = lower.slice(sunMatch.index! + sunMatch[0].length, sunMatch.index! + sunMatch[0].length + 30);
      if (!/closed|fermé|geschlossen|cerrado/.test(afterSun)) return true;
    }
  }

  return false;
}

/** Evening = has a closing time >= 20:00 */
const EVENING_TIME = /\b(\d{1,2})[h:.]?(\d{2})?\s*$/;

/**
 * Detect whether a POI is open in the evening (closing time >= 20:00).
 */
export function isOpenEvening(hours: string | null | undefined, osmHours?: string | null): boolean {
  const raw = hours ?? osmHours ?? "";
  if (!raw) return false;

  // Look for time ranges like "8:00-21:00" or "08h00-22h00" — check the closing time
  const timeRanges = raw.match(/\d{1,2}[h:.]?\d{0,2}\s*[-–]\s*\d{1,2}[h:.]?\d{0,2}/g);
  if (!timeRanges) return false;

  for (const range of timeRanges) {
    const parts = range.split(/[-–]/);
    if (parts.length !== 2) continue;
    const closing = parts[1].trim();
    const hourMatch = closing.match(/^(\d{1,2})/);
    if (hourMatch) {
      const hour = parseInt(hourMatch[1], 10);
      if (hour >= 20 || hour <= 2) return true; // 20:00+ or wraps past midnight (0:00-2:00)
    }
  }

  return false;
}

/**
 * Build availability tags for a POI (e.g. ["Open Sunday", "Open evenings"]).
 * Uses enrichment hours if available, falls back to OSM opening_hours tag.
 */
export function getAvailabilityTags(
  enrichmentHours: string | null | undefined,
  osmHours: string | null | undefined,
  lang: "fr" | "en" = "en",
): string[] {
  const tags: string[] = [];
  if (isOpenSunday(enrichmentHours, osmHours)) {
    tags.push(lang === "fr" ? "Ouvert le dimanche" : "Open Sunday");
  }
  if (isOpenEvening(enrichmentHours, osmHours)) {
    tags.push(lang === "fr" ? "Ouvert le soir" : "Open evenings");
  }
  return tags;
}

function formatPoiDescription(poi: POI, enrichment?: EnrichedData): string {
  const parts = [`Category: ${poi.category}`];

  // Enrichment data first (higher quality)
  if (enrichment && enrichment.status === "done") {
    if (enrichment.rating != null) {
      parts.push(`Rating: ${enrichment.rating.toFixed(1)}/5${enrichment.reviewCount != null ? ` (${enrichment.reviewCount} reviews)` : ""}`);
    }
    if (enrichment.priceLevel != null) parts.push(`Price: ${"$".repeat(enrichment.priceLevel)}`);
    if (enrichment.hours) parts.push(`Hours:\n${formatHours(enrichment.hours)}`);
    // New compact fields
    if (enrichment.description) parts.push(enrichment.description);
    if (enrichment.review) parts.push(enrichment.review);
    // Cautions/divergences/source rollup (still useful for GPS)
    if (enrichment.structured?.cautions?.length) parts.push(`Cautions: ${enrichment.structured.cautions.join(" ")}`);
    if (enrichment.structured?.divergences?.length) parts.push(`Divergences: ${enrichment.structured.divergences.join(" ")}`);
    if (enrichment.structured?.sourceRollup?.length) {
      parts.push(...enrichment.structured.sourceRollup.map((digest) => `Source - ${digest.platform}: ${digest.brief}`));
    }
    if (enrichment.locality) parts.push(`Location: ${enrichment.locality}`);
    if (enrichment.sourceCount > 0) parts.push(`Sources: ${enrichment.sourceCount}`);
    if (enrichment.confidence > 0) parts.push(`Confidence: ${Math.round(enrichment.confidence * 100)}%`);
    if (enrichment.synthesisSource) parts.push(`Synthesis: ${enrichment.synthesisSource}${enrichment.synthesisReason ? ` (${enrichment.synthesisReason})` : ""}`);
    if (enrichment.googleMapsFields?.length) parts.push(`Google Maps fields: ${enrichment.googleMapsFields.join(", ")}`);
    if (enrichment.googleMapsUrl) parts.push(`Google Maps: ${enrichment.googleMapsUrl}`);
  } else {
    // Fallback to raw OSM tags
    if (poi.tags.opening_hours) parts.push(`Hours: ${poi.tags.opening_hours}`);
  }

  if (poi.tags.phone) parts.push(`Phone: ${poi.tags.phone}`);
  if (poi.tags.website) parts.push(`Web: ${poi.tags.website}`);
  if (poi.tags.fee) parts.push(`Fee: ${poi.tags.fee}`);

  // Availability highlights
  const availability = getAvailabilityTags(
    enrichment?.hours ?? null,
    poi.tags.opening_hours ?? null,
  );
  if (availability.length > 0) parts.push(availability.join(" · "));

  parts.push(`km ${(poi.alongTraceDistance / 1000).toFixed(1)} — ${Math.round(poi.distanceToTrace)}m from route`);
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
    if (enrichment.priceLevel != null) parts.push(`<b>Price:</b> ${"$".repeat(enrichment.priceLevel)}`);
    if (enrichment.hours) parts.push(`<b>Hours:</b><br/>${formatHoursHtml(enrichment.hours)}`);
    // New compact fields
    if (enrichment.description) parts.push(`<i>${escapeXml(enrichment.description)}</i>`);
    if (enrichment.review) parts.push(`${escapeXml(enrichment.review)}`);
    // Cautions/divergences/source rollup
    if (enrichment.structured?.cautions?.length) {
      parts.push(`<b>Cautions:</b> ${escapeXml(enrichment.structured.cautions.join(" "))}`);
    }
    if (enrichment.structured?.divergences?.length) {
      parts.push(`<b>Divergences:</b> ${escapeXml(enrichment.structured.divergences.join(" "))}`);
    }
    if (enrichment.structured?.sourceRollup?.length) {
      parts.push(...enrichment.structured.sourceRollup.map((digest) => `<b>Source - ${escapeXml(digest.platform)}:</b> ${escapeXml(digest.brief)}`));
    }
    if (enrichment.locality) parts.push(`<b>Location:</b> ${escapeXml(enrichment.locality)}`);
    if (enrichment.sourceCount > 0) parts.push(`<b>Sources:</b> ${enrichment.sourceCount}`);
    if (enrichment.confidence > 0) parts.push(`<b>Confidence:</b> ${Math.round(enrichment.confidence * 100)}%`);
    if (enrichment.synthesisSource) parts.push(`<b>Synthesis:</b> ${escapeXml(enrichment.synthesisSource)}${enrichment.synthesisReason ? ` (${escapeXml(enrichment.synthesisReason)})` : ""}`);
    if (enrichment.googleMapsFields?.length) parts.push(`<b>Google Maps fields:</b> ${escapeXml(enrichment.googleMapsFields.join(", "))}`);
    if (enrichment.googleMapsUrl) parts.push(`<a href="${escapeXml(enrichment.googleMapsUrl)}">Google Maps</a>`);
  } else {
    if (poi.tags.opening_hours)
      parts.push(`<b>Hours:</b> ${escapeXml(poi.tags.opening_hours)}`);
  }

  if (poi.tags.phone) parts.push(`<b>Phone:</b> ${escapeXml(poi.tags.phone)}`);
  if (poi.tags.website) {
    const safeUrl = /^https?:\/\//i.test(poi.tags.website) ? escapeXml(poi.tags.website) : "#";
    parts.push(
      `<b>Web:</b> <a href="${safeUrl}">${escapeXml(poi.tags.website)}</a>`,
    );
  }
  if (poi.tags.fee) parts.push(`<b>Fee:</b> ${escapeXml(poi.tags.fee)}`);

  // Availability highlights
  const availabilityHtml = getAvailabilityTags(
    enrichment?.hours ?? null,
    poi.tags.opening_hours ?? null,
  );
  if (availabilityHtml.length > 0) {
    parts.push(`<b style="color:#16a34a">${availabilityHtml.join(" · ")}</b>`);
  }

  parts.push(
    `<b>km ${(poi.alongTraceDistance / 1000).toFixed(1)}</b> — ${Math.round(poi.distanceToTrace)}m from route`,
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
