# Task: Generic scraper plugin system (Phase 3b PR3)
Started: 2026-05-11
Status: done

## Goal
Stop copy-pasting Google's 300-line job system for every new map source.
Extract a `MapScraperPlugin<T>` interface + `createScraperJobSystem(plugin)`
factory so adding Bing / Apple Maps / Mapy.cz / etc. is ~150 lines per source
instead of ~600.

## Strategy
- Pure refactor: existing 145 tests must still pass unchanged
- Backward-compatible: keep `/google-maps-preview*` and `/yandex-maps-preview*`
  as thin aliases that delegate to the generic system
- New endpoint family: `/scrape/:source/preview`, `/scrape/:source/jobs[/:jobId]`
- New unified preview type: `MapPreview` (base) extended per-source via generics

## Steps
- [x] Create task file
- [x] `scrapers/types.ts`: MapPreview base, MapHoursEntry, MapScraperPlugin<T>, ScraperJob<T>, ScraperFailureRecord
- [x] `scrapers/job-system.ts`: createScraperJobSystem(plugin, deps) factory (cache + queue + retry + persist + load + prune + failure log)
- [x] `scrapers/endpoints.ts`: mountScraperEndpoints(app, plugin, system, limiter) — 5 routes
- [x] `scrapers/google-maps.ts`: export `googleMapsPlugin: MapScraperPlugin<GoogleMapsPreview>`
- [x] `scrapers/yandex-maps.ts`: export `yandexMapsPlugin: MapScraperPlugin<YandexMapsPreview>`
- [x] `scrapers/registry.ts`: REGISTRY array + `mountAllScrapers(...)` (canonical + legacy aliases)
- [x] Rewire `index.ts`: deleted ~780 lines of duplicated logic (1781 → 1001), call mountAllScrapers
- [x] Rewire `_testExports`: legacy shape preserved via system accessors (jobCache, persist, load, appendFailure, file paths)
- [x] `__tests__/scraper-plugin.test.ts`: 11 generic tests (wiring, fetchSync retry/success/error, queueJob lifecycle, persist/load roundtrip, pruneStale)
- [x] Pre-validate URL syntax in endpoints (back-compat with legacy "Invalid URL" error)
- [x] Verify: `npx tsc --noEmit` clean (server + client), `npm run build` clean, `npm test` 156/156 ✅

## Decisions
- Generic system NOT a base class hierarchy: prefer composition (factory + plugin object) for testability
- Each plugin owns its cache TTL (different sources may want different freshness)
- Legacy `/google-maps-preview` POST returns the same shape as before (clients unmodified)
- Legacy `/yandex-maps-preview` accepts both `{url}` and `{poiName, lat, lon}` (preserved)
- New `/scrape/:source/preview` accepts `{url}` and optionally `{poiName, lat, lon, ...extra}` for plugin-specific URL building
- Failure file path / jobs file path / cache key prefix derived from `plugin.name` (no per-plugin config)
- Browser-context sharing remains in scraper modules (not in factory) — factory is engine-agnostic
- `ScraperJobSystem<T>` exposes `jobsFile`/`failuresFile` paths so tests can introspect without re-deriving them
- Cancellation of `running` jobs marks them error("Cancelled by user") — Playwright not aborted in-flight

## Outcome
- `web/server/src/index.ts`: 1781 → 1001 lines (−780, −44%)
- New code: 4 files / ~756 lines (`types.ts` 149, `job-system.ts` 358, `endpoints.ts` 192, `registry.ts` 78)
- Tests: 145 → 156 (+11 generic plugin tests; all 145 originals untouched)
- Adding a new map source (Bing, Apple, Mapy.cz, …) now ≈ one plugin file + 1 line in `REGISTRY`
