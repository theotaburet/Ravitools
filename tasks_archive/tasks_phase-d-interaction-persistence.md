# Task: Phase D — WS5 list↔map interaction, WS6 remove ceiling, WS7 session persistence
Started: 2026-04-13
Status: done

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
- [x] Replace hard slice(0, 200) with @tanstack/react-virtual virtualized list
- [x] Variable-height rows with measureElement
- [x] Add sort mode button (distance / category / name) in list header
- [x] Scroll container with 500px max-height, overscan=10
- [x] Build passes, 157 tests pass

### WS7: Session persistence
- [x] Define persistence schema (categories, trace metadata, POIs, enrichments, language)
- [x] Serialization/deserialization helper in web/client/src/lib/session.ts
- [x] Save to localStorage after pipeline completion (App.tsx auto-save on stage=done)
- [x] Restore on app load (restoreState in useRavitools, restoreEnrichments in useEnrichment)
- [x] Versioned format for schema evolution (SCHEMA_VERSION = 1, version gate in loadSession)
- [x] "Resume previous session" / "Clear session" UI (session-prompt in App.tsx)
- [x] Reset clears both in-memory and persisted state
- [x] Tests for serialization, restoration, version invalidation (9 tests, all passing)
- [x] Fix Node v25 localStorage blocker (in-memory storage polyfill in test)

## Decisions
- Node v25.6.0 has a broken globalThis.localStorage (setItem is undefined). Tests use an in-memory Storage polyfill.
- Session is saved automatically when pipeline reaches stage=done. No manual save button needed.
- Schema version gate: if persisted version != SCHEMA_VERSION, data is cleared and user starts fresh.
- Set/Map serialization: Set→array, Map→[key,value][] for JSON compat; reconstructed on load.

## Blockers
- None
