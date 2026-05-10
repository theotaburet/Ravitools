# Task: DB Postgres+PostGIS — POI enrichment cache
Started: 2026-05-10
Status: done

## Context
Phase 2 après feature offline GPX (`9bffcd7`). But : éviter de relancer l'enrichment LLM/SearXNG/Google Maps pour des POIs déjà traités par d'autres utilisateurs. Cache partagé anonyme, lecture publique.

## Design decisions
- **Clé** : `osm_type + osm_id` (ex: `node/12345`). Tous nos POIs viennent d'OSM.
- **TTL** : 90 jours. Retourne stale + `is_stale: true` (pas de hard 404). Client décide de re-enrichir.
- **Privacy** : partagé anonymement, lecture publique, écriture publique (pas d'auth).
- **GPX jamais stocké** (privacy by design préservée — on ne stocke que des POIs OSM publics + leur enrichment).
- **Stack** : `pg` (node-postgres), pool de connexions, postgis pour le radius search.
- **Migrations** : SQL files appliqués au démarrage server (pas d'outil migration externe pour rester léger).

## Schema
```sql
CREATE TABLE poi_enrichment (
  osm_type TEXT NOT NULL,        -- 'node' | 'way' | 'relation'
  osm_id BIGINT NOT NULL,
  category TEXT NOT NULL,        -- PoiCategory enum
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  name TEXT,
  enrichment JSONB NOT NULL,     -- EnrichedData blob
  enriched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (osm_type, osm_id)
);
CREATE INDEX poi_enrichment_location_idx ON poi_enrichment USING GIST (location);
CREATE INDEX poi_enrichment_enriched_at_idx ON poi_enrichment (enriched_at DESC);
```

## Endpoints
- `GET /api/poi/:osm_type/:osm_id` → 200 with enrichment + is_stale flag, 404 if not found
- `POST /api/poi/search` body: `{ poi_ids: [{osm_type, osm_id}], max_age_days?: 90 }` → batch lookup (avoid N round trips)
- `PUT /api/poi/:osm_type/:osm_id` body: `{ category, lat, lon, name, enrichment }` → upsert

## Steps
- [x] Décisions design (clé, TTL, privacy)
- [x] Ajouter service postgis au docker-compose.yml
- [x] Créer web/server/migrations/001_init.sql
- [x] Module web/server/src/db.ts (pool + migration runner)
- [x] Endpoint GET /poi/:osm_type/:osm_id
- [x] Endpoint POST /poi/search (batch)
- [x] Endpoint PUT /poi/:osm_type/:osm_id (upsert)
- [x] Tests serveur (16 nouveaux: validation 400 + 503 fallback)
- [x] Module client lib/poi-cache.ts
- [x] Brancher useEnrichment : check DB batch avant lancement local (short-circuit si tout cache)
- [x] Brancher useEnrichment : PUT vers DB après chaque succès (fire-and-forget)
- [x] Tests client poi-cache (12 nouveaux: lookup, upload, graceful degradation)
- [x] tsc + build + tests final (server 95/95, client 492/492)
- [x] Commit + archive

## Result
- 16 nouveaux tests serveur, 12 nouveaux tests client, tous passent
- Graceful degradation totale: si DATABASE_URL unset OU DB down, le serveur retourne 503 et le client tombe en mode no-cache sans casser
- Migration auto au démarrage (pas d'outil externe)
- POIs sans osmId/osmType skip silencieux (pas de tentative cache)
- Counter total/completed correctement adjusté pour inclure les hits cache

## Open questions / followups
- Faut-il un endpoint admin pour purger ? (différé)
- Faut-il rate-limiter le PUT pour éviter abuse ? (oui — réutiliser enrichmentLimiter)
- Migration vers TimescaleDB plus tard si volume explose ? (différé)

## Blockers
- (none)
