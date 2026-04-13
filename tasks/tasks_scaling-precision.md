# Task: Scaling & Precision — TraceIndex + CategoryFilter sticky/collapse
Started: 2026-04-13
Status: done

## Context
Session focused on improving POI distance filtering precision and UI usability for the CategoryFilter panel.

## Steps
- [x] Implement `TraceIndex` spatial grid index in `gpx-parser.ts` (0.02deg cells, 5x5 neighbourhood search)
- [x] Update `poi-processor.ts` to use `TraceIndex` for traces > 200 points (precise distance on original trace)
- [x] Update `useRavitools.ts` — pass `originalTraces` to `processElements` at all 3 call sites
- [x] Add 5 TraceIndex tests (correctness, on-trace, long trace, far point fallback, benchmark 12kx2k)
- [x] Refactor `CategoryFilter.tsx` — sticky header + collapsible body, collapse icon, active count badge
- [x] Add missing CSS styles for `.filter-panel`, `.filter-collapse-icon`, `.filter-collapsed-count`, `.filter-body`
- [x] TypeScript type check passes
- [x] All 176 client tests pass
- [x] Production build succeeds

## Decisions
- TraceIndex uses grid cell size of 0.02deg (~2.2km) — good tradeoff between memory and lookup speed
- Search radius = 2 cells (5x5 neighbourhood) covers up to ~5km perpendicular distance
- Only traces > 200 points use the index; shorter traces use brute-force (negligible cost)
- CategoryFilter sticky via CSS position sticky on .filter-panel, not JS IntersectionObserver
- Collapse state defaults to expanded (false) — users see categories on load

## Blockers
- None
