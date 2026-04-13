# Task: Enrichment debug, pulse, i18n
Started: 2026-04-13
Status: done

## Steps
- [x] Console debug: log SearXNG search results + LLM synthesis output via dlog
- [x] Verify LLM summary display in PoiList + RouteMap popup (already implemented)
- [x] Pulse animation on map markers for POIs currently being enriched
- [x] i18n: translate category labels in UI (Filters, PoiList, Map) based on targetLanguage
- [x] i18n: translate generic OSM POI names (Drinking water -> Eau potable, etc.)
- [x] Type-check (0 errors) + tests (176 pass) + build prod OK
- [x] Export parseLlmOutput for testability
- [x] Add tests for parseLlmOutput (27 tests: JSON extraction, markdown stripping, type coercion, edge cases)
- [x] Add tests for searchPoi with mocked fetch (11 tests: dedup, retry, abort, error handling)
- [x] Add tests for i18n translateCategory + translatePoiName (9 tests)
- [x] All 223 tests pass, type-check OK, build OK

## Decisions
- Translation scope: category labels + generic POI names
- Pulse animation on map markers only (CSS `poi-marker-enriching` class)
- i18n module is pure lookup tables, no external dependency
- LLM summary display was already working (translatedSummary || summary)
- Fixed existing TS bug: `enrichingPoiId` was passed to PoiList but not in its Props
