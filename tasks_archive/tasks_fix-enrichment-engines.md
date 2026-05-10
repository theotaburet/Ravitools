# Task: Restore explicit SearXNG engines for enrichment
Started: 2026-04-14
Status: done

## Steps
- [x] Inspect enrichment client/server flow and compare against prior SearXNG engine work
- [x] Restore explicit engine selection in client search requests
- [x] Add/adjust test coverage for request payload
- [x] Run targeted verification (tests and/or type check)
- [x] Make transient `no-results` retryable after cooldown/IP change
- [x] Add search-engine circuit breaker, query fallback, and degraded-search warning
- [x] Enrich official website preview with structured data extraction
- [x] Tighten LLM output to short target-language sentences
- [x] Expose synthesis source/reason and reject unreadable LLM output
- [x] Surface provenance and retryable degraded state in the main POI UI
- [x] Harmonize provenance badges, reduce inline UI styles, and export provenance fields
- [x] Add Playwright Google Maps fallback for degraded search cases
- [x] Add slow queued retries and live-debugged Google Maps extraction improvements
- [x] Surface Google fallback queue status in UI and clean extracted phone/category fields
- [x] Implement async Google Maps preview jobs with polling and validate end-to-end on a real POI
- [x] Persist Google job state to disk, expose queue stats, and show multi-job queue details in UI

## Decisions
- Prioritize a minimal client-side fix first because server support for `engines` already exists and logs show requests falling back to `default`.
- Keep the engine list aligned with the previous SearXNG hardening work instead of changing server behavior again.
- Retry `skipped: no-results` only when search was degraded (`unresponsiveEngines.length > 0`) to avoid reprocessing legitimate empty-result POIs forever.
- Use JSON-LD from official websites as a stable source of hours/price/rating when available, instead of scraping dynamic third-party pages.
- Keep Google Maps as an indirect source via search snippets, not a direct scraper target.
- Expose diagnostic provenance (`llm`, `llm-repaired`, `deterministic`) so debugging quality regressions is easier.
- Keep main UI provenance compact: show short labels, reserve detailed diagnostics for sandbox/logs.
- Export provenance so offline consumers can tell whether text came from AI, repaired AI, or deterministic fallback.
- Direct Google Maps search URLs are not realistically scrapeable with a simple HTTP fetch; working approaches found in the wild rely on headless browser automation or undocumented internal endpoints, both with fragility/blocking risk.
- If Google Maps fallback is added, keep it as a last resort with cache and short timeout; never make it the default batch path.
- For the Google Maps fallback, support both `/maps/search/` and direct place-detail flows, and attempt to click through to the first result before extracting facts.
- Google Maps fallback now runs through a serialized queue with jitter/backoff and rotating desktop user agents/locales to better mimic slow human usage.
- Prefer dropping doubtful Google fields to `null` rather than keeping polluted values from nearby listings.
- Async Google Maps jobs now avoid blocking the main search loop; client polling surfaces queued/running progress while the slow fallback resolves in the background.
- Google Maps jobs are now persisted to disk and reloaded on server start; queue stats are exposed for richer UI feedback.

## Blockers
- None

## Verification
- `web/client`: `npm test -- --run src/__tests__/search-fetch.test.ts`
- `web/client`: `npx tsc --noEmit`
- `web/client`: `npm test -- --run src/__tests__/search-fetch.test.ts src/__tests__/enrichment.test.ts`
- `web/client`: `npm test -- --run src/__tests__/search-fetch.test.ts src/__tests__/enrichment.test.ts src/__tests__/llm-parse.test.ts`
- `web/server`: `npm test -- --run src/__tests__/server.test.ts`
- `web/client`: `npm test -- --run src/__tests__/enrichment.test.ts src/__tests__/llm-parse.test.ts`
- `web/server`: `npx tsc --noEmit`
- `web/client`: `npx tsc --noEmit`
- `web/client`: `npm test -- --run src/__tests__/enrichment.test.ts`
- `web/server`: `npx playwright install chromium`
- Live probe on `/google-maps-preview` against `Bixta Eder` resolved the correct place URL and extracted reliable `rating`, `reviewCount`, `address`, and `website`.
- Follow-up live probe improved `category` and `phone` cleanup on `Bixta Eder`; `reviewCount` now falls back to `null` when the nearby-list contamination cannot be avoided safely.
- End-to-end async job validation on `Bixta Eder` reached `status: done` and returned `rating: 4.1`, `reviewCount: 336`, `category: Camping 3 étoiles`, cleaned phone/address, and website.
- Queue stats endpoint validation returned `queued/running/done/error` counts and recent jobs as expected after live completion.
