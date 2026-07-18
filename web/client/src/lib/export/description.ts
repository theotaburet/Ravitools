// ---------------------------------------------------------------------------
// POI description formatters — compact (GPS screens) and HTML (KML balloons)
// ---------------------------------------------------------------------------

import type { EnrichedData, POI } from "../../types";
import { starString } from "../stars";
import { formatHoursHtml, getAvailabilityTags, splitHoursLines } from "./hours";
import { escapeXml } from "./shared";

// Compact GPX <desc> formatter — optimized for small GPS screens
// (Garmin, Wahoo, COROS, OsmAnd compact view).
// Target: <= 400 chars, prioritized info, one fact per line.
const COMPACT_DESC_MAX_CHARS = 400;
const COMPACT_DESC_TEXT_LINE_MAX = 150;
const COMPACT_DESC_HOURS_LINE_MAX = 90;
const COMPACT_DESC_CAUTION_MAX = 80;

/**
 * Truncate a string to maxLen chars on a word boundary, appending "…" if cut.
 * Returns empty string for empty/null input.
 */
function truncateWords(text: string | null | undefined, maxLen: number): string {
  if (!text) return "";
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= maxLen) return collapsed;
  const slice = collapsed.slice(0, maxLen - 1);
  const lastSpace = slice.lastIndexOf(" ");
  const cut = lastSpace > maxLen * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.replace(/[,.;:!?\-—\s]+$/, "")}…`;
}

/**
 * Format a 7-day opening hours table to a single compact line.
 * Example: "Mo-Fr 8-18 · Sa 9-12 · Su closed"
 */
function formatOpeningHoursCompact(
  entries: { day: string; open: string; close: string | null }[],
): string {
  if (!entries.length) return "";
  const dayMap: Record<string, string> = {
    monday: "Mo",
    tuesday: "Tu",
    wednesday: "We",
    thursday: "Th",
    friday: "Fr",
    saturday: "Sa",
    sunday: "Su",
    mon: "Mo",
    tue: "Tu",
    wed: "We",
    thu: "Th",
    fri: "Fr",
    sat: "Sa",
    sun: "Su",
  };
  const shortenDay = (d: string) => d.replace(/[A-Za-z]+/g, (m) => dayMap[m.toLowerCase()] ?? m);
  const shortenTime = (t: string) => t.replace(/\b0(\d):/g, "$1:").replace(/:00\b/g, "");
  return entries
    .map((e) => {
      const day = shortenDay(e.day);
      if (e.open === "closed") return `${day} closed`;
      // AUDIT R15: legacy free-text hours ("Open 24/7") have no close time —
      // show the text rather than mislabeling the day as closed.
      if (!e.close) return `${day} ${shortenTime(e.open)}`;
      return `${day} ${shortenTime(e.open)}-${shortenTime(e.close)}`;
    })
    .join(" · ");
}

/**
 * Compact one-line opening hours from a raw "Mon-Fri 8-18; Sat 9-12" string.
 */
function compactRawHours(raw: string): string {
  const entries = splitHoursLines(raw);
  if (!entries.length) return "";
  return truncateWords(entries.join(" · "), COMPACT_DESC_HOURS_LINE_MAX);
}

/**
 * Build a compact, GPS-friendly description for a POI waypoint.
 *
 * Prioritized layout (one line each):
 *   L1 (header):  <Category> · ★4.3 (120) · $$ · km 12.5 — 80m
 *   L2 (text):    description (truncated to 150 chars)
 *   L3 (hours):   abbreviated week
 *   L4 (contact): phone | website
 *   L5 (caution): first caution from enrichment, if any
 *
 * Falls back gracefully when enrichment is missing or partial.
 * Output is hard-capped at COMPACT_DESC_MAX_CHARS (400) chars.
 */
export function formatPoiDescriptionCompact(poi: POI, enrichment?: EnrichedData): string {
  const lines: string[] = [];

  // L1 — header: category · rating · price · distance
  const headerBits: string[] = [poi.category];
  if (enrichment?.status === "done" && enrichment.rating != null) {
    const reviewBit = enrichment.reviewCount != null ? ` (${enrichment.reviewCount})` : "";
    headerBits.push(`★${enrichment.rating.toFixed(1)}${reviewBit}`);
  }
  if (enrichment?.status === "done" && enrichment.priceLevel != null && enrichment.priceLevel > 0) {
    headerBits.push("$".repeat(Math.min(enrichment.priceLevel, 4)));
  }
  headerBits.push(
    `km ${(poi.alongTraceDistance / 1000).toFixed(1)} — ${Math.round(poi.distanceToTrace)}m`,
  );
  lines.push(headerBits.join(" · "));

  // L2 — description (LLM-synthesized, single line)
  if (enrichment?.status === "done" && enrichment.description) {
    lines.push(truncateWords(enrichment.description, COMPACT_DESC_TEXT_LINE_MAX));
  }

  // L3 — hours: prefer structured table, then raw enrichment hours, then OSM
  let hoursLine = "";
  if (enrichment?.status === "done" && enrichment.openingHours?.length) {
    hoursLine = formatOpeningHoursCompact(enrichment.openingHours);
  } else if (enrichment?.status === "done" && enrichment.hours) {
    hoursLine = compactRawHours(enrichment.hours);
  } else if (poi.tags.opening_hours) {
    hoursLine = compactRawHours(poi.tags.opening_hours);
  }
  if (hoursLine) {
    lines.push(truncateWords(hoursLine, COMPACT_DESC_HOURS_LINE_MAX));
  }

  // L4 — single best contact (phone wins over website on small screens)
  const phone = poi.tags.phone ?? poi.tags["contact:phone"];
  const website = poi.tags.website ?? poi.tags["contact:website"];
  if (phone) {
    lines.push(`☎ ${phone}`);
  } else if (website) {
    lines.push(website);
  }

  // L5 — first caution from enrichment (high-signal info for cyclist)
  const firstCaution = enrichment?.structured?.cautions?.[0];
  if (firstCaution) {
    lines.push(`⚠ ${truncateWords(firstCaution, COMPACT_DESC_CAUTION_MAX)}`);
  }

  // Hard cap: drop trailing lines until under budget, then truncate as last resort
  let result = lines.join("\n");
  while (result.length > COMPACT_DESC_MAX_CHARS && lines.length > 1) {
    lines.pop();
    result = lines.join("\n");
  }
  if (result.length > COMPACT_DESC_MAX_CHARS) {
    result = truncateWords(result, COMPACT_DESC_MAX_CHARS);
  }
  return result;
}

export function formatPoiDescriptionHtml(poi: POI, enrichment?: EnrichedData): string {
  const parts = [`<b>Category:</b> ${poi.category}`];

  // Enrichment data first
  if (enrichment && enrichment.status === "done") {
    if (enrichment.rating != null) {
      const stars = starString(enrichment.rating);
      parts.push(
        `<b>Rating:</b> ${stars} ${enrichment.rating.toFixed(1)}/5${enrichment.reviewCount != null ? ` (${enrichment.reviewCount} reviews)` : ""}`,
      );
    }
    if (enrichment.priceLevel != null)
      parts.push(`<b>Price:</b> ${"$".repeat(enrichment.priceLevel)}`);
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
      parts.push(
        ...enrichment.structured.sourceRollup.map(
          (digest) => `<b>Source - ${escapeXml(digest.platform)}:</b> ${escapeXml(digest.brief)}`,
        ),
      );
    }
    if (enrichment.locality) parts.push(`<b>Location:</b> ${escapeXml(enrichment.locality)}`);
    if (enrichment.sourceCount > 0) parts.push(`<b>Sources:</b> ${enrichment.sourceCount}`);
    if (enrichment.confidence > 0)
      parts.push(`<b>Confidence:</b> ${Math.round(enrichment.confidence * 100)}%`);
    if (enrichment.synthesisSource)
      parts.push(
        `<b>Synthesis:</b> ${escapeXml(enrichment.synthesisSource)}${enrichment.synthesisReason ? ` (${escapeXml(enrichment.synthesisReason)})` : ""}`,
      );
    if (enrichment.googleMapsFields?.length)
      parts.push(`<b>Google Maps fields:</b> ${escapeXml(enrichment.googleMapsFields.join(", "))}`);
    if (enrichment.googleMapsUrl)
      parts.push(`<a href="${escapeXml(enrichment.googleMapsUrl)}">Google Maps</a>`);
  } else {
    if (poi.tags.opening_hours) parts.push(`<b>Hours:</b> ${escapeXml(poi.tags.opening_hours)}`);
  }

  if (poi.tags.phone) parts.push(`<b>Phone:</b> ${escapeXml(poi.tags.phone)}`);
  if (poi.tags.website) {
    const safeUrl = /^https?:\/\//i.test(poi.tags.website) ? escapeXml(poi.tags.website) : "#";
    parts.push(`<b>Web:</b> <a href="${safeUrl}">${escapeXml(poi.tags.website)}</a>`);
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
