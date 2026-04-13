# Task: Web product hardening roadmap
Started: 2026-04-12
Status: done

## Steps
- [x] Convert review findings into implementation workstreams
- [x] Break each workstream into precise, file-level tasks
- [x] Add sequencing and dependencies between workstreams
- [x] Capture key product decisions and open questions

## Workstreams

### 1. Remove legacy and simplify repo entry points

- [x] Delete Python legacy entry points no longer considered source of truth: `main.py`, `run.py`, `app_frontend.py`
- [x] Delete legacy support directories if unused after validation: `services/`, `utils/`, `exceptions/`, `schemas/`, `config/`
- [x] Remove historical root files if obsolete: `requirements.txt`, `config.yaml`, `CONTEXT.md`, `TODO.md`
- [x] Search the repo for references to deleted legacy files and remove or update them
- [x] Update `README.md` so the repo tells only the web-product story
- [x] Update `AGENTS.md` to remove references that imply Python is still a maintained path
- [x] Verify no npm, docs, agent instructions, or scripts still point to legacy files

### 2. Add target-language summaries for enrichment

- [x] Add a target language concept to enrichment state in `web/client/src/types/index.ts`
- [x] Decide supported values for V1: `fr` and `en`
- [x] Extend `EnrichedData` with fields that separate source-language content from user-facing translated summary
- [x] Add UI control to choose output language in `web/client/src/components/EnrichmentPanel.tsx`
- [x] Persist the language choice in local state first, then localStorage if session persistence is implemented
- [x] Update `web/client/src/hooks/useEnrichment.ts` so `startEnrichment()` accepts the selected target language
- [x] Extend `web/client/src/lib/enrichment/llm.ts` system prompt to request output in a target language instead of preserving snippet language
- [x] Keep source snippets untouched in original language for traceability
- [x] Ensure fallback behavior is explicit when WebGPU is unavailable: raw snippets only, no translated synthesis
- [x] Update `web/client/src/components/PoiList.tsx` to display translated summary when available
- [x] Update `web/client/src/components/RouteMap.tsx` popup rendering to display translated summary when available
- [x] Update `web/client/src/lib/export.ts` to include target-language summary in exports while preserving source URLs
- [x] Add tests for language selection and output shaping in `web/client/src/__tests__/enrichment.test.ts`
- [x] Add tests for exported translated summaries in `web/client/src/__tests__/export.test.ts`

### 3. Make enrichment selective instead of uniformly applied

- [x] Define enrichment priority rules by category in `web/client/src/lib/poi-config.ts`
- [x] Introduce an explicit enrichability policy, for example: `full`, `minimal`, `skip`
- [x] Mark categories like `Restaurant or Bar`, `Food shop`, `Sleeping place`, `Gears` as high-priority candidates
- [x] Mark categories like generic water points, shelters, picnic, toilets as lower-value or skip by default
- [x] Update `web/client/src/types/index.ts` to represent why an item was skipped (`unnamed`, `low-value-category`, `no-results`, `rate-limited`, etc.)
- [x] Update `web/client/src/lib/enrichment/enricher.ts` to skip low-value categories before network calls
- [x] Update `web/client/src/lib/enrichment/enricher.ts` to emit structured skip reasons, not just `status: skipped`
- [x] Update `web/client/src/components/EnrichmentPanel.tsx` to explain how many POIs are enrichable vs total
- [x] Update `web/client/src/components/PoiList.tsx` to show when a POI was intentionally not enriched
- [x] Add a user override in `web/client/src/components/EnrichmentPanel.tsx` for `enrich everything` vs `only useful categories`
- [x] Add tests covering category-based skipping and progress counts in `web/client/src/__tests__/enrichment.test.ts`

### 4. Improve enrichment throughput without breaking rate limits

- [x] Split enrichment into stages with separate concurrency policies: geocode+search concurrent, LLM synthesis serial
- [x] Keep geocode/search with controlled concurrency (configurable, default 3) + stagger delay (default 500ms)
- [x] Keep LLM synthesis serialized (WebLLM is single-threaded)
- [x] Replace global `delayBetweenPois` with `runConcurrent()` scheduler in `web/client/src/lib/enrichment/enricher.ts`
- [x] Add cancellation checks between every stage (pre-filter, geocode, search, each LLM call)
- [x] Update `web/client/src/hooks/useEnrichment.ts` progress model to report phase + ETA
- [x] Show phase label ("Searching..." / "AI synthesis...") and ETA in `web/client/src/components/EnrichmentPanel.tsx`
- [x] Add tests for cancellation, partial completion, mixed policies, and phase callbacks in `web/client/src/__tests__/enrichment.test.ts`

### 5. Add list <-> map interaction

- [ ] Add a selected-POI state at app level in `web/client/src/App.tsx`
- [ ] Pass selection state and handlers down to `PoiList` and `RouteMap`
- [ ] Make clicking a POI in `web/client/src/components/PoiList.tsx` center and open the corresponding marker on the map
- [ ] Make clicking a marker in `web/client/src/components/RouteMap.tsx` highlight the corresponding item in the list
- [ ] Scroll the list to the selected item in `web/client/src/components/PoiList.tsx`
- [ ] Add a visual selected state in both list rows and map markers
- [ ] Preserve selection when filters change if the selected POI is still visible
- [ ] Clear selection safely when the POI disappears because of filtering or reload
- [ ] Add tests for selected-POI state transitions where practical

### 6. Remove the 200-item exploration ceiling in the UI

- [ ] Replace the hard `slice(0, 200)` in `web/client/src/components/PoiList.tsx`
- [ ] Choose a strategy: pagination, virtualized list, or progressive rendering
- [ ] Prefer virtualization if dense urban traces are a core target
- [ ] Add a visible sort mode label so the user understands list ordering
- [ ] Add controls for sorting by distance to route, category, or route progression if implemented later
- [ ] Ensure enrichment data updates do not cause heavy rerenders across the full list
- [ ] Verify acceptable performance on a dense example GPX such as `web/examples/paris-urban-short.gpx`

### 7. Add session persistence for before-ride planning

- [ ] Define exactly what should persist: selected categories, imported route metadata, found POIs, enrichment results, export-ready state, language choice
- [ ] Add a serialization layer for app state in a dedicated helper under `web/client/src/lib/`
- [ ] Persist only data safe and useful to keep locally; avoid unnecessary duplication of raw blobs
- [ ] Save state to `localStorage` after successful pipeline completion
- [ ] Restore state on app load in `web/client/src/App.tsx` or a dedicated hook
- [ ] Add a versioned persistence format to survive schema evolution
- [ ] Add a visible `resume previous session` or `clear saved session` affordance in the UI
- [ ] Ensure reset clears both in-memory and persisted state when the user asks for a fresh start
- [ ] Add tests for serialization, restoration, and version invalidation

### 8. Make enrichment outputs more trustworthy

- [x] Extend `EnrichedData` in `web/client/src/types/index.ts` with traceability fields: snippet count, source engines, confidence, skip reason
- [x] Compute a lightweight confidence score in `web/client/src/lib/enrichment/enricher.ts` based on source count, source agreement, and presence of structured fields
- [x] Surface `n sources` and confidence in `web/client/src/components/PoiList.tsx`
- [x] Surface the same confidence and source count in `web/client/src/components/RouteMap.tsx`
- [x] Add a `view sources` disclosure in list and/or popup UI
- [x] Include confidence metadata and source URLs in exports from `web/client/src/lib/export.ts`
- [x] Update the prompt in `web/client/src/lib/enrichment/llm.ts` so the model prefers explicit uncertainty over invented detail
- [x] Add tests that verify confidence and source metadata are preserved in exports and UI shaping

### 9. Clarify review aggregation semantics

- [x] Decide product semantics for ratings: simple extracted average, source-reported average, or unknown if ambiguous
- [x] Do not claim `median` unless it is actually computed from source data
- [x] Rename fields or labels in `web/client/src/types/index.ts` and UI if needed to avoid overclaiming
- [x] Update UI copy in `web/client/src/components/PoiList.tsx` and `web/client/src/components/RouteMap.tsx` to say exactly what the number means
- [x] Update `web/README.md` to reflect the chosen semantics accurately

### 10. Server-side reliability and test coverage

- [ ] Add server tests for `/overpass`, `/search`, and `/geocode`
- [ ] Test cache-hit and cache-miss behavior for all 3 proxy flows
- [ ] Test timeout handling and upstream error propagation
- [ ] Test query/body validation and oversize request rejection
- [ ] Verify CORS, rate-limit, and content-type behavior in edge cases
- [ ] Decide whether the in-memory cache is enough for production or if a persistent cache is needed

## Sequencing

- [x] Phase A: repo cleanup + review semantics + doc truthfulness
- [x] Phase B: selective enrichment + target-language summaries
- [x] Phase C: throughput improvements + trust/confidence metadata
- [ ] Phase D: list/map interaction + remove 200-item cap + session persistence
- [ ] Phase E: server test coverage and production hardening

## Decisions
- The highest product leverage is not more categories; it is better enrichment quality, better trust, and better usability before and during the ride.
- Translation should be implemented as target-language synthesis, not by mutating or hiding raw source snippets.
- Skipping low-value enrichment targets is a feature, not a failure, if the product explains it clearly.

## Open Questions
- Do we persist the full found-POI list and enrichment payload, or only enough state to recompute quickly?
- Do we expose one target language only for the whole session, or per-export as well?
- Is `Google Maps` the only external deep link worth exporting, or should Apple Maps / OsmAnd deep links be added later?

## Blockers
- None
