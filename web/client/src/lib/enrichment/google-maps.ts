// --- Google Maps: link builder (no API key) + scraper job client + snippets ---

import type {
  GoogleFallbackJobStats,
  GoogleMapsPreview,
  GoogleMapsPreviewJob,
  POI,
  SearchSnippet,
} from "../../types";
import { priceTier } from "../format";
import { flattenHours } from "./llm";
import { API_BASE, fetchJson } from "./proxy-api";

/**
 * Build a Google Maps search URL from POI name + coordinates.
 * Works universally: opens in browser or Google Maps app.
 */
export function buildGoogleMapsUrl(poi: POI): string {
  const query = encodeURIComponent(poi.name);
  return `https://www.google.com/maps/search/${query}/@${poi.lat},${poi.lon},17z`;
}

export async function enqueueGoogleMapsPreview(
  url: string,
  signal?: AbortSignal,
  poiName?: string | null,
): Promise<GoogleMapsPreviewJob | null> {
  return fetchJson<GoogleMapsPreviewJob>(`${API_BASE}/google-maps-preview/jobs`, {
    body: { url, poiName: poiName ?? undefined },
    signal,
  });
}

export async function pollGoogleMapsPreviewJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<GoogleMapsPreviewJob | null> {
  return fetchJson<GoogleMapsPreviewJob>(`${API_BASE}/google-maps-preview/jobs/${jobId}`, {
    signal,
  });
}

export async function fetchGoogleMapsJobStats(
  signal?: AbortSignal,
): Promise<GoogleFallbackJobStats | null> {
  return fetchJson<GoogleFallbackJobStats>(`${API_BASE}/google-maps-preview/jobs`, { signal });
}

export function buildGoogleMapsSnippets(
  preview: GoogleMapsPreview | null | undefined,
): SearchSnippet[] {
  if (!preview) return [];
  const snippets: SearchSnippet[] = [];
  const url = preview.resolvedUrl || preview.url;

  if (preview.snippet) {
    snippets.push({
      title: preview.title ?? "Google Maps",
      url,
      content: preview.snippet,
      engine: "google_maps",
    });
  }

  // Prefer structured hours (full 7-day table) over collapsed hoursText when available
  const hoursDisplay = preview.structuredHours?.length
    ? flattenHours(preview.structuredHours)
    : preview.hoursText;

  const facts = [
    preview.category,
    preview.rating != null ? `Rating ${preview.rating}/5` : null,
    preview.reviewCount != null ? `${preview.reviewCount} reviews` : null,
    preview.priceLevel != null ? `Price ${priceTier(preview.priceLevel)}` : null,
    hoursDisplay,
    preview.address,
    preview.phone,
  ]
    .filter(Boolean)
    .join(". ");

  if (facts) {
    snippets.push({
      title: `${preview.title ?? "Google Maps"} facts`,
      url,
      content: facts,
      engine: "google_maps",
    });
  }

  return snippets;
}
