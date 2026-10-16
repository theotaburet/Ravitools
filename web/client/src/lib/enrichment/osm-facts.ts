// --- OSM tags as plain facts, before any web search or LLM ---
// Generic keys any place may carry (beds, booking, fee, operator, water). The
// labels come from the UI string table, so the same fact reads right in the
// list, the popup, the exports and the LLM prompt.

import type { BookingStatus, TargetLanguage } from "../../types";
import { t, tLabel } from "../i18n";

/** UI string key for each booking status, shared by facts, details and exports. */
export const BOOKING_KEY: Record<BookingStatus, string> = {
  required: "poi.bookingRequired",
  recommended: "poi.bookingRecommended",
  not_needed: "poi.bookingNotNeeded",
};

/** OSM `reservation=*` to a booking status; "no" is ambiguous in OSM (not possible vs not needed) and stays out. */
export function bookingStatusFromTag(value: string | undefined): BookingStatus | null {
  if (value === "required" || value === "yes") return "required";
  if (value === "recommended") return "recommended";
  return null;
}

function count(value: string | undefined, key: string, lang: TargetLanguage): string | null {
  const n = value?.match(/^\d+/)?.[0];
  return n ? `${n} ${t(key, lang)}` : null;
}

export function osmFacts(tags: Record<string, string>, lang: TargetLanguage): string[] {
  const booking = bookingStatusFromTag(tags.reservation);
  const facts = [
    count(tags.beds, "fact.beds", lang),
    count(tags.capacity, "fact.places", lang),
    count(tags.rooms, "fact.rooms", lang),
    count(tags.stars, "fact.stars", lang),
    tags.winter_room === "yes" ? t("fact.winterRoom", lang) : null,
    tags.operator ? tLabel("fact.operator", tags.operator, lang) : null,
    booking ? t(BOOKING_KEY[booking], lang) : null,
    tags.fee === "yes" ? t("fact.fee", lang) : tags.fee === "no" ? t("fact.free", lang) : null,
    /^(wlan|wifi|yes)$/.test(tags.internet_access ?? "") ? t("fact.wifi", lang) : null,
    tags.wheelchair === "yes" ? t("fact.wheelchair", lang) : null,
    tags.drinking_water === "yes"
      ? t("fact.drinkingWater", lang)
      : tags.drinking_water === "no"
        ? t("fact.noDrinkingWater", lang)
        : null,
    tags.email ?? tags["contact:email"] ?? null,
  ];
  return facts.filter((fact): fact is string => fact !== null);
}
