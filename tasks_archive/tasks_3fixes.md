# Task: 3 Fixes — Failed Chunks Warning, POI Icons, Progress Bar
Started: 2026-04-13
Status: done

## Steps

### Fix 1: Failed Overpass chunks warning
- [x] `queryAllPois` returns `{ elements, failedChunks, totalChunks }` via `QueryAllPoisResult` interface
- [x] `useRavitools` builds warning message when failedChunks > 0
- [x] `App.tsx` renders `.warning-box` banner (amber, partial results) with "Retry failed chunks" button
- [x] No test changes needed — `queryAllPois` not directly tested, only builders

### Fix 2: POI icons on map markers
- [x] Created `CATEGORY_EMOJI` mapping (18 categories → emoji) in `poi-config.ts`
- [x] Replaced `CircleMarker` with `Marker` using Leaflet `DivIcon` (emoji in colored circle)
- [x] Style: `.poi-marker` (category bg, neobrutalist border 2.5px, box-shadow) + `.poi-marker-selected`
- [x] Updated `FlyToSelected` and marker refs from `L.CircleMarker` to `L.Marker`
- [x] No test changes needed

### Fix 3: Overpass progress bar
- [x] Added `progressRatio: number | null` and `warning: string | null` to `AppState`
- [x] Wired `onProgress` callback to set numeric `progressRatio` (0 → 1) during Overpass querying
- [x] Rendered `.progress-bar-track` + `.progress-bar-fill` inside status-bar during querying
- [x] Reset `progressRatio` to null after querying completes (done/error)

### Final
- [x] Type check passes (`npx tsc --noEmit`)
- [x] All 171 client tests pass
- [x] All 32 server tests pass
- [x] Build succeeds

## Decisions
- POI icons use emoji (universal, no font dependency) instead of SVG sprite or icon font
- `DivIcon` with inline style for background color — avoids creating a CSS class per category
- Warning is non-blocking: user sees results + amber banner + retry button (not an error state)
- `progressRatio` is `null` when not in querying stage (indeterminate states show spinner only)

## Blockers
- (none)
