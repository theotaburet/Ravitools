# Task: Phase C — WS4 throughput + WS8 trustworthiness
Started: 2026-04-13
Status: in-progress

## Steps

### WS4: Improve enrichment throughput
- [ ] Measure baseline enrichment time per POI (document in this file)
- [ ] Split enrichment into stages with separate concurrency policies
- [ ] Replace global `delayBetweenPois` with explicit queue/scheduler
- [ ] Add cancellation checks between every stage
- [ ] Update `useEnrichment.ts` progress model to report queue state
- [ ] Show ETA / phase label in `EnrichmentPanel.tsx`
- [ ] Add tests for cancellation and partial completion

### WS8: Make enrichment outputs more trustworthy
- [x] Add confidence/source fields to `EnrichedData`
- [x] Compute confidence score in `enricher.ts`
- [x] Surface source count + confidence in `PoiList` and `RouteMap`
- [x] Add "view sources" disclosure in list/popup UI
- [x] Include confidence metadata in exports (GeoJSON, GPX text, KML HTML)
- [x] Update LLM prompt for explicit uncertainty preference
- [x] Add tests for confidence scoring, source metadata in exports, and UI shaping

## Decisions
- Confidence formula: sourceFactor = min(snippetCount/7, 0.7) + diversityFactor = min(engines*0.1, 0.15) + fieldFactor = min(non-null fields * 0.03, 0.15). Capped at 1.0.
- Labels: high >= 0.6, medium >= 0.3, low > 0, none = 0
- extractEngines is private; computeConfidence is exported for testing
- LLM prompt hardened: "When snippets are vague or contradictory, say so explicitly. Never fill gaps with plausible-sounding invented detail."

## Blockers
- None
