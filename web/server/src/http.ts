import { timingSafeEqual } from "node:crypto";
import type express from "express";

/** Send a cached-or-fresh JSON proxy response with its X-Cache marker (AUDIT R32). */
export function sendProxyJson(
  res: express.Response,
  body: string,
  cacheStatus: "HIT" | "MISS",
): void {
  res.setHeader("X-Cache", cacheStatus);
  res.setHeader("Content-Type", "application/json");
  res.send(body);
}

/** Constant-time secret compare so the admin key can't be probed by timing (AUDIT S2). */
export function timingSafeEqualStr(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function isTimeoutError(err: unknown): boolean {
  return err instanceof Error && (err.name === "AbortError" || err.name === "TimeoutError");
}
