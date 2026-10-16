import type express from "express";
import type { TtlCache } from "./caches.js";
import { log } from "./logger.js";

export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}

function sendJson(res: express.Response, body: string, cacheStatus: "HIT" | "MISS"): void {
  res.setHeader("X-Cache", cacheStatus);
  res.setHeader("Content-Type", "application/json");
  res.send(body);
}

/**
 * Answer from `cache`, else from `upstream()` and cache its body. A non-OK
 * upstream passes through with its status (undefined: none answered, 502), a
 * body `isValid` rejects is a 502 and never cached, a timeout a 504.
 */
export async function cachedProxy(
  res: express.Response,
  name: string,
  cache: TtlCache<string>,
  key: string,
  upstream: () => Promise<Response | undefined>,
  isValid: (body: string) => boolean = () => true,
): Promise<void> {
  const cached = cache.get(key);
  if (cached) {
    sendJson(res, cached, "HIT");
    return;
  }
  try {
    const upstreamRes = await upstream();
    if (!upstreamRes?.ok) {
      const status = upstreamRes?.status;
      const detail = upstreamRes ? await upstreamRes.text() : `No ${name} instance answered`;
      log.warn({ status }, `${name} returned non-OK status`);
      res
        .status(status ?? 502)
        .json({ error: `${name} error`, status, detail: detail.slice(0, 500) });
      return;
    }
    const body = await upstreamRes.text();
    if (!isValid(body)) {
      log.warn({ bytes: body.length }, `${name} returned an invalid body`);
      res.status(502).json({ error: `${name} returned an invalid response` });
      return;
    }
    cache.set(key, body);
    log.info({ key, bytes: body.length }, `${name} response cached`);
    sendJson(res, body, "MISS");
  } catch (err) {
    if (isTimeoutError(err)) {
      log.error(`${name} request timed out`);
      res.status(504).json({ error: `${name} request timed out` });
      return;
    }
    log.error({ err }, `${name} proxy error`);
    res.status(502).json({ error: `Failed to reach ${name}` });
  }
}
