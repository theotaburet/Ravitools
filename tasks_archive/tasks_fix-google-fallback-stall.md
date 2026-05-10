# Task: Fix Google Maps fallback stalling enrichment pipeline
Started: 2026-04-17
Status: done

## Context
E2e diagnostic revealed that the enrichment batch stalls at ~63/236 POIs because
`resolveGoogleMapsFallbackSnippets` polls the server-side Playwright job every 3s
with no timeout. Rural POIs (Pays Basque) often trigger the fallback (< 2 SearXNG
snippets), and each Google Maps scrape takes 30-90s, blocking all 3 concurrent workers.

## Steps
- [x] Add `GOOGLE_FALLBACK_TIMEOUT_MS` (10s) to polling loop in `enricher.ts`
- [x] Type check passes (`tsc --noEmit`)
- [x] Enrichment unit tests pass (57/57)
- [x] Google Maps jobs server tests pass (38/38)
- [x] Re-run e2e enrichment diagnostic to confirm batch completes in reasonable time
- [x] Verify enrichment quality (how many POIs get useful content)

## Results
- E2e test passes in **2 minutes** (vs 12+ min stall before)
- Pipeline progressed 63→73/236 before SearXNG CAPTCHA'd (expected)
- `paused-captcha` is valid terminal state — pipeline no longer stalls on Google fallback
- 0 new console errors (only expected WebGPU warning in headless Chrome)

## Decisions
- 10s timeout chosen: allows ~3 poll cycles (3s each). If the Google Maps job is
  already running it may finish in time; if queued behind others, we don't wait.
- The server-side job keeps running — results are just not used for this POI's
  synthesis. A future "second pass" could pick up completed Google jobs.
- Both call sites (batch + single-POI) benefit since the timeout is in the shared function.

## Blockers
- None
