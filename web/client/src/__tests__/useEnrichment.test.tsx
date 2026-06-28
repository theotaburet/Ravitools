// ---------------------------------------------------------------------------
// useEnrichment hook test (M2/T4): model-load state machine, cache-hit
// short-circuit, and CAPTCHA pause/resume. The enrichment lib + shared cache
// are mocked so we drive transitions without WebGPU, SearXNG, or the network.
// ---------------------------------------------------------------------------

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act, cleanup } from "@testing-library/react";
import type { POI, EnrichedData } from "../types";

const mocks = vi.hoisted(() => ({
  isWebGpuAvailable: vi.fn(() => false),
  initEngine: vi.fn(async () => true),
  unloadEngine: vi.fn(async () => undefined),
  enrichBatch: vi.fn(async () => undefined),
  isRetryableEnrichmentResult: vi.fn(() => false),
  fetchGoogleMapsJobStats: vi.fn(async () => null),
  buildCaptchaResolveUrl: vi.fn(() => "http://searxng/captcha"),
  areAllEnginesSuspended: vi.fn(() => false),
  resetEngineFailureState: vi.fn(),
  lookupPoiBatch: vi.fn(async () => new Map()),
  uploadPoiEnrichment: vi.fn(async () => undefined),
  getPoiCacheKey: vi.fn((poi: { id: string }) => poi.id),
}));

vi.mock("../lib/enrichment", () => ({
  isWebGpuAvailable: mocks.isWebGpuAvailable,
  initEngine: mocks.initEngine,
  unloadEngine: mocks.unloadEngine,
  enrichBatch: mocks.enrichBatch,
  isRetryableEnrichmentResult: mocks.isRetryableEnrichmentResult,
  fetchGoogleMapsJobStats: mocks.fetchGoogleMapsJobStats,
  buildCaptchaResolveUrl: mocks.buildCaptchaResolveUrl,
  areAllEnginesSuspended: mocks.areAllEnginesSuspended,
  resetEngineFailureState: mocks.resetEngineFailureState,
}));
vi.mock("../lib/poi-cache", () => ({
  lookupPoiBatch: mocks.lookupPoiBatch,
  uploadPoiEnrichment: mocks.uploadPoiEnrichment,
  getPoiCacheKey: mocks.getPoiCacheKey,
}));
vi.mock("../lib/debug-log", () => ({
  dlog: () => ({ time: () => () => {}, info: () => {}, warn: () => {}, error: () => {}, debug: () => {} }),
}));

import { useEnrichment } from "../hooks/useEnrichment";

const poi = (id: string): POI =>
  ({ id, category: "Restaurant or Bar", name: id }) as unknown as POI;
const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isWebGpuAvailable.mockReturnValue(false);
  mocks.initEngine.mockResolvedValue(true);
  mocks.enrichBatch.mockResolvedValue(undefined);
  mocks.isRetryableEnrichmentResult.mockReturnValue(false);
  mocks.fetchGoogleMapsJobStats.mockResolvedValue(null);
  mocks.buildCaptchaResolveUrl.mockReturnValue("http://searxng/captcha");
  mocks.areAllEnginesSuspended.mockReturnValue(false);
  mocks.lookupPoiBatch.mockResolvedValue(new Map());
  mocks.getPoiCacheKey.mockImplementation((p: { id: string }) => p.id);
  // Mount health-check effect
  globalThis.fetch = vi.fn().mockResolvedValue({
    json: () => Promise.resolve({ services: { searxng: "ok" } }),
  }) as unknown as typeof fetch;
});
afterEach(cleanup);

describe("useEnrichment", () => {
  it("short-circuits to done when every POI is a fresh cache hit", async () => {
    mocks.lookupPoiBatch.mockResolvedValue(
      new Map([
        ["a", { is_stale: false, enrichment: { status: "done" } as EnrichedData }],
        ["b", { is_stale: false, enrichment: { status: "done" } as EnrichedData }],
      ]),
    );
    const { result } = renderHook(() => useEnrichment());
    await act(async () => {
      await result.current.startEnrichment([poi("a"), poi("b")]);
    });
    expect(result.current.job.stage).toBe("done");
    expect(result.current.job.completed).toBe(2);
    expect(result.current.enrichments.size).toBe(2);
    expect(mocks.enrichBatch).not.toHaveBeenCalled();
    expect(mocks.initEngine).not.toHaveBeenCalled();
  });

  it("loads the model then completes when WebGPU is available", async () => {
    mocks.isWebGpuAvailable.mockReturnValue(true);
    const { result } = renderHook(() => useEnrichment());
    await act(async () => {
      await result.current.startEnrichment([poi("a")]);
    });
    expect(mocks.initEngine).toHaveBeenCalledTimes(1);
    expect(mocks.enrichBatch).toHaveBeenCalledTimes(1);
    expect(result.current.job.stage).toBe("done");
  });

  it("pauses for CAPTCHA when all engines are suspended, then resumes to done", async () => {
    mocks.areAllEnginesSuspended.mockReturnValue(true);
    const { result } = renderHook(() => useEnrichment());
    await act(async () => {
      await result.current.startEnrichment([poi("a")]);
    });
    expect(result.current.job.stage).toBe("paused-captcha");
    expect(result.current.job.captchaUrl).toBe("http://searxng/captcha");
    expect(mocks.enrichBatch).toHaveBeenCalledTimes(1);

    // User solved the CAPTCHA → engines no longer blocked.
    mocks.areAllEnginesSuspended.mockReturnValue(false);
    await act(async () => {
      result.current.resumeAfterCaptcha();
    });
    await flush(); // let the un-awaited continueEnrichment chain settle
    expect(result.current.job.stage).toBe("done");
    expect(result.current.job.captchaUrl).toBeNull();
  });
});
