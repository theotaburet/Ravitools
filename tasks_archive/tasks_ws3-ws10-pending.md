# Task: WS3-WS10 – Pending workstreams (transient)
Started: 2026-04-13
Status: done

## Workstream 3 – Selective enrichment
- [x] Define enrichment priority rules by category in poi-config.ts
- [x] Introduce enrichability policy: full, minimal, skip
- [x] Mark high-priority categories: Restaurant, Food shop, Sleeping place, Gears
- [x] Mark low-value categories: water, shelter, picnic, toilets
- [x] Add skip reasons to types
- [x] Update enricher to skip low-value categories
- [x] Add UI for enrichable vs total count
- [x] Add user override for "enrich everything"

## Workstream 4 – Throughput improvements
- [x] Measure current enrichment time per POI
- [x] Split into stages with separate concurrency
- [x] Replace delayBetweenPois with scheduler
- [x] Add cancellation checks between stages
- [x] Show phase label in progress

## Workstream 5 – List/map interaction
- [x] Add selected-POI state at app level
- [x] Pass selection to PoiList and RouteMap
- [x] Click list -> center map marker
- [x] Click marker -> highlight list item
- [x] Scroll list to selected
- [x] Visual selection state
- [x] Clear selection on filter change

## Workstream 6 – Remove 200-item cap
- [x] Replace slice(0, 200) in PoiList
- [x] Choose strategy: pagination, virtual list, progressive
- [x] Add sort mode label
- [x] Controls for sorting

## Workstream 7 – Session persistence
- [x] Define what persists
- [x] Add serialization helper
- [x] Persist to localStorage
- [x] Restore on app load
- [x] Versioned format
- [x] Add resume/clear UI

## Workstream 8 – Trust metadata
- [x] Add traceability fields to EnrichedData
- [x] Compute confidence score
- [x] Surface n sources in UI
- [x] Add view sources disclosure
- [x] Include in exports

## Workstream 9 – Review aggregation semantics
- [x] Already completed in WS1

## Workstream 10 – Server test coverage
- [x] Add tests for /overpass, /search, /geocode
- [x] Test cache behavior
- [x] Test timeout handling
- [x] Test validation
- [x] Decide on cache persistence

## Decisions
- Highest leverage is better quality + usability, not more categories
- Skipping low-value is a feature if explained clearly
- This file was a transient planning list and no longer reflects pending work; it is kept as completed history.

## Blockers
- None
