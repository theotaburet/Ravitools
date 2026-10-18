import { createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Router } from "express";
import { cache } from "../caches.js";
import { MAX_QUERY_LENGTH, OVERPASS_URLS, USER_AGENT } from "../config.js";
import { cachedProxy, isTimeoutError } from "../http.js";
import { limiter } from "../limiters.js";
import { log } from "../logger.js";

export const overpassRouter = Router();

// Overpass-api.de allows 2 slots/IP: serialize upstream calls so
// concurrent chunks don't 429 each other. Per-mirror queue if throughput matters.
let overpassQueue: Promise<unknown> = Promise.resolve();
function enqueueOverpass<T>(fn: () => Promise<T>): Promise<T> {
  const run = overpassQueue.then(fn, fn);
  overpassQueue = run.catch(() => undefined);
  return run;
}

/**
 * POST the query to each mirror in turn. A 429 gets ONE same-mirror retry after
 * the announced Retry-After (slots free in 10–45s; instant retries reset the
 * penalty). Returns the successful response, else the last non-OK one, else
 * undefined when every mirror was unreachable. Timeouts re-throw (→ 504).
 */
async function fetchFromMirrors(
  query: string,
  signal: AbortSignal,
  deadline: number,
): Promise<{ res: Response; url: string } | undefined> {
  let last: { res: Response; url: string } | undefined;
  for (const url of OVERPASS_URLS) {
    for (let attempt = 0; attempt < 2; attempt++) {
      let overpassRes: Response;
      try {
        overpassRes = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            "User-Agent": USER_AGENT,
          },
          body: `data=${encodeURIComponent(query)}`,
          signal,
        });
      } catch (err) {
        // A timeout must surface as 504, not be swallowed into a 502.
        if (isTimeoutError(err)) throw err;
        log.warn({ url }, "Overpass fetch failed, trying next");
        break;
      }
      if (overpassRes.ok) return { res: overpassRes, url };
      last = { res: overpassRes, url };
      log.warn({ url, status: overpassRes.status }, "Overpass mirror non-OK");
      if (overpassRes.status !== 429 || attempt > 0) break;
      const header = overpassRes.headers.get("retry-after");
      const parsed = header === null ? Number.NaN : Number(header);
      const waitS = Math.min(Math.max(Number.isFinite(parsed) ? parsed : 15, 0), 45);
      // Waiting must not eat the whole deadline: better to move to the next mirror
      if (Date.now() + waitS * 1000 > deadline - 10_000) break;
      await sleep(waitS * 1000);
    }
  }
  return last;
}

overpassRouter.post("/overpass", limiter, async (req, res) => {
  // Accept query from JSON body or form-encoded body
  const query: string =
    typeof req.body === "string" ? req.body : (req.body?.data ?? req.body?.query);

  if (!query || typeof query !== "string") {
    res.status(400).json({ error: "Missing 'query' or 'data' in request body" });
    return;
  }

  if (query.length > MAX_QUERY_LENGTH) {
    res.status(413).json({
      error: `Query too large (${query.length} chars, max ${MAX_QUERY_LENGTH})`,
    });
    return;
  }

  const cacheKey = createHash("md5").update(query).digest("hex");

  // One shared 180s deadline across all Overpass instances.
  const timeoutSignal = AbortSignal.timeout(180_000);
  const deadline = Date.now() + 180_000;

  await cachedProxy(
    res,
    "Overpass API",
    cache,
    cacheKey,
    async () => {
      const found = (await enqueueOverpass(() => fetchFromMirrors(query, timeoutSignal, deadline)))
        ?.res;
      if (!found?.ok) return found;
      const body = await found.text();
      // A timed-out query answers 200 with a runtime error remark: a 504 that
      // carries it (the client splits the chunk on it), never cached
      const remark = /"remark"\s*:\s*"(runtime error[^"]*)"/.exec(body)?.[1];
      return remark
        ? new Response(JSON.stringify({ remark }), { status: 504 })
        : new Response(body);
    },
    // An HTML error page served with 200 must not be cached as JSON
    (body) => {
      try {
        JSON.parse(body);
        return true;
      } catch {
        return false;
      }
    },
  );
});
