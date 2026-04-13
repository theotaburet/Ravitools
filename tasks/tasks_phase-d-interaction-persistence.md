# Task: Phase D — WS5 list↔map interaction, WS6 remove ceiling, WS7 session persistence
Started: 2026-04-13
Status: in-progress

## Steps

### WS5: List↔map interaction
- [x] Add selectedPoiId state at app level (App.tsx)
- [x] Pass selection state and handlers to PoiList and RouteMap
- [x] Click POI in PoiList → center map + open popup on marker (flyTo + openPopup)
- [x] Click marker in RouteMap → highlight corresponding list item + scroll into view
- [x] Visual selected state on both list row (blue bg + left border) and map marker (larger, blue outline)
- [x] Clear selection when POI disappears from filtered set (useEffect)
- [x] Preserve selection when filters change if POI still visible
- [x] Keyboard accessibility (Enter/Space on list rows)

### WS6: Remove 200-item ceiling
- [ ] Replace hard slice(0, 200) in PoiList with virtualized list
- [ ] Choose strategy (virtualization preferred for dense urban traces)
- [ ] Add sort mode label to list header
- [ ] Verify performance on dense GPX

### WS7: Session persistence
- [ ] Define persistence schema (categories, trace metadata, POIs, enrichments, language)
- [ ] Serialization/deserialization helper in web/client/src/lib/
- [ ] Save to localStorage after pipeline completion
- [ ] Restore on app load
- [ ] Versioned format for schema evolution
- [ ] "Resume previous session" / "Clear session" UI
- [ ] Tests for serialization, restoration, version invalidation

## Decisions
- (none yet)

## Blockers
- None
