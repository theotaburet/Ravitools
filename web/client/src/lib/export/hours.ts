// ---------------------------------------------------------------------------
// Hours formatting + Sunday / evening availability detection
// ---------------------------------------------------------------------------

import { escapeXml } from "./shared";

/**
 * Split a raw hours string into per-day entries (AUDIT R32: single flattener).
 * Splits on day-schedule separators (; \n and spaced /) — but not commas
 * within time ranges (e.g. "8:00-12:00, 14:00-18:00").
 */
export function splitHoursLines(raw: string): string[] {
  return raw
    .split(/[;\n]|(?:\s\/\s)/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** Normalize a raw hours string into a clean schedule for HTML output. */
export function formatHoursHtml(raw: string): string {
  if (!raw) return raw;

  const entries = splitHoursLines(raw);

  if (entries.length <= 1) {
    return escapeXml(raw.trim());
  }

  return entries.map((e) => escapeXml(e)).join("<br/>");
}

/** Day abbreviations that indicate Sunday in both OSM and freeform hours */
const SUNDAY_PATTERNS = /\b(su|sun|sunday|dim|dimanche|do|domingo)\b/i;

/** Patterns indicating a day range that includes Sunday (e.g. Mo-Su, Mon-Sun, 7j/7, 7/7) */
const SUNDAY_RANGE_PATTERNS = /\b(mo|mon|lu|lun)\s*[-–]\s*(su|sun|dim|do)\b|7\s*[j/]\s*[/]?\s*7/i;

/** Patterns that explicitly say Sunday is closed */
const SUNDAY_CLOSED =
  /\b(su|sun|sunday|dim|dimanche)\b[^;/\n]*\b(closed|fermé|geschlossen|cerrado)\b/i;

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
      const sunEnd = (sunMatch.index ?? 0) + sunMatch[0].length;
      const afterSun = lower.slice(sunEnd, sunEnd + 30);
      if (!/closed|fermé|geschlossen|cerrado/.test(afterSun)) return true;
    }
  }

  return false;
}

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
