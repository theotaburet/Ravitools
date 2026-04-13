# Task: Retry failed POIs, GPX-order enrichment, hours formatting, continue enrichment, availability tags
Started: 2026-04-13
Status: done

## Steps
- [x] Add retry mechanism in useEnrichment for POIs that failed (error/rate-limited)
- [x] Sort POIs by along-trace distance before enrichment (not by distanceToTrace)
- [x] Improve hours/schedule formatting in export descriptions
- [x] Add "retry" to EnrichmentPhase type union (remove `as EnrichmentPhase` hack)
- [x] Fix retry onProgress error count logic (variable naming)
- [x] Add `continueEnrichment()` — enrich only unenriched/failed POIs (skip done/skipped)
- [x] Add "Continue enrichment (N remaining)" button in EnrichmentPanel
- [x] Wire continueEnrichment + pendingCount in App.tsx
- [x] Show `alongTraceDistance` (km from start) in PoiList, RouteMap popup, exports
- [x] Add availability detection: "Open Sunday" / "Open evenings" in descriptions
- [x] Hours formatting in PoiList + RouteMap (whiteSpace pre-line, split on ;/\n)
- [x] Run tests (224 pass), type-check (clean), build (OK)
- [ ] Commit and push

## Decisions
- Retry: after batch completes, auto-retry error POIs with increased stagger (up to 2 passes)
- GPX order: compute `alongTraceDistance` in poi-processor via projection onto trace segments
- Hours formatting: split on semicolons/newlines, join with \n (text) or <br/> (HTML)
- Continue enrichment: only retries `status === "error"`, skips "done"/"skipped"/"no-results"
- Availability detection: regex-based parsing of OSM + LLM hours for Sunday/evening
- OsmAnd icons: already well-mapped with per-tag overrides, no changes needed
- `enrichmentsRef`: added ref mirror of enrichments state for synchronous reads in callbacks
