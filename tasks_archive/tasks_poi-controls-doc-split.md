# Task: POI controls and doc split
Started: 2026-04-13
Status: done

## Steps
- [x] Inspect current POI pipeline, docs, and task tracking files
- [x] Add user-facing route distance control and persist it in session
- [x] Make POI merging selective by category and more adaptive in dense areas
- [x] Add client-side query caching to reuse repeated Overpass requests across runs
- [x] Remove dead code / stale doc weight touched by this change
- [x] Split docs into README.md for users and CONTRIBUT.md for contributors
- [x] Clean stale task tracking files and mark this session done
- [x] Run typecheck, tests, and build relevant to the touched areas

## Decisions
- Keep destructive POI merging away from categories that benefit from later enrichment, especially restaurants, shops, and lodging.
- Use the same user control to drive the visible route corridor, while keeping Overpass radius at least 1000m so smaller settings do not increase query churn.
- Trimmed the top-level docs to reduce duplicated technical prose and stale analysis; deep detail now belongs in `CONTRIBUT.md` and `web/docs/`.

## Blockers
- None
