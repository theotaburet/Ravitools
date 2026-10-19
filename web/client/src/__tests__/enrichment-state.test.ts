// Enrichment state atoms test: model-load state machine, cache-hit
// short-circuit, and CAPTCHA pause/resume. The enrichment lib + shared cache
// are mocked so we drive transitions without WebGPU, SearXNG, or the network.

import { createStore } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LlmCapability } from "../lib/enrichment/capability";
import type { EnrichedData, POI } from "../types";

const CAP_NONE: LlmCapability = { level: "unsupported", reasons: ["no-webgpu"], modelSizeMb: 2500 };
const CAP_READY: LlmCapability = { level: "ready", reasons: [], modelSizeMb: 2500 };

const mocks = vi.hoisted(() => ({
  probeLlmCapability: vi.fn(
    async (): Promise<LlmCapability> => ({
      level: "unsupported",
      reasons: ["no-webgpu"],
      modelSizeMb: 2500,
    }),
  ),
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
  poiCacheKey: vi.fn((poi: { id: string }) => poi.id),
}));

vi.mock("../lib/enrichment", () => ({
  probeLlmCapability: mocks.probeLlmCapability,
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
  poiCacheKey: mocks.poiCacheKey,
}));
vi.mock("../lib/debug-log", () => ({
  dlog: () => ({
    time: () => () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  }),
}));

import {
  cancelEnrichmentAtom,
  enrichmentJobAtom,
  enrichmentSettledAtom,
  resumeAfterCaptchaAtom,
  startEnrichmentAtom,
} from "../state/enrichment";
import { enrichmentsAtom } from "../state/route";

const poi = (id: string): POI =>
  ({ id, category: "Restaurant or Bar", name: id }) as unknown as POI;
const flush = () => new Promise((r) => setTimeout(r, 0));

let store: ReturnType<typeof createStore>;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.probeLlmCapability.mockResolvedValue(CAP_NONE);
  mocks.initEngine.mockResolvedValue(true);
  mocks.enrichBatch.mockResolvedValue(undefined);
  mocks.isRetryableEnrichmentResult.mockReturnValue(false);
  mocks.fetchGoogleMapsJobStats.mockResolvedValue(null);
  mocks.buildCaptchaResolveUrl.mockReturnValue("http://searxng/captcha");
  mocks.areAllEnginesSuspended.mockReturnValue(false);
  mocks.lookupPoiBatch.mockResolvedValue(new Map());
  mocks.poiCacheKey.mockImplementation((p: { id: string }) => p.id);
  store = createStore();
  // Clear module-level context (abort controller + paused CAPTCHA params)
  store.set(cancelEnrichmentAtom);
});

describe("enrichment state", () => {
  it("short-circuits to done when every POI is a fresh cache hit", async () => {
    mocks.lookupPoiBatch.mockResolvedValue(
      new Map([
        ["a", { is_stale: false, enrichment: { status: "done" } as EnrichedData }],
        ["b", { is_stale: false, enrichment: { status: "done" } as EnrichedData }],
      ]),
    );
    await store.set(startEnrichmentAtom, [poi("a"), poi("b")]);
    expect(store.get(enrichmentJobAtom).stage).toBe("done");
    expect(store.get(enrichmentJobAtom).completed).toBe(2);
    expect(store.get(enrichmentsAtom).size).toBe(2);
    expect(mocks.enrichBatch).not.toHaveBeenCalled();
    expect(mocks.initEngine).not.toHaveBeenCalled();
  });

  it("re-enriches a cached deterministic result when WebGPU is available", async () => {
    mocks.probeLlmCapability.mockResolvedValue(CAP_READY);
    mocks.lookupPoiBatch.mockResolvedValue(
      new Map([
        [
          "a",
          {
            is_stale: false,
            enrichment: { status: "done", synthesisSource: "deterministic" } as EnrichedData,
          },
        ],
      ]),
    );
    await store.set(startEnrichmentAtom, [poi("a")]);
    expect(mocks.enrichBatch).toHaveBeenCalledTimes(1);
    expect(mocks.enrichBatch).toHaveBeenCalledWith([poi("a")], expect.anything());
  });

  it("loads the model then completes when WebGPU is available", async () => {
    mocks.probeLlmCapability.mockResolvedValue(CAP_READY);
    await store.set(startEnrichmentAtom, [poi("a")]);
    expect(mocks.initEngine).toHaveBeenCalledTimes(1);
    expect(mocks.enrichBatch).toHaveBeenCalledTimes(1);
    expect(store.get(enrichmentJobAtom).stage).toBe("done");
  });

  it("pauses for CAPTCHA when all engines are suspended, then resumes to done", async () => {
    mocks.areAllEnginesSuspended.mockReturnValue(true);
    await store.set(startEnrichmentAtom, [poi("a")]);
    expect(store.get(enrichmentJobAtom).stage).toBe("paused-captcha");
    expect(store.get(enrichmentJobAtom).captchaUrl).toBe("http://searxng/captcha");
    expect(mocks.enrichBatch).toHaveBeenCalledTimes(1);

    // User solved the CAPTCHA → engines no longer blocked.
    mocks.areAllEnginesSuspended.mockReturnValue(false);
    store.set(resumeAfterCaptchaAtom);
    await flush(); // let the un-awaited continueEnrichment chain settle
    expect(store.get(enrichmentJobAtom).stage).toBe("done");
    expect(store.get(enrichmentJobAtom).captchaUrl).toBeNull();
  });
});

// --- A retry pass must never push completed past total ("12/10", bar >100%) ---

describe("search progress", () => {
  it("counts searched POIs and releases them from the in-flight set until synthesis", async () => {
    let midRun: { searched: number; active: string[]; settled: boolean } | null = null;
    type Opts = {
      onPoiStart: (id: string, name: string) => void;
      onSearchProgress: (searched: number, poiId?: string) => void;
    };
    (
      mocks.enrichBatch as unknown as {
        mockImplementationOnce: (impl: (pois: POI[], opts: Opts) => Promise<void>) => void;
      }
    ).mockImplementationOnce(async (_pois, opts) => {
      opts.onSearchProgress(0);
      opts.onPoiStart("a", "a");
      opts.onPoiStart("b", "b");
      opts.onSearchProgress(1, "a");
      const job = store.get(enrichmentJobAtom);
      midRun = {
        searched: job.searched,
        active: [...job.activePoiIds],
        settled: store.get(enrichmentSettledAtom),
      };
    });

    await store.set(startEnrichmentAtom, [poi("a"), poi("b")]);

    expect(midRun).toEqual({ searched: 1, active: ["b"], settled: false });
    expect(store.get(enrichmentSettledAtom)).toBe(true);
  });
});

describe("retry progress clamp", () => {
  it("never reports completed > total after a retry pass", async () => {
    vi.useFakeTimers();
    try {
      const degraded = { status: "error" } as unknown as EnrichedData;
      const done = { status: "done" } as unknown as EnrichedData;
      (
        mocks.isRetryableEnrichmentResult as unknown as {
          mockImplementation: (impl: (e: unknown) => boolean) => void;
        }
      ).mockImplementation((e: unknown) => e === degraded);
      type BatchArgs = [
        POI[],
        { onProgress: (id: string, e: EnrichedData, c?: number, t?: number) => void },
      ];
      const batchMock = mocks.enrichBatch as unknown as {
        mockImplementationOnce: (impl: (...args: BatchArgs) => Promise<void>) => typeof batchMock;
      };
      batchMock
        .mockImplementationOnce(async (pois, opts) => {
          opts.onProgress(pois[0].id, degraded, 1, 1);
        })
        .mockImplementationOnce(async (pois, opts) => {
          opts.onProgress(pois[0].id, done);
        });

      const started = store.set(startEnrichmentAtom, [poi("a")]);
      await vi.advanceTimersByTimeAsync(20_000);
      await started;

      // the retry pass must actually have run for this test to mean anything
      expect(mocks.enrichBatch).toHaveBeenCalledTimes(2);
      const job = store.get(enrichmentJobAtom);
      expect(job.completed).toBeLessThanOrEqual(job.total);
    } finally {
      vi.useRealTimers();
    }
  });
});
