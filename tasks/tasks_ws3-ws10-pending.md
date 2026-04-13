# Task: WS3-WS10 – Pending workstreams (transient)
Started: 2026-04-13
Status: in-progress

## Workstream 3 – Selective enrichment
- [ ] Define enrichment priority rules by category in poi-config.ts
- [ ] Introduce enrichability policy: full, minimal, skip
- [ ] Mark high-priority categories: Restaurant, Food shop, Sleeping place, Gears
- [ ] Mark low-value categories: water, shelter, picnic, toilets
- [ ] Add skip reasons to types
- [ ] Update enricher to skip low-value categories
- [ ] Add UI for enrichable vs total count
- [ ] Add user override for "enrich everything"

## Workstream 4 – Throughput improvements
- [ ] Measure current enrichment time per POI
- [ ] Split into stages with separate concurrency
- [ ] Replace delayBetweenPois with scheduler
- [ ] Add cancellation checks between stages
- [ ] Show phase label in progress

## Workstream 5 – List/map interaction
- [ ] Add selected-POI state at app level
- [ ] Pass selection to PoiList and RouteMap
- [ ] Click list -> center map marker
- [ ] Click marker -> highlight list item
- [ ] Scroll list to selected
- [ ] Visual selection state
- [ ] Clear selection on filter change

## Workstream 6 – Remove 200-item cap
- [ ] Replace slice(0, 200) in PoiList
- [ ] Choose strategy: pagination, virtual list, progressive
- [ ] Add sort mode label
- [ ] Controls for sorting

## Workstream 7 – Session persistence
- [ ] Define what persists
- [ ] Add serialization helper
- [ ] Persist to localStorage
- [ ] Restore on app load
- [ ] Versioned format
- [ ] Add resume/clear UI

## Workstream 8 – Trust metadata
- [ ] Add traceability fields to EnrichedData
- [ ] Compute confidence score
- [ ] Surface n sources in UI
- [ ] Add view sources disclosure
- [ ] Include in exports

## Workstream 9 – Review aggregation semantics
- [x] Already completed in WS1

## Workstream 10 – Server test coverage
- [ ] Add tests for /overpass, /search, /geocode
- [ ] Test cache behavior
- [ ] Test timeout handling
- [ ] Test validation
- [ ] Decide on cache persistence

## Decisions
- Highest leverage is better quality + usability, not more categories
- Skipping low-value is a feature if explained clearly

## Blockers
- None