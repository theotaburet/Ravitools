# Task: Enrichment finish
# Started: 2026-04-13
# Status: done

## Steps
- [x] Identify remaining gaps after hardening
- [x] Keep sandbox out of main bundle path
- [x] Add tests for website fetch proxy and structured export fields
- [x] Tighten remaining rendering/safety details
- [x] Verify client and server end-to-end checks

## Decisions
- Hidden behind a query param was not sufficient; the sandbox should also avoid the normal bundle path as much as possible.
- Lazy-load the sandbox component so normal product usage does not pull it into the main interaction path.

## Blockers
- None
