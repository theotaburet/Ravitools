# Task: Google Maps enrichment graal
Started: 2026-04-14
Status: done

## Goal
Reach a production-grade Google Maps fallback for POI enrichment that remains useful when SearXNG is degraded, with strong observability, durable background processing, and conservative data quality rules.

## Current State
- [x] Playwright Chromium installed on `web/server`
- [x] Slow Google Maps fallback with queue, jitter, retries, consent handling, and rotating user agents/locales
- [x] Async job API with polling
- [x] Queue stats endpoint
- [x] Basic job persistence to disk
- [x] Main UI shows Google fallback phase and queue status
- [x] Live validation succeeded on `Bixta Eder` with reliable rating/category/address/phone/website extraction

## Remaining Steps
- [x] Improve Google Maps opening-hours extraction from expanded hours panel, not just collapsed summary text
- [x] Add multi-day structured hours parsing from Google Maps into the existing `openingHours` model
- [x] Persist queue state more safely (atomic writes, pruning policy, corruption recovery) — T2a/T2c
- [x] Recover unfinished jobs after server restart and optionally resume them automatically — T2b
- [x] Add per-job progress metadata (`attempt`, `nextRetryAt`, `lastError`, `startedAt`) — T2d
- [x] Add server endpoint for cancelling queued Google jobs — T3
- [x] Add client-side display of multiple active Google jobs with clearer POI names rather than truncated URLs — T4a
- [x] Add a dedicated Google fallback stage in progress accounting instead of folding it into generic completion heuristics — T4b (lenteur note)
- [x] Add targeted tests for async Google job lifecycle (`queued -> running -> done/error`) — T5a (38 tests)
- [x] Add targeted tests for disk persistence/reload of Google jobs — T5b
- [x] Add targeted tests for extraction heuristics on captured real-world HTML/text fixtures — T5c
- [x] Add stronger anti-pollution rules to avoid nearby-business contamination in rating/review/hours parsing — T6a
- [x] Add source provenance markers so Google-derived fields can be distinguished from website/SearXNG-derived fields at field level — T6b (`googleMapsFields` in `EnrichedData`, populated in all enricher paths)
- [x] Add rate controls configurable by env vars (`min delay`, `max delay`, `retries`, queue concurrency) — T7
- [x] Evaluate optional proxy / IP rotation hooks without hardcoding vendor assumptions — `GOOGLE_MAPS_PROXY_URL` env var passed to Playwright `chromium.launch({ proxy: { server } })` — no vendor SDK
- [x] Add structured logs / debug export for failed Google extraction attempts — `appendGoogleMapsFailure` appends JSONL records to `.cache/google-maps-failures.jsonl`; called on both null-preview and throw paths in `queueGoogleMapsPreviewJob`
- [x] Add stale job pruning and cache pruning strategy for `.cache/google-maps-jobs.json` — T8
- [x] Add user-facing note when Google fallback is expected to take a long time but is still making progress — T4b
- [x] Consider promoting Google fallback results into export provenance in a more explicit way (field-level or source-level) — T9 (`enrichment_googleMapsFields` in GeoJSON; `Google Maps fields:` line in GPX/KML descriptions)

## Decisions
- Keep Google Maps fallback as a last resort, not the primary enrichment path.
- Prefer `null` over doubtful extracted values.
- Accept slower, serialized processing if it improves success rate and reduces bot-detection risk.
- Keep the implementation conservative and inspectable rather than over-optimizing early.
- Proxy hook is opt-in via `GOOGLE_MAPS_PROXY_URL` — no vendor SDK, no rotation logic hardcoded. Rotation can be added externally (HAProxy, Squid, commercial proxy with rotation) without touching this code.
- Failure log is append-only JSONL; no rotation/TTL on failures file by design (dev artefact, rarely grows large).

## Blockers
- Google Maps DOM/UX changes can break selectors without warning.
- Opening hours remain the weakest field because Google often hides them behind extra interaction states.
- IP reputation / consent / CAPTCHA pressure can still degrade extraction despite slower pacing.

## Verification Targets
- [x] `web/server`: `npm run build` — clean
- [x] `web/client`: `npx tsc --noEmit` — clean
- [x] `web/client`: `npm test -- --run src/__tests__/enrichment.test.ts` — 57 passed
- [x] `web/server`: `npx vitest run src/__tests__/google-maps-jobs.test.ts` — 38 passed
- [ ] Live async queue probe on at least 2-3 representative POIs:
  - camping / sleeping place
  - restaurant/bar
  - food shop
