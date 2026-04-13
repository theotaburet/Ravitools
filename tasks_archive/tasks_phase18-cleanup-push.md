# Task: Phase 18 — Cleanup, docs, and push
Started: 2026-04-12
Status: done

## Steps
- [x] Clean dead weight: remove empty `workers/` dir, stale `PoiCategoryConfig` import in overpass.ts, dead `enrichments`/`enrichmentJob` fields from AppState and useRavitools
- [x] Rewrite web/README.md — 18 categories, 121 tests, enrichment section, correct colors, updated structure, 5 server endpoints, all env vars
- [x] Update web/docs/architecture.md — enrichment flow, 25-pt chunks, WebLLM, SearXNG, Nominatim, 5 endpoints, updated file map
- [x] Update web/docs/poi-categories.md — add 9 optional categories, color table, OsmAnd mappings step
- [x] Update web/docs/deployment.md — SearXNG setup section, enrichment env vars in systemd and table
- [x] Verify: tsc client clean, tsc server clean, 121 tests pass, build succeeds
- [x] Commit and push

## Decisions
- Removed `enrichments` and `enrichmentJob` from `AppState` because enrichment state is fully managed by the independent `useEnrichment` hook — no need for duplicate state in the main app state
- Kept `EnrichedData`, `EnrichmentJobState`, and `EnrichmentJobStage` types in `types/index.ts` since they are used by the enrichment module
- WebLLM 6MB chunk warning is cosmetic (known), not a blocker for push

## Blockers
- None
