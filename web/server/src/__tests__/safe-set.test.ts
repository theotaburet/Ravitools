/**
 * Regression test for audit R1: cache.set throws ECACHEFULL at maxKeys,
 * turning successful upstream fetches into 5xx / unhandled rejections.
 */
import NodeCache from "node-cache";
import { describe, expect, it } from "vitest";
import { safeSet } from "../safe-set.js";

describe("safeSet (R1: full cache must never throw)", () => {
  it("documents the raw bug: node-cache set throws at maxKeys", () => {
    const cache = new NodeCache({ maxKeys: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    expect(() => cache.set("c", 3)).toThrow(/ECACHEFULL|max/i);
  });

  it("does not throw when the cache is at maxKeys, and stores the value", () => {
    const cache = new NodeCache({ maxKeys: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    expect(() => safeSet(cache, "c", 3)).not.toThrow();
    expect(cache.get("c")).toBe(3);
  });

  it("passes ttl through on the normal path", () => {
    const cache = new NodeCache({ maxKeys: 10 });
    safeSet(cache, "k", "v", 60);
    expect(cache.getTtl("k")).toBeGreaterThan(Date.now());
  });

  it("overwriting an existing key at maxKeys still works", () => {
    const cache = new NodeCache({ maxKeys: 2 });
    cache.set("a", 1);
    cache.set("b", 2);
    expect(() => safeSet(cache, "a", 99)).not.toThrow();
    expect(cache.get("a")).toBe(99);
    expect(cache.get("b")).toBe(2);
  });
});
