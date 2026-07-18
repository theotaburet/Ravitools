// ---------------------------------------------------------------------------
// Google Maps fallback — queue a scraper job when search comes back thin
// ---------------------------------------------------------------------------

import type { GoogleMapsPreview, OpeningHoursEntry, POI, SearchSnippet } from "../../types";
import { dlog } from "../debug-log";
import {
  buildGoogleMapsSnippets,
  buildGoogleMapsUrl,
  enqueueGoogleMapsPreview,
  pollGoogleMapsPreviewJob,
} from "./search";

/**
 * Max time (ms) to wait for a Google Maps fallback job before moving on.
 * AUDIT R16 (decision): 90s — the scraper sleeps 4-12s before each page and the
 * queue is serial, so the old 10s deadline burned quota without ever landing.
 */
export const GOOGLE_FALLBACK_TIMEOUT_MS = 90_000;

export async function resolveGoogleMapsFallbackSnippets(
  poi: POI,
  apiBase: string,
  onGoogleFallbackStatus?: (status: string | null) => void,
  signal?: AbortSignal,
): Promise<{
  snippets: SearchSnippet[];
  structuredHours: OpeningHoursEntry[] | null;
  preview: GoogleMapsPreview | null;
}> {
  onGoogleFallbackStatus?.(`Queued Google Maps fallback for ${poi.name}`);
  const job = await enqueueGoogleMapsPreview(
    buildGoogleMapsUrl(poi),
    apiBase,
    signal,
    poi.name ?? null,
  );
  if (!job) {
    onGoogleFallbackStatus?.(`Google Maps fallback failed to queue for ${poi.name}`);
    return { snippets: [], structuredHours: null, preview: null };
  }

  let current = job;
  const deadline = Date.now() + GOOGLE_FALLBACK_TIMEOUT_MS;
  while (!signal?.aborted && current.status !== "done" && current.status !== "error") {
    if (Date.now() >= deadline) {
      onGoogleFallbackStatus?.(`Google Maps fallback timed out for ${poi.name} — moving on`);
      dlog("enricher").info(
        `Google Maps fallback timed out after ${GOOGLE_FALLBACK_TIMEOUT_MS}ms for ${poi.name}`,
      );
      return { snippets: [], structuredHours: null, preview: null };
    }
    onGoogleFallbackStatus?.(`Waiting in Google queue for ${poi.name} (${current.status})`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const polled = await pollGoogleMapsPreviewJob(job.jobId, apiBase, signal);
    if (!polled) break;
    current = polled;
  }

  onGoogleFallbackStatus?.(
    current.status === "done"
      ? `Google Maps fallback completed for ${poi.name}`
      : `Google Maps fallback failed for ${poi.name}`,
  );
  const preview = current.preview;
  return {
    snippets: preview ? buildGoogleMapsSnippets(preview) : [],
    structuredHours: preview?.structuredHours ?? null,
    preview: preview ?? null,
  };
}

/**
 * Build the list of field names that were sourced from a Google Maps preview.
 * Only includes fields that are actually non-null/non-empty in the preview.
 */
export function buildGoogleMapsFields(
  preview: GoogleMapsPreview | null | undefined,
): string[] | undefined {
  if (!preview) return undefined;
  const fields: string[] = [];
  if (preview.structuredHours?.length || preview.hoursText) fields.push("openingHours");
  if (preview.rating != null) fields.push("rating");
  if (preview.reviewCount != null) fields.push("reviewCount");
  if (preview.address) fields.push("address");
  if (preview.phone) fields.push("phone");
  if (preview.website) fields.push("website");
  if (preview.priceLevel != null) fields.push("priceLevel");
  if (preview.category) fields.push("category");
  return fields.length > 0 ? fields : undefined;
}
