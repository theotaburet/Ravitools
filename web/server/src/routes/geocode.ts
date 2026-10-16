import { Router } from "express";
import { geocodeCache } from "../caches.js";
import { NOMINATIM_URL, USER_AGENT } from "../config.js";
import { cachedProxy } from "../http.js";
import { enrichLimiter } from "../limiters.js";

export const geocodeRouter = Router();

geocodeRouter.post("/geocode", enrichLimiter, async (req, res) => {
  const { lat, lon } = (req.body ?? {}) as { lat?: number; lon?: number };

  if (typeof lat !== "number" || typeof lon !== "number") {
    res.status(400).json({ error: "Missing 'lat' and 'lon' in request body" });
    return;
  }

  if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
    res.status(400).json({ error: "Invalid coordinates" });
    return;
  }

  // Cache key: round to ~111m precision for cache efficiency
  const cacheKey = `geo:${Math.round(lat * 1000) / 1000},${Math.round(lon * 1000) / 1000}`;

  const params = new URLSearchParams({
    lat: lat.toString(),
    lon: lon.toString(),
    format: "json",
    zoom: "14", // city/town level
    addressdetails: "1",
  });

  await cachedProxy(res, "Nominatim", geocodeCache, cacheKey, () =>
    fetch(`${NOMINATIM_URL}/reverse?${params.toString()}`, {
      headers: { Accept: "application/json", "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(10_000),
    }),
  );
});
