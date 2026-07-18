// ---------------------------------------------------------------------------
// Nominatim reverse geocode adapter (via server proxy)
// ---------------------------------------------------------------------------

import type { GeoContext } from "../../types";
import { fetchJson, REQUEST_TIMEOUT, timeoutSignal } from "./proxy-api";

/** Nominatim reverse geocode response (simplified) */
interface NominatimReverseResponse {
  address?: {
    city?: string;
    town?: string;
    village?: string;
    hamlet?: string;
    municipality?: string;
    county?: string;
    state?: string;
    country?: string;
  };
  display_name?: string;
}

/**
 * Resolve the locality (city/town/village) and full geographic context
 * for a POI via Nominatim reverse geocode.
 * Uses the server-side proxy to respect Nominatim rate limits.
 */
export async function reverseGeocode(
  lat: number,
  lon: number,
  apiBase: string = "/api",
  signal?: AbortSignal,
): Promise<GeoContext | null> {
  // Non-critical: any failure returns null and enrichment continues without locality.
  const data = await fetchJson<NominatimReverseResponse>(`${apiBase}/geocode`, {
    body: { lat, lon },
    signal: timeoutSignal(REQUEST_TIMEOUT, signal),
  });

  // Pick the most specific locality available
  const addr = data?.address;
  if (!data || !addr) return null;

  const locality =
    addr.city ||
    addr.town ||
    addr.village ||
    addr.hamlet ||
    addr.municipality ||
    addr.county ||
    null;

  return {
    locality,
    county: addr.county ?? null,
    state: addr.state ?? null,
    country: addr.country ?? null,
    countryCode:
      (data as { address?: { country_code?: string } }).address?.country_code?.toLowerCase() ??
      null,
  };
}
