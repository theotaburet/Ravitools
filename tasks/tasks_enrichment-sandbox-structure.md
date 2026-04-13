# Task: Enrichment sandbox structure
# Started: 2026-04-13
# Status: done

## Steps
- [x] Inspect current enrichment pipeline, types, and UI entry points
- [x] Inspect available GPX examples and select a real POI-backed scenario
- [x] Implement sandbox UI for real POI, fetched source content, and LLM formatting output
- [x] Tighten enrichment structure for essential POIs and commerce/hotel sources
- [x] Verify with type-check, tests, and build

## Decisions
- Start from the existing in-browser enrichment pipeline and expose an inspection sandbox rather than inventing a separate prototype stack.
- Keep existing enrichment fields for compatibility, and layer a stronger structured output (`essentials`, `sourceDigests`, `officialWebsite`) on top.
- Keep deterministic fallback structuring (`buildSourceDigests`, `buildEssentialsText`) so the output remains usable even when the LLM is unavailable or under-specified.

## Blockers
- None
