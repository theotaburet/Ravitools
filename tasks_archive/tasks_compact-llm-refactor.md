# Task: Compact LLM output refactoring
Started: 2026-04-14
Status: done

## Steps
- [x] Add `OpeningHoursEntry` interface and `openingHours`, `description`, `review` fields to `EnrichedData` type
- [x] Add `"airbnb"` to `ENRICHMENT_PLATFORMS`
- [x] Rewrite LLM prompt for compact format (rating, hours table, description, review, priceLevel)
- [x] Rewrite `parseLlmOutput()` with structured hours parsing
- [x] Update `LlmSynthesis` interface (hours as array, hoursFlat, description, review)
- [x] Update `enricher.ts`: `createBaseEnrichment()`, LLM merge points, `computeConfidence()` signature
- [x] Add `airbnb.` to `classifySourcePlatform()` in `search.ts`
- [x] Add `airbnb` to labels/priority/reputation in `structured.ts`
- [x] Add Airbnb to Sleeping place contract in `poi-config.ts`
- [x] Rewrite `llm-parse.test.ts` (22 tests) for compact format
- [x] Update `fvm.test.ts` (F/G/K/WS10/WS11 sections)
- [x] Fix `enrichment.test.ts` (~21 type errors) - add new fields to all fixtures
- [x] Fix `session.test.ts` - add new fields to `makeEnrichment()`
- [x] Update UI: PoiList (hours table, description/review instead of essentials/summary)
- [x] Update UI: RouteMap (same changes in popup)
- [x] Update UI: EnrichmentSandbox (compact output view, legacy fields dimmed)
- [x] Update `export.ts`: formatPoiDescription/Html use description/review, remove verbose structured fields
- [x] Update `export.ts`: buildGeoJsonObject adds openingHours/description/review properties
- [x] Add CSS: `.poi-hours-table` styles for Google Maps style hours rendering
- [x] Verify: tsc --noEmit (0 errors), npm test (450/450 pass), npm run build (success)

## Decisions
- Removed `headline`, `operationalSummary`, `practicalities`, `unknowns` from export text (too verbose for GPS descriptions)
- Kept `cautions`, `divergences`, `sourceRollup` in exports (actionable safety info)
- Deprecated fields (`summary`, `translatedSummary`, `specialty`, `essentials`) kept in `EnrichedData` for backward compat but no longer primary
- GeoJSON keeps all old property names + adds new ones for backward compat
- Sandbox shows legacy fields dimmed when present (older enrichments)

## Blockers
- None
