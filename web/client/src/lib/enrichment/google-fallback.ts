// --- Google Maps fallback: queue a scraper job when search comes back thin ---

import type {
  GoogleMapsPreview,
  OpeningHoursEntry,
  POI,
  SearchSnippet,
  TargetLanguage,
} from "../../types";
import { dlog } from "../debug-log";
import { t } from "../i18n";
import {
  buildGoogleMapsSnippets,
  buildGoogleMapsUrl,
  enqueueGoogleMapsPreview,
  pollGoogleMapsPreviewJob,
} from "./google-maps";

/**
 * Max time (ms) a running Google Maps fallback job may take before moving on.
 * 90s: the scraper sleeps 4-12s before each page, so a shorter deadline burns
 * quota without ever landing.
 */
export const GOOGLE_FALLBACK_TIMEOUT_MS = 90_000;

/**
 * Max time (ms) a job may sit in the server queue. The queue is serial (one
 * page every ~35 s) and search runs 3 POIs at a time: counted from enqueue,
 * the 90 s deadline expired for every third POI, so it only starts once the
 * job runs and this cap bounds the wait in the queue.
 */
export const GOOGLE_FALLBACK_QUEUE_TIMEOUT_MS = 10 * 60_000;

export async function resolveGoogleMapsFallbackSnippets(
  poi: POI,
  lang: TargetLanguage,
  onGoogleFallbackStatus?: (status: string | null) => void,
  signal?: AbortSignal,
): Promise<{
  snippets: SearchSnippet[];
  structuredHours: OpeningHoursEntry[] | null;
  preview: GoogleMapsPreview | null;
}> {
  // Queued and running lookups show in the queue notice: this status only reports failures
  const job = await enqueueGoogleMapsPreview(buildGoogleMapsUrl(poi), signal, poi.name ?? null);
  if (!job) {
    onGoogleFallbackStatus?.(t("google.queueFailed", lang, { name: poi.name }));
    return { snippets: [], structuredHours: null, preview: null };
  }

  let current = job;
  const queueDeadline = Date.now() + GOOGLE_FALLBACK_QUEUE_TIMEOUT_MS;
  let runDeadline: number | null = null;
  while (!signal?.aborted && current.status !== "done" && current.status !== "error") {
    if (current.status === "running" && runDeadline === null) {
      runDeadline = Date.now() + GOOGLE_FALLBACK_TIMEOUT_MS;
    }
    if (Date.now() >= (runDeadline ?? queueDeadline)) {
      onGoogleFallbackStatus?.(t("google.timedOut", lang, { name: poi.name }));
      dlog("enricher").info(
        `Google Maps fallback timed out while ${current.status} for ${poi.name}`,
      );
      return { snippets: [], structuredHours: null, preview: null };
    }
    await new Promise((resolve) => setTimeout(resolve, 3000));
    const polled = await pollGoogleMapsPreviewJob(job.jobId, signal);
    if (!polled) break;
    current = polled;
  }

  onGoogleFallbackStatus?.(
    current.status === "done" ? null : t("google.failed", lang, { name: poi.name }),
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
