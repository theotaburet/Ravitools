-- Ravitools POI enrichment cache
-- Migration 001: initial schema
--
-- Stores enrichment results keyed by OSM identifier.
-- Anonymous public read/write — no user data, only public OSM POIs + their
-- enrichment (description, hours, rating, ...).
-- TTL is enforced at query time (max_age_days param), no auto-deletion.

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS poi_enrichment (
  osm_type     TEXT        NOT NULL CHECK (osm_type IN ('node', 'way', 'relation')),
  osm_id       BIGINT      NOT NULL,
  category     TEXT        NOT NULL,
  location     GEOGRAPHY(POINT, 4326) NOT NULL,
  name         TEXT,
  enrichment   JSONB       NOT NULL,
  enriched_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (osm_type, osm_id)
);

-- Spatial index for radius search (future endpoint)
CREATE INDEX IF NOT EXISTS poi_enrichment_location_idx
  ON poi_enrichment USING GIST (location);

-- For TTL filtering and admin purge queries
CREATE INDEX IF NOT EXISTS poi_enrichment_enriched_at_idx
  ON poi_enrichment (enriched_at DESC);

-- For category-based admin queries
CREATE INDEX IF NOT EXISTS poi_enrichment_category_idx
  ON poi_enrichment (category);
