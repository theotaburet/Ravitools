import type NodeCache from "node-cache";

/**
 * R1: node-cache throws ECACHEFULL when `maxKeys` is reached, which turned
 * successful upstream fetches into 5xx (or rejected background jobs). A full
 * cache must never throw into the request path.
 */
export function safeSet<T>(cache: NodeCache, key: string, value: T, ttl?: number): boolean {
  try {
    return ttl === undefined ? cache.set(key, value) : cache.set(key, value, ttl);
  } catch {
    // ponytail: evict the oldest-inserted key and retry once; real LRU if churn matters
    const oldest = cache.keys()[0];
    if (oldest === undefined) return false;
    cache.del(oldest);
    try {
      return ttl === undefined ? cache.set(key, value) : cache.set(key, value, ttl);
    } catch {
      return false;
    }
  }
}
