# Task: phase17-categories-exports
Started: 2026-04-12
Status: done

## Goal
Add 9 optional POI categories, restructure category UI with pre-query selection, add OsmAnd GPX + KMZ export formats, investigate COROS DURA custom maps.

## Steps
- [x] Add 9 optional categories to PoiCategory type (Medical, Pharmacy, Bank & ATM, Post office, Viewpoint, Tourist info, Charging, Picnic, Wifi)
- [x] Add `defaultEnabled` field to PoiCategoryConfig
- [x] Rewrite poi-config.ts with 18 categories + OsmAnd mappings for all
- [x] Fix DIY color collision (#CC0000 -> #E65100)
- [x] Export DEFAULT_CATEGORIES (9 essential only)
- [x] Add activeCatsRef to useRavitools for closure-safe category snapshot
- [x] Rewrite CategoryFilter.tsx with Essential/Optional sections
- [x] Restructure App.tsx: CategoryFilter always visible before upload
- [x] Add OsmAnd GPX export with osmand: extensions (icon, color, background, points_groups)
- [x] Add KMZ export with DIY ZIP builder (STORE method, CRC-32, no jszip dependency)
- [x] Update ExportPanel.tsx with GPS + Smartphone sections
- [x] Update mapCategoryToGpxSymbol for all 18 categories
- [x] Update poi-config.test.ts: 37 tests covering 18 categories, DEFAULT_CATEGORIES, OsmAnd mappings
- [x] Update export.test.ts: 46 tests covering OsmAnd GPX, KMZ, GPX symbols for all categories
- [x] tsc --noEmit passes
- [x] 105 tests pass
- [x] npm run build passes
- [x] Investigate COROS DURA custom maps — confirmed impossible

## Decisions
- OsmAnd GPX is the best smartphone export: only app supporting custom icons/colors via GPX extensions
- KMZ without jszip: built a minimal ZIP (STORE method) to avoid adding a dependency for a single file archive
- COROS DURA: .csm files are Garmin IMG renamed, COROS doesn't document the render format, tcrouzet's CorosDura project is "Not working"
- DIY and Gears had same color #CC0000: changed DIY to #E65100 (dark orange)
- Uint8Array/Blob TS strictness: cast via `zipBytes.buffer as ArrayBuffer`

## Blockers
- None
