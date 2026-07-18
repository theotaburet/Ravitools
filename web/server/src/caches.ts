import NodeCache from "node-cache";
import { CACHE_TTL, GEOCODE_CACHE_TTL, SEARCH_CACHE_TTL } from "./config.js";

/** Overpass cache */
export const cache = new NodeCache({
  stdTTL: CACHE_TTL,
  checkperiod: 600,
  maxKeys: 500,
});

/** Search cache – longer TTL, more keys (POI reviews don't change often) */
export const searchCache = new NodeCache({
  stdTTL: SEARCH_CACHE_TTL,
  checkperiod: 3600,
  maxKeys: 5000,
});

/** Geocode cache – very long TTL (coordinates don't move) */
export const geocodeCache = new NodeCache({
  stdTTL: GEOCODE_CACHE_TTL,
  checkperiod: 3600,
  maxKeys: 5000,
});
