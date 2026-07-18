import { Router } from "express";
import {
  getPoi,
  getPoisBatch,
  isDbAvailable,
  type OsmType,
  type PoiKey,
  upsertPoi,
} from "../db.js";
import { enrichLimiter } from "../limiters.js";

// ---------------------------------------------------------------------------
// POI enrichment cache (Postgres + PostGIS)
// Anonymous public read/write. Returns 503 if DB is not configured.
// ---------------------------------------------------------------------------

const VALID_OSM_TYPES = new Set<OsmType>(["node", "way", "relation"]);

function parseOsmType(raw: unknown): OsmType | null {
  if (typeof raw !== "string") return null;
  return VALID_OSM_TYPES.has(raw as OsmType) ? (raw as OsmType) : null;
}

function parseOsmId(raw: unknown): string | null {
  if (typeof raw === "number" && Number.isFinite(raw) && raw > 0) {
    return String(Math.trunc(raw));
  }
  if (typeof raw === "string" && /^\d{1,19}$/.test(raw)) {
    return raw;
  }
  return null;
}

function parseLatLon(lat: unknown, lon: unknown): { lat: number; lon: number } | null {
  const la = typeof lat === "number" ? lat : Number(lat);
  const lo = typeof lon === "number" ? lon : Number(lon);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  if (la < -90 || la > 90 || lo < -180 || lo > 180) return null;
  return { lat: la, lon: lo };
}

const MAX_BATCH_KEYS = 200;
const MAX_AGE_DAYS_DEFAULT = 90;
const MAX_AGE_DAYS_MAX = 365;

function clampMaxAgeDays(raw: unknown): number {
  const parsed = Number(raw ?? MAX_AGE_DAYS_DEFAULT);
  return Number.isFinite(parsed)
    ? Math.min(Math.max(1, parsed), MAX_AGE_DAYS_MAX)
    : MAX_AGE_DAYS_DEFAULT;
}

export const poiRouter = Router();

/** GET /poi/:osm_type/:osm_id — single lookup */
poiRouter.get("/poi/:osm_type/:osm_id", enrichLimiter, async (req, res) => {
  const osm_type = parseOsmType(req.params.osm_type);
  const osm_id = parseOsmId(req.params.osm_id);
  if (!osm_type || !osm_id) {
    res.status(400).json({ error: "Invalid osm_type or osm_id" });
    return;
  }
  if (!isDbAvailable()) {
    res.status(503).json({ error: "POI cache disabled" });
    return;
  }
  const maxAgeDays = clampMaxAgeDays(req.query.max_age_days);
  const row = await getPoi(osm_type, osm_id, maxAgeDays);
  if (!row) {
    res.status(404).json({ error: "Not found" });
    return;
  }
  res.json(row);
});

/** POST /poi/search — batch lookup body: { keys: [{osm_type, osm_id}], max_age_days? } */
poiRouter.post("/poi/search", enrichLimiter, async (req, res) => {
  const body = req.body as { keys?: unknown; max_age_days?: unknown };
  if (!Array.isArray(body?.keys)) {
    res.status(400).json({ error: "Body must include `keys` array" });
    return;
  }
  if (body.keys.length > MAX_BATCH_KEYS) {
    res.status(400).json({ error: `Too many keys (max ${MAX_BATCH_KEYS})` });
    return;
  }
  if (!isDbAvailable()) {
    res.status(503).json({ error: "POI cache disabled" });
    return;
  }
  const parsed: PoiKey[] = [];
  for (const k of body.keys) {
    if (!k || typeof k !== "object") continue;
    const t = parseOsmType((k as { osm_type?: unknown }).osm_type);
    const id = parseOsmId((k as { osm_id?: unknown }).osm_id);
    if (t && id) parsed.push({ osm_type: t, osm_id: id });
  }
  const maxAgeDays = clampMaxAgeDays(body.max_age_days);
  const found = await getPoisBatch(parsed, maxAgeDays);
  res.json({
    requested: parsed.length,
    hits: found.size,
    misses: parsed.length - found.size,
    results: Array.from(found.values()),
  });
});

/** PUT /poi/:osm_type/:osm_id — upsert enrichment */
// ponytail: intentionally unauthenticated (AUDIT R9 decision). Trust model: the
// shared POI cache is best-effort community data behind enrichLimiter's per-IP
// rate cap; poisoning is bounded (one key per PUT, TTL'd rows, deterministic
// re-enrichment overwrites). Gate behind a write token if this ever goes
// beyond self-hosted deployments.
poiRouter.put("/poi/:osm_type/:osm_id", enrichLimiter, async (req, res) => {
  const osm_type = parseOsmType(req.params.osm_type);
  const osm_id = parseOsmId(req.params.osm_id);
  if (!osm_type || !osm_id) {
    res.status(400).json({ error: "Invalid osm_type or osm_id" });
    return;
  }
  const body = req.body as {
    category?: unknown;
    lat?: unknown;
    lon?: unknown;
    name?: unknown;
    enrichment?: unknown;
  };
  if (
    typeof body?.category !== "string" ||
    body.category.length === 0 ||
    body.category.length > 100
  ) {
    res.status(400).json({ error: "Invalid category" });
    return;
  }
  const coords = parseLatLon(body.lat, body.lon);
  if (!coords) {
    res.status(400).json({ error: "Invalid lat/lon" });
    return;
  }
  if (body.enrichment === null || typeof body.enrichment !== "object") {
    res.status(400).json({ error: "Invalid enrichment payload" });
    return;
  }
  // Soft size guard — JSON.stringify is O(n) but bounded by express.json 1mb limit anyway
  const serialized = JSON.stringify(body.enrichment);
  if (serialized.length > 200_000) {
    res.status(413).json({ error: "Enrichment payload too large" });
    return;
  }
  if (!isDbAvailable()) {
    res.status(503).json({ error: "POI cache disabled" });
    return;
  }
  const name = typeof body.name === "string" ? body.name.slice(0, 500) : null;
  const ok = await upsertPoi({
    osm_type,
    osm_id,
    category: body.category.slice(0, 100),
    lat: coords.lat,
    lon: coords.lon,
    name,
    enrichment: body.enrichment,
  });
  if (!ok) {
    res.status(500).json({ error: "Upsert failed" });
    return;
  }
  res.status(204).end();
});
