# Task: Yandex Maps scraper (Phase 3b PR2)
Started: 2026-05-11
Status: done

## Goal
Add a Yandex Maps scraper mirroring the Google Maps one (same fields, same job
system pattern), so that POIs poorly covered by Google get a second source.
Boosts `sourceEngines` count and `confidence` in the client merger.

## Strategy
- URL: `https://yandex.com/maps/?text={poiName}&ll={lon},{lat}&z=16`
- Geo: worldwide attempt, accept low recall outside EU/CIS/Turkey
- Job system: mirror Google (queue, persistence, retry, attempt updates)
- Browser: reuse `getBrowserContext` from `browser-context.ts`

## Steps
- [x] Create task file
- [x] Create `web/server/src/scrapers/yandex-maps.ts`:
  - [x] Type `YandexMapsPreview` (mirrors GoogleMapsPreview shape)
  - [x] `buildYandexMapsUrl(poiName, lat, lon)` helper
  - [x] Pure parsers (rating, review count, hours rows, day normalization)
  - [x] Playwright extractor `fetchYandexMapsPreviewOnce(url, attempt, browser, deps)`
  - [x] Constants: `YANDEX_MAPS_PROXY_URL`, locale-aware day/time normalization
- [x] Wire into `web/server/src/index.ts`:
  - [x] Job system mirror: cache, queue, persist, prune, failure log
  - [x] Wrapper `fetchYandexMapsPreviewOnce` calling scraper module
  - [x] Endpoints: POST `/yandex-maps-preview`, POST/GET/DELETE `/yandex-maps-preview/jobs`
- [x] Add tests `web/server/src/__tests__/yandex-maps.test.ts` (42 tests, pure parsers + endpoint validation)
- [x] Verify: `npx tsc --noEmit` clean, `npm test -- --run` 145/145 pass, `npm run build` clean
- [ ] Commit + push PR2

## Decisions
- URL format: text + coords (better disambiguation than coords-only)
- No geo filter; let scraper return null gracefully when Yandex has no data
- Mirror Google job system structure (do NOT extract shared module yet)
- Endpoint accepts EITHER `{url}` OR `{poiName, lat, lon}` (server builds URL)
- `priceLevel` always null on Yandex (no public DOM signal); kept for shape symmetry
- Multi-locale day/time normalization: EN, RU (full + short forms пн/вт/ср), TR, FR

## Out of scope (PR3)
- Client wiring: call Yandex after Google when Google data insufficient
- Merger logic: how to combine Yandex + Google fields, sourceEngines tagging

