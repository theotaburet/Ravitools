# Task: Enrichment Resilience Fixes
Started: 2026-04-13
Status: done

## Steps
- [x] Add retry with exponential backoff in `searchPoi` for 429, 502, 503, 504 and network errors (max 3 retries, 2s/4s/8s)
- [x] Fix race condition in `emitResult` — increment `completedCount` BEFORE calling `onProgress`
- [x] Adapt `useEnrichment.ts` callback to receive already-incremented `completed` count
- [x] Track `errorCount` and `skippedCount` in `EnrichmentJobState` using atomic `setJob`
- [x] Add `isGenericPoiName()` filter — 30+ generic names (EN/FR/ES/Basque) → `SkipReason = "generic-name"`
- [x] Update `EnrichmentPanel` to display errors (red) and skipped (grey) during and after enrichment
- [x] Update `PoiList` skip reason labels with `"generic-name"`
- [x] Update 2 test assertions from `"unnamed"` to `"generic-name"`
- [x] Verify all tests pass (171 client + 32 server)
- [x] Verify prod build succeeds
- [x] Commit and push

## Decisions
- Retry only on transient errors (429, 502, 503, 504, network) — permanent errors (400, 404) are not retried
- Generic POI names list is broad (EN/FR/ES/Basque) to avoid wasting SearXNG+LLM credits on obvious generics like "Toilets", "Eau potable", "Ur edangarria"
- Progress bar turns orange when there are errors, stays green otherwise
- `setJob` instead of `updateJob` to avoid stale closures when tracking error/skipped counts concurrently

## Blockers
- SearXNG not running on VPS (infra issue, not code) — retry logic mitigates but doesn't solve
