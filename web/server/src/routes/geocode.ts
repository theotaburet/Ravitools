import { Router } from "express";
import { geocodeCache } from "../caches.js";
import { NOMINATIM_URL } from "../config.js";
import { isTimeoutError, sendProxyJson } from "../http.js";
import { enrichLimiter } from "../limiters.js";
import { log } from "../logger.js";
import { safeSet } from "../safe-set.js";

export const geocodeRouter = Router();

geocodeRouter.post("/geocode", enrichLimiter, async (req, res) => {
  try {
    const { lat, lon } = req.body as { lat?: number; lon?: number };

    if (typeof lat !== "number" || typeof lon !== "number") {
      res.status(400).json({ error: "Missing 'lat' and 'lon' in request body" });
      return;
    }

    if (lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      res.status(400).json({ error: "Invalid coordinates" });
      return;
    }

    // Cache key — round to ~111m precision for cache efficiency
    const roundedLat = Math.round(lat * 1000) / 1000;
    const roundedLon = Math.round(lon * 1000) / 1000;
    const cacheKey = `geo:${roundedLat},${roundedLon}`;

    const cached = geocodeCache.get<string>(cacheKey);
    if (cached) {
      log.info({ cacheKey }, "Geocode cache hit");
      sendProxyJson(res, cached, "HIT");
      return;
    }

    // Nominatim reverse geocode
    const params = new URLSearchParams({
      lat: lat.toString(),
      lon: lon.toString(),
      format: "json",
      zoom: "14", // city/town level
      addressdetails: "1",
    });

    log.info({ lat: roundedLat, lon: roundedLon }, "Reverse geocoding via Nominatim");

    const geoRes = await fetch(`${NOMINATIM_URL}/reverse?${params.toString()}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": "Ravitools/1.0 (cycling POI enrichment)",
      },
      signal: AbortSignal.timeout(10_000),
    });

    if (!geoRes.ok) {
      const body = await geoRes.text();
      log.warn({ status: geoRes.status }, "Nominatim returned non-OK status");
      res.status(geoRes.status).json({
        error: "Nominatim geocode error",
        status: geoRes.status,
        detail: body.slice(0, 500),
      });
      return;
    }

    const data = await geoRes.text();

    // Cache the response
    safeSet(geocodeCache, cacheKey, data);
    log.info({ cacheKey }, "Cached geocode response");

    sendProxyJson(res, data, "MISS");
  } catch (err: unknown) {
    if (isTimeoutError(err)) {
      log.error("Nominatim request timed out");
      res.status(504).json({ error: "Geocode request timed out" });
      return;
    }
    log.error({ err }, "Geocode proxy error");
    res.status(502).json({ error: "Failed to reach geocode service" });
  }
});
