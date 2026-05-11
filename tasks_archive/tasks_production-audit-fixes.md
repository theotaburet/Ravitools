# Task: Production readiness audit — fix all issues
Started: 2026-04-17
Status: done

## Context
Deep audit of the codebase for production readiness found 18 issues across 4 severity levels.
All CRITICAL, HIGH, and MEDIUM issues fixed in a single pass.

## Steps
- [x] **C1** SSRF guard on `/fetch-page` — block private IPs via DNS lookup (`server/src/index.ts`)
- [x] **C2** XSS in KML export — escape all OSM tags with `escapeXml()` (`client/src/lib/export.ts`)
- [x] **C3** CORS default `*` → `http://localhost:5173` (`server/src/index.ts`)
- [x] **H1** Event listener leak — add `{ once: true }` to abort signal listeners (`search.ts:616,749`)
- [x] **H2** Unbounded Overpass cache — add FIFO eviction at 50 entries (`overpass.ts`)
- [x] **H3** Stale closure in `retryQuery` — use `stateRef` instead of `state` in deps (`useRavitools.ts`)
- [x] **H4** Tighten Google Maps URL regex — strict `www.google.<tld>` pattern (`server/src/index.ts`)
- [x] **M1** Type WebLLM engine — kept `any` with explicit eslint-disable + doc comment (`llm.ts`)
- [x] **M2** Replace console.error/warn with `dlog()` in LLM module (`llm.ts:96,363,410`)
- [x] **M3** Escape `formatHoursHtml` entries with `escapeXml()` (`export.ts:440`)
- [x] **M4** Admin key check on `DELETE /cache/search` (`server/src/index.ts`)
- [x] **M5** Add `resetLlmState()` for module-level state reset (`llm.ts`)
- [x] **M6** Add `updateEnrichments` to `startEnrichment` deps (`useEnrichment.ts:412`)
- [x] **L2** Graceful shutdown handler for Playwright browser (`server/src/index.ts`)
- [x] **L4** Remove redundant `clearTimeout` in catch (handled by `finally`) (`search.ts:708`)
- [x] **L5** Escape `googleMapsUrl` in href (`export.ts:617`)
- [x] Type check client: clean
- [x] Type check + build server: clean
- [x] Client tests: 473/473 pass
- [x] Server tests: 79/79 pass
- [x] Client production build: OK

## Not fixed (conscious decisions)
- **L1** O(n²) dedup — mitigated by category pre-filter, only matters at 2000+ POIs
- **L3** `as any` in test files — test-only, low risk

## Decisions
- CORS defaults to `http://localhost:5173` (dev). Production must set `CORS_ORIGIN`.
- SSRF guard uses Node `dns/promises` lookup to resolve hostname before fetch.
- Google Maps URL regex now requires `www.google.<2-3 letter TLD>[.<2 letter cc>]`.
- `DELETE /cache/search` requires `X-Admin-Key` header when `ADMIN_API_KEY` env is set.
- WebLLM engine stays `any` — dynamic import makes static typing impractical without large shims.
- Graceful shutdown via SIGTERM/SIGINT closes Playwright browser.

## Blockers
- None
