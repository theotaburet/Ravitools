import { afterEach, describe, expect, it, vi } from "vitest";
import { TtlCache } from "../caches.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("TtlCache", () => {
  it("evicts the oldest write when full instead of throwing", () => {
    const cache = new TtlCache<number>(60, 2);
    cache.set("a", 1);
    cache.set("b", 2);
    cache.set("a", 10); // an update makes "a" the newest
    cache.set("c", 3);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBe(10);
    expect(cache.get("c")).toBe(3);
    expect(cache.size).toBe(2);
  });

  it("expires entries after the TTL", () => {
    vi.useFakeTimers();
    const cache = new TtlCache<string>(60, 10);
    cache.set("k", "v");
    vi.advanceTimersByTime(59_000);
    expect(cache.get("k")).toBe("v");
    expect(cache.values()).toEqual(["v"]);
    vi.advanceTimersByTime(2_000);
    expect(cache.values()).toEqual([]);
    expect(cache.get("k")).toBeUndefined();
  });
});
