// --- E5b: Overpass under injected faults (design.md, section 10) ---
// A 100 km trace, one synthetic POI per resampled point, upstream faults played
// in virtual time (fake timers). Contract: the pipeline recovers by itself, so
// every POI arrives without the user clicking "retry".
// VITE_XP_SCORE=1 prints the autoresearch score (lower is better, xp/program.md).

import { afterAll, afterEach, expect, it, vi } from "vitest";
import type { OverpassElement } from "../lib/overpass";
import type { TracePoint } from "../types";

const STEP = 0.0045; // about 500 m, the resampling step
const TRACE: TracePoint[] = Array.from({ length: 200 }, (_, i) => ({
  lat: 44 + i * STEP,
  lon: 1,
}));
const MIRRORS = [
  "overpass-api.de",
  "overpass.kumi.systems",
  "overpass.private.coffee",
  "maps.mail.ru",
];
const CITY = { from: 70, to: 130, maxPoints: 20 }; // more city points per query: Overpass times out
const LIMIT_S = 600; // the run is aborted after 10 virtual minutes

interface Scenario {
  /** HTTP status a mirror answers at virtual second t */
  status: (mirror: number, t: number, rand: () => number) => number;
  city?: boolean;
}

const SCENARIOS: Record<string, Scenario> = {
  healthy: { status: () => 200 },
  flaky: { status: (_m, _t, rand) => (rand() < 0.3 ? 502 : 200) },
  "outage-4min": { status: (_m, t) => (t < 240 ? 502 : 200) },
  // Overloaded mirrors answer 504 at once: a gateway timeout, not a query too heavy
  "overload-504": { status: (_m, t) => (t < 240 ? 504 : 200) },
  "mirror0-down": { status: (m) => (m === 0 ? 502 : 200) },
  "dense-city": { status: () => 200, city: true },
};

/** Deterministic PRNG (mulberry32) */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let x = Math.imul(a ^ (a >>> 15), 1 | a);
    x = (x + Math.imul(x ^ (x >>> 7), 61 | x)) ^ x;
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

/** Trace indices covered by a query's around: path */
function queryPoints(query: string): number[] {
  const path = /around:\d+,([^)]*)\)/.exec(query)?.[1] ?? "";
  const nums = path.split(",").map(Number);
  const idx: number[] = [];
  for (let i = 0; i < nums.length; i += 2) idx.push(Math.round((nums[i] - 44) / STEP));
  return idx;
}

function answer(points: number[], scenario: Scenario): { body: unknown; latencyS: number } {
  const dense = points.filter((i) => i >= CITY.from && i <= CITY.to).length;
  if (scenario.city && dense > CITY.maxPoints) {
    // What Overpass really does: HTTP 200, no elements, a runtime error remark
    return {
      body: { elements: [], remark: 'runtime error: Query timed out in "query" at line 3' },
      latencyS: 120,
    };
  }
  const elements: OverpassElement[] = points.map((i) => ({
    type: "node",
    id: i + 1,
    lat: TRACE[i].lat,
    lon: TRACE[i].lon,
    tags: { amenity: "drinking_water" },
  }));
  return { body: { elements }, latencyS: 3 + 0.15 * points.length };
}

/** Upstream double: the server proxy (serial queue, every mirror in turn) or the mirrors */
function upstream(scenario: Scenario, t0: number) {
  const rand = seeded(42);
  const stats = { requests: 0 };
  const active = new Map<number, number>();
  let proxyFreeAt = 0;
  const now = () => (Date.now() - t0) / 1000;

  const reply = (status: number, body: unknown, latencyS: number, signal?: AbortSignal | null) =>
    new Promise<Response>((resolve, reject) => {
      const id = setTimeout(
        () => resolve(Response.json(body, { status })),
        Math.round(latencyS * 1000),
      );
      signal?.addEventListener("abort", () => {
        clearTimeout(id);
        reject(signal.reason);
      });
    });

  const fetch = async (input: string, init: RequestInit): Promise<Response> => {
    if (input.startsWith("/api/overpass")) {
      const { query } = JSON.parse(String(init.body)) as { query: string };
      const start = Math.max(now(), proxyFreeAt);
      let elapsed = start - now();
      let result: { status: number; body: unknown; latencyS: number } | undefined;
      let lastStatus = 502;
      for (let m = 0; m < MIRRORS.length && !result; m++) {
        stats.requests++;
        lastStatus = scenario.status(m, now() + elapsed, rand);
        if (lastStatus !== 200) {
          elapsed += 2;
          continue;
        }
        result = { status: 200, ...answer(queryPoints(query), scenario) };
        // Like the server: a runtime error remark becomes a 504 that carries it
        const { remark } = result.body as { remark?: string };
        if (remark)
          result = { ...result, status: 504, body: { detail: JSON.stringify({ remark }) } };
      }
      // Like the server: every mirror failed, the last one's status goes through
      result ??= { status: lastStatus, body: { error: "Overpass API error" }, latencyS: 0 };
      proxyFreeAt = start + result.latencyS + (elapsed - (start - now()));
      return reply(result.status, result.body, elapsed + result.latencyS, init.signal);
    }
    const m = MIRRORS.indexOf(new URL(input).hostname);
    if (m < 0) throw new TypeError("Failed to fetch"); // no CORS
    stats.requests++;
    if ((active.get(m) ?? 0) >= 2) return reply(429, { error: "Too Many Requests" }, 0.3);
    const status = scenario.status(m, now(), rand);
    const query = (init.body as URLSearchParams).get("data") ?? "";
    const { body, latencyS } =
      status === 200 ? answer(queryPoints(query), scenario) : { body: {}, latencyS: 2 };
    active.set(m, (active.get(m) ?? 0) + 1);
    try {
      return await reply(status, body, latencyS, init.signal);
    } finally {
      active.set(m, (active.get(m) ?? 1) - 1);
    }
  };
  return { fetch, stats };
}

const results: Record<string, { seconds: number; missing: number; requests: number }> = {};

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

afterAll(() => {
  if (!import.meta.env.VITE_XP_SCORE) return;
  let score = 0;
  for (const [run, r] of Object.entries(results)) {
    const cost = r.seconds + 900 * r.missing + 2 * r.requests;
    score += cost;
    console.log(
      `xp_run: ${run} seconds=${r.seconds.toFixed(0)} missing=${r.missing.toFixed(3)} requests=${r.requests} cost=${cost.toFixed(1)}`,
    );
  }
  console.log(`xp_score: ${score.toFixed(1)}`);
});

const RUNS = Object.keys(SCENARIOS).flatMap((name) =>
  (["proxy", "static"] as const).map((mode) => ({ name, mode })),
);

it.each(RUNS)("$name ($mode): every POI arrives without a click", async ({ name, mode }) => {
  vi.useFakeTimers();
  if (mode === "static") vi.stubEnv("VITE_STANDALONE", "true");
  vi.resetModules(); // fresh client cache per run
  const { queryAllPois } = await import("../lib/overpass");
  const t0 = Date.now();
  const { fetch, stats } = upstream(SCENARIOS[name], t0);
  vi.stubGlobal("fetch", fetch);

  const ctrl = new AbortController();
  let settled = false;
  const run = queryAllPois([TRACE], 1000, undefined, undefined, ctrl.signal).finally(() => {
    settled = true;
  });
  run.catch(() => undefined);
  while (!settled && Date.now() - t0 < LIMIT_S * 1000) await vi.advanceTimersByTimeAsync(1000);
  if (!settled) ctrl.abort();
  const seconds = (Date.now() - t0) / 1000;
  const result = await run.catch(() => undefined);

  const got = new Set(result?.elements.map((e) => e.id));
  const missing = 1 - got.size / TRACE.length;
  results[`${name}/${mode}`] = { seconds, missing, requests: stats.requests };

  expect(result?.failedChunks).toBe(0);
  expect(missing).toBe(0);
  // Only a query Overpass itself calls too heavy is split
  if (!SCENARIOS[name].city) expect(result?.totalChunks).toBe(5);
});
