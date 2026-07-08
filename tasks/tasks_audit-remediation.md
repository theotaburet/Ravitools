# Task: Audit remediation (2026-07 full audit)

Started: 2026-07-08
Status: not-started
Source: 4-dimension audit (over-engineering / bugs / security / UI-UX) + `docs/AUDIT.md`

## How to use this file

- Work **phase by phase, top to bottom**. Do not start a phase until the previous one is fully `[x]` and committed.
- Each task has a **Fix** (what to change) and a **Verify** (how to prove it's done). Tick `[x]` **only** after Verify passes and its output is visible.
- Bug-fix tasks (P0, P2): **write a failing regression test first**, then fix, then show red→green.
- Line numbers are indicative (from audit time) — grep the symbol if a line has drifted.
- Verify commands, per package:
  - client: `cd web/client && npm run typecheck && npm test && npx biome check ./src`
  - server: `cd web/server && npm run typecheck && npm test && npx biome check ./src`
- Commit each phase as its own commit: `fix(audit): <phase> — <summary>`.

Scope of the automated `/goal` run: **P0–P3**. P4 (UI/UX) needs visual verification and some design calls — do it in a supervised follow-up. P5 (major deps) is a separate migration project.

---

## P0 — Prod-breaking (do first, each with a regression test)

- [x] **R1** [HIGH] `cache.set` throws `ECACHEFULL` at maxKeys → successful fetches become 5xx / unhandled rejection crash.
  - Files: `web/server/src/index.ts:505`, `:612`, `:702`; `web/server/src/scrapers/endpoints.ts:117`; `web/server/src/scrapers/job-system.ts:334`.
  - Fix: wrap every `cache.set(...)` so a full cache never throws into the request path. Prefer configuring node-cache with `deleteOnExpire`/eviction, or a tiny `safeSet(cache,k,v)` helper that catches ECACHEFULL and evicts the oldest key (or just logs + skips caching). The `job-system.ts:334` one must not reject the background IIFE.
  - Verify: unit test that fills a cache to `maxKeys` then does one more `set` — expect no throw and the handler still returns 2xx. Server tests green.

- [x] **R2** [HIGH] SSRF: `/fetch-page` validates only the submitted hostname, then follows redirects anywhere (metadata endpoint reachable).
  - File: `web/server/src/index.ts:758` (and the `lookup()`→`fetch()` TOCTOU gap).
  - Fix: set `redirect: "manual"`; on a 3xx, re-run `assertPublicHostname()` on the `Location` before re-fetching, capped at N hops (e.g. 3). Reject private/link-local resolutions on every hop. Optionally pin the resolved public IP for the actual connection.
  - Verify: test that a URL 302-redirecting to `http://169.254.169.254/...` (or `127.0.0.1`) is rejected, not fetched. Server tests green.

- [x] **R3** [HIGH] Out-of-range rating (e.g. JSON-LD `ratingValue: 9.2`) → `"☆".repeat(5 - Math.round(rating))` throws `RangeError`, ErrorBoundary kills the app, poison persists to session + shared cache.
  - Files: ingest at `web/client/src/lib/enrichment/enricher.ts:75`; server passthrough `web/server/src/index.ts:197` (`firstNumber`).
  - Fix: clamp `rating` to `[1,5]` (round + `Math.max(1, Math.min(5, r))`) at the deterministic ingest path, dropping the value if it can't be normalized to that range. Belt-and-suspenders: guard the star renderers so `repeat()` can never get a negative count.
  - Verify: test that `rating: 9.2` yields a clamped or dropped rating and that PoiList/RouteMap/export render without throwing. Client tests green.

---

## P1 — Security hardening (no test needed unless noted)

- [x] **R4** [MED] Postgres published on `0.0.0.0:5432` with committed default password.
  - File: `docker-compose.yml:18-24`.
  - Fix: bind `127.0.0.1:5432:5432`; remove the `:-ravitools_dev` default so a missing `POSTGRES_PASSWORD` fails fast. Document the env var in README/`.env.example`.
  - Verify: `docker compose config` shows the localhost bind and no literal default password.

- [x] **R5** [MED] Server + Chromium run as root in the container.
  - File: `web/server/Dockerfile`.
  - Fix: add a non-root `USER node` (create/own the app + browser state dirs first). Keep `--no-sandbox` only under that user.
  - Verify: `docker build` succeeds; `docker run ... id -u` prints non-zero.

- [x] **R6** [MED] Scrape-job queue is floodable (20/min accumulates thousands; `persist()` rewrites whole file each update).
  - File: `web/server/src/scrapers/job-system.ts:129-151`, `:268-269`.
  - Fix: reject `POST /scrape/*/jobs` with 429 when pending+queued jobs for that source exceed a cap (e.g. 50). Optionally debounce/throttle `persist()`.
  - Verify: test that the (cap+1)-th queued job returns 429.

- [x] **R7** [LOW] `DELETE /cache/search` is unauthenticated when `ADMIN_API_KEY` is unset (`if (adminKey && !valid)` skips auth).
  - File: `web/server/src/index.ts:399-404`.
  - Fix: fail closed — when `ADMIN_API_KEY` is undefined, reject the admin route (503/501) instead of allowing it.
  - Verify: test that the delete route is rejected when the env key is absent.

- [x] **R8** [LOW] SearXNG ships committed `secret_key` + `limiter: false` while port 8888 is published on all interfaces.
  - Files: `searxng/settings.yml`, `docker-compose.yml:6`.
  - Fix: bind SearXNG to `127.0.0.1:8888`; enable the limiter (or document that 8888 must never be public).
  - Verify: `docker compose config` shows localhost bind.

- [x] **R9** [LOW] `PUT /poi/:type/:id` is unauthenticated → shared-cache content poisoning.
  - File: `web/server/src/index.ts:919`.
  - Fix (decision): either accept explicitly (add a `// ponytail:` note documenting the trust model) OR gate behind a write token / per-IP write accounting. Pick one; don't leave it undecided.
  - Verify: note the decision in the commit message; if gated, a test covers the reject path.

---

## P2 — Correctness bugs (regression test each)

- [x] **R10** [MED] Cancelled/deleted scrape jobs are resurrected by the still-running background runner (`get() ?? runningJob`, then unconditional `done`).
  - Files: `web/server/src/scrapers/job-system.ts:314`; `web/server/src/scrapers/endpoints.ts:152`.
  - Fix: before the runner writes a terminal status, re-read the job and bail if it's `cancelled`/absent. Track a cancelled set or check a tombstone.
  - Verify: test that DELETE during a run leaves the job cancelled after the runner resolves.

- [x] **R11** [MED] `lookupPoiBatch` sends all POIs in one request; server rejects >200 keys (400) → large routes never use the cache.
  - Files: `web/client/src/lib/poi-cache.ts:63`; server cap `web/server/src/index.ts:890` (`MAX_BATCH_KEYS`).
  - Fix: chunk the client batch into ≤200-key requests and merge results.
  - Verify: test that a 250-POI lookup issues 2 requests and returns merged hits.

- [x] **R12** [MED] Failed context creation is cached forever in `contextPromise` (never cleared on rejection); `browser` arg ignored on later calls.
  - File: `web/server/src/browser-context.ts:85`.
  - Fix: clear `contextPromise` on rejection (mirror the browser-slot fix S5); rebind context if the browser changed/crashed.
  - Verify: test that a first `newContext()` rejection doesn't poison the second call.

- [x] **R13** [MED] `searchPoi` returns on first variant with 0 kept snippets → fallback variant is dead code except on throw.
  - File: `web/client/src/lib/enrichment/search.ts:706`.
  - Fix: only short-circuit when snippets were actually kept; otherwise fall through to the next variant.
  - Verify: test that a first-variant-empty case triggers the second variant.

- [x] **R14** [MED] `/search` cache key omits `language` → wrong-locale results served for 7 days.
  - File: `web/server/src/index.ts:541`.
  - Fix: include `language` in the cache key.
  - Verify: test that fr/en of the same query produce distinct keys.

- [x] **R15** [MED] `formatOpeningHoursCompact` renders `close == null` as "closed" → "open daily" exported as "All closed".
  - File: `web/client/src/lib/export.ts:584`.
  - Fix: when `open` is a legacy free-text string (not a time) or `close` is null-but-open, render the raw open text, not "closed".
  - Verify: test the legacy-string hours case exports non-"closed" text.

- [x] **R16** [MED] Google-fallback 10s deadline is below the scraper's own 4–12s pre-page sleep + serial queue → fallback never contributes but burns quota.
  - Files: `web/client/src/lib/enrichment/enricher.ts:17`; server `google-maps.ts:535-536`, `job-system.ts` queue.
  - Fix (decision): raise the client poll deadline to match realistic job latency (e.g. 60–90s, matching the UI's own warning), OR gate the fallback behind an explicit opt-in so it isn't fired-and-abandoned. Pick one.
  - Verify: note the chosen deadline; test the poll loop respects it.

- [x] **R17** [LOW] Retry pass does `completed: prev.completed + 1` after completed already == total → "12/10", bar >100%.
  - File: `web/client/src/hooks/useEnrichment.ts:410`.
  - Fix: clamp `completed` to `total`, or track retry progress separately.
  - Verify: test that completed never exceeds total.

- [x] **R18** [LOW] No in-flight guard on `initEngine` → double-click "Re-enrich all" during load downloads the ~2.5GB model twice, leaks the first engine.
  - File: `web/client/src/lib/enrichment/llm.ts:91`.
  - Fix: memoize the in-flight `CreateMLCEngine` promise; second caller awaits the same one.
  - Verify: test that two concurrent `initEngine()` calls invoke the factory once.

- [x] **R19** [LOW] Slider `setMaxDistance` is a silent no-op after session restore (`rawElementsRef` empty).
  - File: `web/client/src/hooks/useRavitools.ts:103`.
  - Fix: persist/restore raw elements (or reprocess from stored POIs) so the slider reprocesses after resume; if truly unsupported, disable the slider with a tooltip.
  - Verify: test/manual that dragging after restore changes the POI set (or the control is disabled).

- [x] **R20** [LOW] `abort` listeners registered per fetch attempt, never removed → thousands retained on big batches.
  - File: `web/client/src/lib/enrichment/search.ts:616` (also `:357`, `:939`).
  - Fix: use `AbortSignal.timeout()` / `{ once: true }` / remove listeners in `finally`. (Folds into R25.)
  - Verify: covered by R25's refactor; no listener growth in a batch test.

- [x] **R21** [LOW] `alongTraceProjection` projects in raw lat/lon without `cos(lat)` scaling (unlike `distanceToSegment`, fixed in C1) → wrong POI travel-order at high latitude.
  - File: `web/client/src/lib/gpx-parser.ts:409`.
  - Fix: apply the same `cos(lat)` longitude scaling used by `distanceToSegment`.
  - Verify: test that projection order matches `distanceToSegment` near a high-latitude bend.

- [x] **R22** [LOW] `Number(null) === 0` passes coord validation → scrape at `0,0`.
  - File: `web/server/src/scrapers/endpoints.ts:66`.
  - Fix: reject null/undefined/NaN lat|lon with 400 (use `Number.isFinite` on already-typed numbers, not `Number(x)`).
  - Verify: test that null coords return 400.

- [x] **R23** [LOW] After MAX_REPAIR_ATTEMPTS a still-rejected LLM synthesis is returned and used anyway.
  - File: `web/client/src/lib/enrichment/llm.ts:356`.
  - Fix: on final rejection, return null and let the deterministic builder take over.
  - Verify: test that a persistently-bad output falls back to deterministic.

---

## P3 — Dead code / DRY / KISS (no behavior change; typecheck+tests must stay green)

- [ ] **R24** [BIG] Delete the Yandex Maps scraper — zero client callers (client hits only `/google-maps-preview*`).
  - Files: `web/server/src/scrapers/yandex-maps.ts` (+ its test, registry entry, `YandexMaps*` types in `types.ts`, `YANDEX_MAPS_PROXY_URL` env). ~576 src + ~355 test lines.
  - Fix: remove the plugin, its registration, its tests, its types, its env var and docs. Grep `yandex` (case-insensitive) after to confirm only incidental mentions remain.
  - Verify: both packages typecheck + test green; `grep -ri yandex web/ | grep -v node_modules` shows no live code.

- [ ] **R25** [DRY] Hand-rolled AbortController+setTimeout timeout plumbing ×9 → `AbortSignal.timeout(ms)` / `AbortSignal.any([signal, AbortSignal.timeout(ms)])`.
  - Files: `web/client/src/lib/enrichment/search.ts:353,612,744,935`; `web/client/src/lib/poi-cache.ts:68,110`; `web/server/src/index.ts:336,452,570,671,753`.
  - Fix: replace with the native helpers; drop manual listener add/remove. Also fixes R20.
  - Verify: typecheck + tests green; abort still works (existing tests cover timeouts).

- [ ] **R26** [DRY] `enrichPoi` copy-pastes `enrichBatch` stage-2 (~180 lines; only caller is the `?sandbox` dev panel).
  - File: `web/client/src/lib/enrichment/enricher.ts:214-397`.
  - Fix: `enrichPoi(poi, opts)` → `(await enrichBatch([poi], opts)).get(poi.id)`.
  - Verify: sandbox path still works; enrichment tests green.

- [ ] **R27** [DRY] RouteMap popup duplicates PoiList enrichment rendering (~130 lines ×2).
  - Files: `web/client/src/components/RouteMap.tsx:207-318`; `web/client/src/components/PoiList.tsx:190-343`.
  - Fix: extract one `<EnrichmentDetails poi=... />` used by both. (Note: RouteMap popup is a string sink — keep escaping; if extracting to React, render into the popup via a portal or `renderToStaticMarkup` with escaping preserved.)
  - Verify: popup + list still render identically; client tests green.

- [ ] **R28** [YAGNI] Dual-mounted endpoints: every plugin gets `/scrape/{name}` AND legacy alias routes; client uses only legacy.
  - File: `web/server/src/scrapers/registry.ts:56-69`.
  - Fix: mount one family (keep the one the client calls); delete the other.
  - Verify: server tests green; client still reaches its endpoints.

- [ ] **R29** [YAGNI] Scraper plugin registry/abstraction for a single remaining product (after R24). `listRegisteredScrapers` has zero callers.
  - File: `web/server/src/scrapers/registry.ts:30-78`.
  - Fix: inline google-maps into the job system; delete the registry/interface indirection and `listRegisteredScrapers`. Keep `job-system.ts`.
  - Verify: server tests green.

- [ ] **R30** [DELETE] Dead config + dead exports.
  - `ENRICHMENT_LENGTH_TARGETS` / `EnrichmentLengthTargets` / `ENRICHMENT_DISPLAY_ORDER` — `web/client/src/types/index.ts:222-264` (zero readers).
  - Exports alive only via tests of dead code: `fetchGoogleMapsPreview` (sync), `buildGoogleMapsDirectionsUrl`, `isOfficialDomainSnippet`, `formatHours`, `resetLlmState`, `countEnrichable`, `countFullEnrichable` — `search.ts`, `export.ts`, `llm.ts`, `poi-config.ts`.
  - `_testExports` block + its 16 helper imports — `web/server/src/index.ts:10-29,1009-1055` (import modules directly in tests instead).
  - Fix: delete each + the tests that only exercise dead code. Confirm no live importer with grep before each deletion.
  - Verify: typecheck + remaining tests green.

- [ ] **R31** [STDLIB] `await import("crypto")` inside handlers → top-level import / global `crypto.randomUUID()`.
  - Files: `web/server/src/index.ts:436,540`; `web/server/src/scrapers/job-system.ts:250`.
  - Verify: typecheck + tests green.

- [ ] **R32** [DRY] Small shrinks: `postJson<T>()` helper for the 5 fetch wrappers (`search.ts`); `proxyJson()` helper for the 3 proxy endpoints (`index.ts:525-717`); `runQuery(traces)` for `processFiles`/`retryQuery` dup (`useRavitools.ts:186-249,278-341`); single hours-flattener; `flattenJsonLd(record.mainEntity)` for the identical-branch ternary (`index.ts:157`); `isRetryableDegradedResult` via `isRetryableEnrichmentResult` (`provenance.ts:23`).
  - Fix: apply the shrinks that don't change behavior. Skip any that fight the code.
  - Verify: typecheck + tests green.

- [ ] **R33** [HYGIENE] Repo weight.
  - Delete the ~722 MB untracked Python venvs `.tools/mempalace-py312`, `.tools/mempalace-venv`; add them to `.gitignore`.
  - Remove obsolete `version: "3.9"` key from `docker-compose.yml`.
  - Consider dropping `tasks_archive/` from the tree (git history retains it) — decision, not mandatory.
  - Verify: `git status` clean of the venvs; `docker compose config` still valid.

- [ ] **R34** [CI] Make lint blocking.
  - Run `npx biome check --write ./src` in both packages, hand-fix the ~6 a11y findings (button `type`, interactive `div`s), then flip CI `Lint (advisory)` off `continue-on-error`.
  - Files: `.github/workflows/ci.yml`; a11y in `CategoryFilter.tsx:65`, `GpxUpload.tsx:45`, `ExportPanel.tsx` buttons.
  - Verify: `npx biome check ./src` clean in both packages; CI lint step no longer `continue-on-error`.

---

## P4 — UI/UX (supervised follow-up — visual verification, not `/goal`-automatable)

- [ ] **R35** [HIGH] Warn about the ~2.5GB model download (size, "first time only", data cost) before `initEngine`; surface web-llm `report.text`. `EnrichmentPanel.tsx:232`, `llm.ts:92`.
- [ ] **R36** [HIGH] Pass an AbortSignal into `initEngine`; Cancel must actually stop/unload the download. `llm.ts:78`, `useEnrichment.ts:207`.
- [ ] **R37** [HIGH] `useMemo` `filteredPois` (`useRavitools.ts:131`); `memo(RouteMap)` + cache divIcons by (category,size,selected,enriching) (`RouteMap.tsx:87,181`).
- [ ] **R38** [HIGH] Marker clustering / viewport culling above ~300 markers. `RouteMap.tsx:165`.
- [ ] **R39** [HIGH] Move a real language toggle to the header; rename the enrichment one to "summary language" only. `App.tsx:250`, `EnrichmentPanel.tsx:154`.
- [ ] **R40** [HIGH] Route pipeline status/warning strings + Leaflet popup strings through i18n. `useRavitools.ts:150+`, `RouteMap.tsx`.
- [ ] **R41** [HIGH] Inline error when a non-`.gpx` file is dropped (`GpxUpload.tsx:24`); confirm before `handleReset`/"Start fresh"/"Re-enrich all" (`App.tsx:288`, `EnrichmentPanel.tsx:396`).
- [ ] **R42** [MED] `enrichedCount` = only `status === "done"` (`App.tsx:254`, `ExportPanel.tsx:39`); distinguish "0 found" vs "0 after filter" empty state (`PoiList.tsx:73`); SearXNG health re-check / "Check again" button (`useEnrichment.ts:92`); debounce session save + surface quota failure (`App.tsx:95`, `session.ts:83`).
- [ ] **R43** [MED] a11y: filter header → `<button>` (`CategoryFilter.tsx:65`); `role="progressbar"`/`aria-live` on download+batch (`EnrichmentPanel.tsx:232`); marker hit-area ≥44px under `(pointer:coarse)` (`RouteMap.tsx:171`); trace highlight on tap/keyboard (`RouteMap.tsx:153`). Contrast: darken small links/primary button to ≥4.5:1 (`index.css:848`).
- [ ] **R44** [MED] Bundle Leaflet CSS (`import "leaflet/dist/leaflet.css"`) instead of unpkg CDN. `index.html:7`.
- [ ] **R45** [LOW] `<html lang>` follows UI language; gate DebugPanel behind `import.meta.env.DEV`; `aria-pressed` on toggles; single 0–100% progress scale. `App.tsx:307`, `index.html:2`.

## P5 — Major dependency migrations (separate project, do NOT bundle here)

- [ ] **R46** Safe patches first (same major): `helmet 8.2`, `pg 8.22`, `playwright 1.61`, `express 4.22.2` (security patch), `tsx`, `vitest`, `biome`, `tailwind`.
- [ ] **R47** Breaking majors, each its own PR + validation: React 18→19 (+ react-leaflet 4→5, `@types/react` 19, plugin-react 6), Vite 5→8, jsdom 25→29, TypeScript 5→6, express 4→5, pino 9→10.

## Decisions log
- R9, R16: explicit choice required — record it in the commit message.
- R33: `tasks_archive/` deletion is optional.

## Blockers
- None known.
