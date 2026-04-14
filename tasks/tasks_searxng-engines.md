# Task: Fix SearXNG engine configuration — zero results workaround
Started: 2026-04-14
Status: done

## Problem
SearXNG returned **zero snippets** for valid POI queries (e.g. "Uxoa" bar in Hondarribia). Google Knowledge Panel shows rich data when browsing, but SearXNG gets nothing. Root cause: most default engines are blocked/CAPTCHA'd/rate-limited (Google, Startpage, DuckDuckGo, Brave, Qwant, Karmasearch).

## Diagnosis
Tested all 50 general-category engines. Results:

| Engine      | Status           | Quality for EU POIs |
|-------------|------------------|---------------------|
| presearch   | Working          | Excellent (RestaurantGuru, Cylex, Repsol) |
| yandex      | Intermittent     | Good (CafeteriaLucky, TodoBares, Yandex Maps) |
| mojeek      | Working          | Good (Hondarribia Turismo) |
| bing        | Working (noisy)  | Poor (LinkedIn spam, unrelated) |
| aol         | Working          | Good (Gipuzkoa listings) |
| seznam      | Working          | Fair (Czech bias) |
| yahoo       | Intermittent     | Fair |
| google      | Silent fail      | Blocked (0 results, no error) |
| startpage   | CAPTCHA'd        | Broken |
| duckduckgo  | CAPTCHA'd        | Broken |
| brave       | Rate-limited     | Broken |
| qwant       | Access denied    | Broken |
| karmasearch | Access denied    | Broken |

## Steps
- [x] Diagnose 0-result root cause (tested each engine individually)
- [x] Update `searxng/settings.yml`: disable broken engines, weight working ones
- [x] Add `engines` parameter to Express proxy `POST /search`
- [x] Add `SEARXNG_ENGINES` constant to client `search.ts` (presearch,yandex,mojeek,bing,aol)
- [x] Include engines in cache key to avoid stale empty results
- [x] Add `DELETE /cache/search` flush endpoint to server
- [x] Restart SearXNG container with new config
- [x] Verify: 26 results for Uxoa query (vs 0 before)
- [x] Verify: disabled engines (google, startpage, ddg, etc.) excluded
- [x] TypeScript type check clean (client + server)
- [x] All 452 client tests + 41 server tests pass
- [x] Production build succeeds

## Decisions
- **Explicit engine list in client**: `SEARXNG_ENGINES = "presearch,yandex,mojeek,bing,aol"`. Belt-and-suspenders with `settings.yml` to ensure control at both levels.
- **Cache key includes engines**: prevents old empty-result cache from being served after engine change.
- **Weight-based config in settings.yml**: presearch/yandex at 1.5, mojeek at 1.2, bing at 1.0, aol at 0.8, seznam/yahoo at 0.5.
- **No Bing spam filtering yet**: LinkedIn/unrelated results from Bing are harmless (waste a snippet slot but don't corrupt enrichment). Could add relevance filtering later.
- **Server-side flush endpoint**: `DELETE /cache/search` for admin use after config changes.

## Files modified
- `searxng/settings.yml` — full engine configuration (disable 7, enable+weight 7)
- `web/server/src/index.ts` — `engines` param in search, cache key, flush endpoint
- `web/client/src/lib/enrichment/search.ts` — `SEARXNG_ENGINES` constant, passed in fetch body

## To test in sandbox
1. Restart Express server: `cd web/server && npm run dev`
2. Open sandbox, pick "Uxoa" POI
3. Should now see 8+ snippets from presearch/yandex/mojeek
4. Structured output should populate (rating, hours, etc.)
