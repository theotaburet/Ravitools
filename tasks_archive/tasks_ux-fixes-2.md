# Task: UX Fixes Round 2
Started: 2026-04-13
Status: done

## Context
Second round of UX fixes based on real-world testing with a 42km GPX where Overpass timeouts (504) are frequent.

## Steps
- [x] Fix 1: Auto-retry failed Overpass chunks (overpass.ts refactored with retry rounds + backoff)
- [x] Fix 2: Increase Overpass proxy timeout 120s → 180s (server/src/index.ts)
- [x] Fix 3: POI markers — transparent background, colored border (RouteMap.tsx, index.css)
- [x] Fix 4: Progress bar shows retry info (done with Fix 1)
- [x] Fix 5: Log enrichment results in debug panel (enricher.ts)
- [x] Type check + tests + build (171 client + 32 server, all pass)
- [x] Commit

## Decisions
- Auto-retry uses up to 3 rounds with 10s/20s/30s backoff between rounds
- Only failed chunks are retried, successful ones are kept
- queryOverpass individual retry backoff: 5s/10s/15s (unchanged)
- Concurrency: 2 parallel requests (unchanged)
- Server timeout: 180s (was 120s) to handle slow Overpass responses
- POI markers: transparent bg with semi-opaque white, colored border from category color
- Enrichment logging: dlog("enrichment") with per-POI info + batch summary

## Blockers
- None
