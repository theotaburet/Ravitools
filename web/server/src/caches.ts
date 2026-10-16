import { CACHE_TTL, GEOCODE_CACHE_TTL, SEARCH_CACHE_TTL } from "./config.js";

/**
 * In-memory cache with a TTL, capped at `maxKeys` by evicting the oldest
 * insertion (Map keeps insertion order). Never throws when full.
 * ponytail: expired entries are dropped on read or by eviction, not swept; the cap bounds memory.
 */
export class TtlCache<T> {
  private readonly entries = new Map<string, { value: T; expires: number }>();

  constructor(
    private readonly ttlSec: number,
    private readonly maxKeys: number,
  ) {}

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (entry.expires <= Date.now()) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    // An update moves the key to the end: the most recently written goes last
    this.entries.delete(key);
    if (this.entries.size >= this.maxKeys) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) this.entries.delete(oldest);
    }
    this.entries.set(key, { value, expires: Date.now() + this.ttlSec * 1000 });
  }

  delete(key: string): void {
    this.entries.delete(key);
  }

  clear(): void {
    this.entries.clear();
  }

  /** Live (unexpired) values, oldest first */
  values(): T[] {
    const now = Date.now();
    return [...this.entries.values()].filter((e) => e.expires > now).map((e) => e.value);
  }

  get size(): number {
    return this.entries.size;
  }
}

/** Overpass cache */
export const cache = new TtlCache<string>(CACHE_TTL, 500);

/** Search cache: longer TTL, more keys (POI reviews don't change often) */
export const searchCache = new TtlCache<string>(SEARCH_CACHE_TTL, 5000);

/** Geocode cache: very long TTL (coordinates don't move) */
export const geocodeCache = new TtlCache<string>(GEOCODE_CACHE_TTL, 5000);
