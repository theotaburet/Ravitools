// ---------------------------------------------------------------------------
// Postgres + PostGIS — POI enrichment cache
//
// Anonymous public read/write cache for POI enrichment results.
// Keyed by OSM identifier (osm_type + osm_id). TTL enforced at query time.
//
// The pool is lazily initialized; if DATABASE_URL is unset or the database is
// unreachable, all helpers return null/empty so the rest of the server keeps
// working as a strict proxy (graceful degradation).
// ---------------------------------------------------------------------------
import { Pool, type PoolConfig } from "pg";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import pino from "pino";

const log = pino({
  name: "db",
  transport:
    process.env.NODE_ENV !== "production"
      ? { target: "pino-pretty" }
      : undefined,
});

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export type OsmType = "node" | "way" | "relation";

export interface PoiEnrichmentRow {
  osm_type: OsmType;
  osm_id: string; // bigint serialized as string by pg
  category: string;
  lat: number;
  lon: number;
  name: string | null;
  enrichment: unknown; // EnrichedData blob from client
  enriched_at: string; // ISO timestamp
  is_stale: boolean;
}

export interface PoiKey {
  osm_type: OsmType;
  osm_id: string;
}

// ---------------------------------------------------------------------------
// Pool
// ---------------------------------------------------------------------------
let pool: Pool | null = null;
let initPromise: Promise<void> | null = null;
let initialized = false;
let disabled = false;

const DEFAULT_MAX_AGE_DAYS = 90;

function buildPoolConfig(): PoolConfig | null {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  return {
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };
}

function getPool(): Pool | null {
  if (disabled) return null;
  if (pool) return pool;
  const cfg = buildPoolConfig();
  if (!cfg) {
    disabled = true;
    log.warn("DATABASE_URL unset — POI cache disabled, server will run as proxy only");
    return null;
  }
  pool = new Pool(cfg);
  pool.on("error", (err) => {
    log.error({ err: err.message }, "Postgres pool error");
  });
  return pool;
}

// ---------------------------------------------------------------------------
// Migrations — apply all SQL files in /migrations once at startup
// ---------------------------------------------------------------------------
async function runMigrations(p: Pool): Promise<void> {
  const dir = join(process.cwd(), "migrations");
  if (!existsSync(dir)) {
    log.warn({ dir }, "Migrations directory not found, skipping");
    return;
  }
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  if (files.length === 0) {
    log.info("No migration files to apply");
    return;
  }
  for (const file of files) {
    const sql = readFileSync(join(dir, file), "utf8");
    log.info({ file }, "Applying migration");
    await p.query(sql);
  }
  log.info({ count: files.length }, "Migrations applied");
}

/**
 * Initialize the pool and apply migrations. Safe to call multiple times.
 * Resolves even on failure (sets disabled = true) so the server can start.
 */
export async function initDb(): Promise<void> {
  if (initialized || disabled) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const p = getPool();
    if (!p) {
      initialized = true;
      return;
    }
    try {
      await p.query("SELECT 1");
      await runMigrations(p);
      initialized = true;
      log.info("Postgres POI cache ready");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      log.error({ err: msg }, "DB init failed — POI cache disabled");
      disabled = true;
      pool = null;
      initialized = true;
    }
  })();
  return initPromise;
}

export function isDbAvailable(): boolean {
  return initialized && !disabled && pool !== null;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Compute is_stale flag from enriched_at timestamp + max_age_days */
function computeIsStale(enrichedAt: Date, maxAgeDays: number): boolean {
  const ageMs = Date.now() - enrichedAt.getTime();
  return ageMs > maxAgeDays * 24 * 3600 * 1000;
}

/** Single lookup. Returns null if not found OR if DB unavailable. */
export async function getPoi(
  osm_type: OsmType,
  osm_id: string,
  maxAgeDays: number = DEFAULT_MAX_AGE_DAYS,
): Promise<PoiEnrichmentRow | null> {
  const p = getPool();
  if (!p || disabled) return null;
  try {
    const { rows } = await p.query<{
      osm_type: OsmType;
      osm_id: string;
      category: string;
      lat: number;
      lon: number;
      name: string | null;
      enrichment: unknown;
      enriched_at: Date;
    }>(
      `SELECT osm_type, osm_id::text AS osm_id, category,
              ST_Y(location::geometry) AS lat,
              ST_X(location::geometry) AS lon,
              name, enrichment, enriched_at
         FROM poi_enrichment
        WHERE osm_type = $1 AND osm_id = $2
        LIMIT 1`,
      [osm_type, osm_id],
    );
    if (rows.length === 0) return null;
    const r = rows[0];
    return {
      osm_type: r.osm_type,
      osm_id: r.osm_id,
      category: r.category,
      lat: Number(r.lat),
      lon: Number(r.lon),
      name: r.name,
      enrichment: r.enrichment,
      enriched_at: r.enriched_at.toISOString(),
      is_stale: computeIsStale(r.enriched_at, maxAgeDays),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, osm_type, osm_id }, "getPoi failed");
    return null;
  }
}

/** Batch lookup. Returns map keyed by `osm_type/osm_id`. Missing entries omitted. */
export async function getPoisBatch(
  keys: PoiKey[],
  maxAgeDays: number = DEFAULT_MAX_AGE_DAYS,
): Promise<Map<string, PoiEnrichmentRow>> {
  const result = new Map<string, PoiEnrichmentRow>();
  const p = getPool();
  if (!p || disabled || keys.length === 0) return result;
  try {
    // Build (osm_type, osm_id) tuple list for the query
    const types = keys.map((k) => k.osm_type);
    const ids = keys.map((k) => k.osm_id);
    const { rows } = await p.query<{
      osm_type: OsmType;
      osm_id: string;
      category: string;
      lat: number;
      lon: number;
      name: string | null;
      enrichment: unknown;
      enriched_at: Date;
    }>(
      `SELECT pe.osm_type, pe.osm_id::text AS osm_id, pe.category,
              ST_Y(pe.location::geometry) AS lat,
              ST_X(pe.location::geometry) AS lon,
              pe.name, pe.enrichment, pe.enriched_at
         FROM poi_enrichment pe
         JOIN unnest($1::text[], $2::bigint[]) AS req(osm_type, osm_id)
           ON pe.osm_type = req.osm_type AND pe.osm_id = req.osm_id`,
      [types, ids],
    );
    for (const r of rows) {
      result.set(`${r.osm_type}/${r.osm_id}`, {
        osm_type: r.osm_type,
        osm_id: r.osm_id,
        category: r.category,
        lat: Number(r.lat),
        lon: Number(r.lon),
        name: r.name,
        enrichment: r.enrichment,
        enriched_at: r.enriched_at.toISOString(),
        is_stale: computeIsStale(r.enriched_at, maxAgeDays),
      });
    }
    return result;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, count: keys.length }, "getPoisBatch failed");
    return result;
  }
}

export interface UpsertPoiInput {
  osm_type: OsmType;
  osm_id: string;
  category: string;
  lat: number;
  lon: number;
  name: string | null;
  enrichment: unknown;
}

/** Upsert a single POI enrichment. Returns true on success, false otherwise. */
export async function upsertPoi(input: UpsertPoiInput): Promise<boolean> {
  const p = getPool();
  if (!p || disabled) return false;
  try {
    await p.query(
      `INSERT INTO poi_enrichment (
         osm_type, osm_id, category, location, name, enrichment, enriched_at, updated_at
       ) VALUES (
         $1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, $6, $7, NOW(), NOW()
       )
       ON CONFLICT (osm_type, osm_id) DO UPDATE SET
         category    = EXCLUDED.category,
         location    = EXCLUDED.location,
         name        = EXCLUDED.name,
         enrichment  = EXCLUDED.enrichment,
         enriched_at = NOW(),
         updated_at  = NOW()`,
      [
        input.osm_type,
        input.osm_id,
        input.category,
        input.lon, // ST_MakePoint takes (lon, lat)
        input.lat,
        input.name,
        JSON.stringify(input.enrichment),
      ],
    );
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.error({ err: msg, osm_type: input.osm_type, osm_id: input.osm_id }, "upsertPoi failed");
    return false;
  }
}

/** Cleanup helper for tests */
export async function closeDb(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
  initialized = false;
  initPromise = null;
  disabled = false;
}
