// Scraper job system and endpoints, driven by a mock source so retry / persist /
// load / failure-log logic runs without Playwright or the network.

import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pino from "pino";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createScraperJobSystem } from "../scrapers/job-system.js";
import type { MapPreview, MapScraperPlugin, ScraperDeps } from "../scrapers/types.js";
import { BLOCKED_ERROR_PREFIX, isBlockedError } from "../scrapers/types.js";

const log = pino({ level: "silent" });

const baseDeps: ScraperDeps = {
  log,
  sleep: () => Promise.resolve(),
  randomDelay: () => 0,
  // never actually called by the mock plugin
  getBrowser: () => Promise.reject(new Error("getBrowser not used in tests")),
};

function makePlugin(
  fetchImpl: MapScraperPlugin["fetchOnce"],
  overrides: Partial<MapScraperPlugin> = {},
): MapScraperPlugin {
  return {
    name: "mock-source",
    displayName: "Mock Source",
    validateUrl: (u) => (u.startsWith("https://mock.test/") ? u : null),
    fetchOnce: fetchImpl,
    minDelayMs: 0,
    maxDelayMs: 0,
    retries: 3,
    jobsTtlMs: 60_000,
    ...overrides,
  };
}

function makePreview(url: string): MapPreview {
  return {
    url,
    resolvedUrl: url,
    title: "Mock POI",
    category: null,
    rating: 4.5,
    reviewCount: 10,
    priceLevel: null,
    hoursText: null,
    structuredHours: null,
    address: null,
    phone: null,
    website: null,
    snippet: null,
    fetchedAt: new Date().toISOString(),
  };
}

let originalCwd: string;
let tmp: string;

beforeEach(() => {
  originalCwd = process.cwd();
  tmp = mkdtempSync(join(tmpdir(), "scraper-plugin-test-"));
  process.chdir(tmp);
});

afterEach(() => {
  process.chdir(originalCwd);
  rmSync(tmp, { recursive: true, force: true });
});

describe("createScraperJobSystem: basic wiring", () => {
  it("derives jobsFile and failuresFile from plugin.name", () => {
    const plugin = makePlugin(async () => null);
    const sys = createScraperJobSystem(plugin, baseDeps);
    expect(sys.jobsFile.endsWith(".cache/mock-source-jobs.json")).toBe(true);
    expect(sys.failuresFile.endsWith(".cache/mock-source-failures.jsonl")).toBe(true);
  });

  it("exposes the plugin via system.plugin", () => {
    const plugin = makePlugin(async () => null);
    const sys = createScraperJobSystem(plugin, baseDeps);
    expect(sys.plugin.name).toBe("mock-source");
  });
});

describe("createScraperJobSystem: fetchSync", () => {
  it("returns the preview on first success", async () => {
    const url = "https://mock.test/place/1";
    const plugin = makePlugin(async () => makePreview(url));
    const sys = createScraperJobSystem(plugin, baseDeps);
    const result = await sys.fetchSync(url);
    expect(result?.url).toBe(url);
  });

  it("retries up to plugin.retries times on null and gives up", async () => {
    const fetchOnce = vi.fn().mockResolvedValue(null);
    const plugin = makePlugin(fetchOnce, { retries: 3 });
    const sys = createScraperJobSystem(plugin, baseDeps);
    const result = await sys.fetchSync("https://mock.test/never");
    expect(result).toBeNull();
    expect(fetchOnce).toHaveBeenCalledTimes(3);
  });

  it("retries after a thrown error and succeeds on a later attempt", async () => {
    const url = "https://mock.test/eventual";
    const fetchOnce = vi
      .fn()
      .mockRejectedValueOnce(new Error("transient"))
      .mockResolvedValueOnce(makePreview(url));
    const plugin = makePlugin(fetchOnce, { retries: 3 });
    const sys = createScraperJobSystem(plugin, baseDeps);
    const result = await sys.fetchSync(url);
    expect(result?.url).toBe(url);
    expect(fetchOnce).toHaveBeenCalledTimes(2);
  });

  it("invokes onAttemptUpdate with attempt + lastError when failing", async () => {
    const updates: Array<{
      attempt: number;
      nextRetryAt: string | null;
      lastError: string | null;
    }> = [];
    const fetchOnce = vi.fn().mockRejectedValue(new Error("boom"));
    const plugin = makePlugin(fetchOnce, { retries: 2 });
    const sys = createScraperJobSystem(plugin, baseDeps);
    await sys.fetchSync("https://mock.test/fail", (attempt, nextRetryAt, lastError) => {
      updates.push({ attempt, nextRetryAt, lastError });
    });
    // Should report at least one error update with the message
    expect(updates.some((u) => u.lastError === "boom")).toBe(true);
  });
});

describe("createScraperJobSystem: queueJob lifecycle", () => {
  it("queues a job, runs it, and marks it done with the preview", async () => {
    const url = "https://mock.test/queue/1";
    const plugin = makePlugin(async () => makePreview(url));
    const sys = createScraperJobSystem(plugin, baseDeps);

    const job = await sys.queueJob(url, "Test POI");
    expect(job.status).toBe("queued");
    expect(job.source).toBe("mock-source");
    expect(job.poiName).toBe("Test POI");

    // Wait for the background runner to settle
    await new Promise((r) => setTimeout(r, 30));

    const finished = sys.jobCache.get(job.jobId) as typeof job;
    expect(finished.status).toBe("done");
    expect(finished.preview?.url).toBe(url);
    expect(finished.error).toBeNull();
  });

  it("marks job as error and writes a failure record on persistent failure", async () => {
    const plugin = makePlugin(async () => null, { retries: 2 });
    const sys = createScraperJobSystem(plugin, baseDeps);
    const job = await sys.queueJob("https://mock.test/never", "Doomed");
    await new Promise((r) => setTimeout(r, 30));

    const finished = sys.jobCache.get(job.jobId) as typeof job;
    expect(finished.status).toBe("error");
    expect(finished.preview).toBeNull();
    expect(existsSync(sys.failuresFile)).toBe(true);
    const lines = readFileSync(sys.failuresFile, "utf8").trim().split("\n").filter(Boolean);
    expect(lines.length).toBeGreaterThan(0);
    const last = JSON.parse(lines[lines.length - 1]);
    expect(last.source).toBe("mock-source");
    expect(last.url).toBe("https://mock.test/never");
  });
});

describe("createScraperJobSystem: persist/load roundtrip", () => {
  it("persists done jobs to disk and reloads them", async () => {
    const url = "https://mock.test/persist";
    const plugin = makePlugin(async () => makePreview(url));
    const sys1 = createScraperJobSystem(plugin, baseDeps);
    const job = await sys1.queueJob(url);
    await new Promise((r) => setTimeout(r, 30));

    expect(existsSync(sys1.jobsFile)).toBe(true);

    // Fresh system, same plugin/cwd → load from disk
    const sys2 = createScraperJobSystem(plugin, baseDeps);
    sys2.load();
    const reloaded = sys2.jobCache.get(job.jobId);
    expect(reloaded).toBeTruthy();
    expect((reloaded as typeof job).status).toBe("done");
  });

  it("converts running jobs to error on load (interrupted-by-restart)", async () => {
    const url = "https://mock.test/interrupted";
    const plugin = makePlugin(async () => makePreview(url));
    const sys1 = createScraperJobSystem(plugin, baseDeps);
    // Inject a fake running job and persist
    sys1.jobCache.set("interrupted-1", {
      jobId: "interrupted-1",
      status: "running",
      source: "mock-source",
      url,
      poiName: null,
      preview: null,
      error: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
      attempt: 1,
      nextRetryAt: null,
      lastError: null,
    });
    sys1.persist();

    const sys2 = createScraperJobSystem(plugin, baseDeps);
    sys2.load();
    const reloaded = sys2.jobCache.get("interrupted-1") as { status: string; error: string | null };
    expect(reloaded.status).toBe("error");
    expect(reloaded.error).toMatch(/interrupted/i);
  });
});

describe("blocked detection", () => {
  it("isBlockedError matches the sentinel prefix and nothing else", () => {
    expect(isBlockedError(`${BLOCKED_ERROR_PREFIX} Google CAPTCHA`)).toBe(true);
    expect(isBlockedError("no data returned")).toBe(false);
    expect(isBlockedError(null)).toBe(false);
    expect(isBlockedError(undefined)).toBe(false);
  });

  it("a BLOCKED-tagged throw surfaces as a blocked lastError on the job", async () => {
    const plugin = makePlugin(
      async () => {
        throw new Error(`${BLOCKED_ERROR_PREFIX} test captcha`);
      },
      { retries: 2 },
    );
    const sys = createScraperJobSystem(plugin, baseDeps);
    const job = await sys.queueJob("https://mock.test/blocked", "Blocked POI");
    await new Promise((r) => setTimeout(r, 30));

    const finished = sys.jobCache.get(job.jobId) as typeof job;
    expect(finished.status).toBe("error");
    expect(isBlockedError(finished.lastError)).toBe(true);
  });
});

describe("createScraperJobSystem: pruneStale", () => {
  it("removes terminal jobs older than plugin.jobsTtlMs", () => {
    const plugin = makePlugin(async () => null, { jobsTtlMs: 1000 });
    const sys = createScraperJobSystem(plugin, baseDeps);
    const oldTime = new Date(Date.now() - 10_000).toISOString();
    sys.jobCache.set("old-done", {
      jobId: "old-done",
      status: "done",
      source: "mock-source",
      url: "https://mock.test/old",
      poiName: null,
      preview: null,
      error: null,
      createdAt: oldTime,
      updatedAt: oldTime,
      startedAt: oldTime,
      attempt: 1,
      nextRetryAt: null,
      lastError: null,
    });
    sys.pruneStale();
    expect(sys.jobCache.get("old-done")).toBeUndefined();
  });
});

// --- The job queue must reject floods with 429 once too many jobs are pending ---

describe("mountScraperEndpoints: job queue cap", () => {
  it("returns 429 on the (cap+1)-th queued job", async () => {
    const express = (await import("express")).default;
    const request = (await import("supertest")).default;
    const { mountScraperEndpoints } = await import("../scrapers/endpoints.js");

    // fetchOnce hangs forever so every queued job stays pending
    const plugin = makePlugin(() => new Promise(() => {}));
    const sys = createScraperJobSystem(plugin, baseDeps);
    const app = express();
    app.use(express.json());
    mountScraperEndpoints(app, sys, { basePath: "/scrape/mock-source", log });

    for (let i = 0; i < 50; i++) {
      const res = await request(app)
        .post("/scrape/mock-source/jobs")
        .send({ url: `https://mock.test/place/${i}` });
      expect(res.status).toBe(202);
    }

    const overflow = await request(app)
      .post("/scrape/mock-source/jobs")
      .send({ url: "https://mock.test/place/overflow" });
    expect(overflow.status).toBe(429);
  });
});

// --- The limiter guards Playwright launches, not the cheap status reads ---
// The client polls each job and the stats every 3 s: limited like launches, the
// polls drew 429s within a minute and the client gave up on jobs that succeeded.

describe("mountScraperEndpoints: rate limiter scope", () => {
  it("limits job creation but never job polling or stats", async () => {
    const express = (await import("express")).default;
    const request = (await import("supertest")).default;
    const { mountScraperEndpoints } = await import("../scrapers/endpoints.js");

    const plugin = makePlugin(() => new Promise(() => {}));
    const sys = createScraperJobSystem(plugin, baseDeps);
    const app = express();
    app.use(express.json());
    let launches = 0;
    const limiter: import("express").RequestHandler = (_req, res, next) => {
      launches++;
      if (launches > 1) res.status(429).json({ error: "limited" });
      else next();
    };
    mountScraperEndpoints(app, sys, { basePath: "/scrape/mock-source", log, limiter });

    const job = await request(app)
      .post("/scrape/mock-source/jobs")
      .send({ url: "https://mock.test/place/1" });
    expect(job.status).toBe(202);

    for (let i = 0; i < 5; i++) {
      expect((await request(app).get(`/scrape/mock-source/jobs/${job.body.jobId}`)).status).toBe(
        200,
      );
      expect((await request(app).get("/scrape/mock-source/jobs")).status).toBe(200);
    }
    const second = await request(app)
      .post("/scrape/mock-source/jobs")
      .send({ url: "https://mock.test/place/2" });
    expect(second.status).toBe(429);
  });
});
