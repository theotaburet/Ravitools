# Task: Phase C — WS4 throughput + WS8 trustworthiness
Started: 2026-04-13
Status: done

## Steps

### WS4: Improve enrichment throughput
- [x] Split enrichment into stages with separate concurrency policies (geocode-search concurrent, LLM serial)
- [x] Replace global `delayBetweenPois` with explicit `runConcurrent()` scheduler (configurable concurrency + stagger)
- [x] Add cancellation checks between every stage (pre-filter, geocode, search, synthesis)
- [x] Update `useEnrichment.ts` progress model to report queue state (phase + ETA)
- [x] Show ETA / phase label in `EnrichmentPanel.tsx` ("Searching..." / "AI synthesis..." + formatEta)
- [x] Add tests for cancellation, partial completion, mixed policies, and phase callbacks (11 tests)

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
