// --- Google Maps fallback: the deadline starts when the job runs, not when it is queued ---

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  GOOGLE_FALLBACK_QUEUE_TIMEOUT_MS,
  GOOGLE_FALLBACK_TIMEOUT_MS,
  resolveGoogleMapsFallbackSnippets,
} from "../lib/enrichment/google-fallback";
import type { GoogleMapsPreview, GoogleMapsPreviewJob, POI } from "../types";

const poi = { id: "n1", name: "Test Shop", lat: 45.2, lon: 6.3 } as POI;

const preview: GoogleMapsPreview = {
  url: "https://www.google.com/maps/search/Test",
  resolvedUrl: null,
  title: "Test Shop",
  category: null,
  rating: 4.2,
  reviewCount: 10,
  priceLevel: null,
  hoursText: null,
  structuredHours: [{ day: "Mon", open: "09:00", close: "18:00" }],
  address: null,
  phone: null,
  website: null,
  snippet: "Test Shop 4.2 (10)",
  fetchedAt: "2026-10-11T00:00:00Z",
};

function job(status: GoogleMapsPreviewJob["status"], done = false): GoogleMapsPreviewJob {
  return {
    jobId: "j1",
    status,
    url: preview.url,
    poiName: poi.name,
    preview: done ? preview : null,
    startedAt: null,
    attempt: 1,
    nextRetryAt: null,
    lastError: null,
  } as GoogleMapsPreviewJob;
}

/** fetch mock: first call enqueues, then each poll answers from the script. */
function mockPolls(statuses: GoogleMapsPreviewJob["status"][]) {
  let polls = 0;
  const fetchMock = vi.fn(async () => {
    const payload =
      polls === 0 ? job("queued") : job(statuses[Math.min(polls - 1, statuses.length - 1)], true);
    polls++;
    return new Response(JSON.stringify(payload), { status: 200 });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const POLL_MS = 3000;
const statusLog: (string | null)[] = [];

describe("resolveGoogleMapsFallbackSnippets", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    statusLog.length = 0;
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("waits through a long queue: the deadline only starts once the job runs", async () => {
    // Serial server queue: 40 polls (120 s) queued, then one running, then done.
    const queuedPolls = Math.ceil((GOOGLE_FALLBACK_TIMEOUT_MS * 1.5) / POLL_MS);
    mockPolls([...Array<"queued">(queuedPolls).fill("queued"), "running", "done"]);

    const pending = resolveGoogleMapsFallbackSnippets(poi, "en", (s) => statusLog.push(s));
    await vi.advanceTimersByTimeAsync(POLL_MS * (queuedPolls + 3));
    const result = await pending;

    expect(result.preview).toEqual(preview);
    expect(result.structuredHours).toEqual(preview.structuredHours);
    expect(statusLog.some((s) => /timed out/.test(s ?? ""))).toBe(false);
  });

  it("stays silent while queued and clears the status once done", async () => {
    mockPolls(["running", "done"]);

    const pending = resolveGoogleMapsFallbackSnippets(poi, "en", (s) => statusLog.push(s));
    await vi.advanceTimersByTimeAsync(POLL_MS * 4);
    await pending;

    // The queue notice already lists queued and running lookups; a success leaves nothing behind
    expect(statusLog).toEqual([null]);
  });

  it("still gives up on a job that runs past the deadline", async () => {
    mockPolls(["running"]);

    const pending = resolveGoogleMapsFallbackSnippets(poi, "en", (s) => statusLog.push(s));
    await vi.advanceTimersByTimeAsync(GOOGLE_FALLBACK_TIMEOUT_MS + POLL_MS * 2);
    const result = await pending;

    expect(result.preview).toBeNull();
    expect(statusLog.some((s) => /timed out/.test(s ?? ""))).toBe(true);
  });

  it("gives up on a job stuck in the queue past the queue cap", async () => {
    mockPolls(["queued"]);

    const pending = resolveGoogleMapsFallbackSnippets(poi, "en", (s) => statusLog.push(s));
    await vi.advanceTimersByTimeAsync(GOOGLE_FALLBACK_QUEUE_TIMEOUT_MS + POLL_MS * 2);
    const result = await pending;

    expect(result.preview).toBeNull();
    expect(statusLog.some((s) => /timed out/.test(s ?? ""))).toBe(true);
  });
});
