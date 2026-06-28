# Ravitools — Code & Product Audit

> Status: 2026-06-25 · Companion to [PRD.md](./PRD.md).
> Method: 5 read-only area sweeps (client logic, server/security, UI/UX, tests/E2E, repo hygiene) → **adversarial verification pass** that re-read the cited code and assigned each finding a verdict (`confirmed` / `partial` / `refuted`) with `file:line` evidence. Severities below are the *corrected* ones. Findings overturned during verification are listed in §6 for transparency.

## 1. TL;DR

The application code is **fundamentally sound and well-structured** — clear pipeline boundaries, deterministic fallbacks, real server integration tests, working E2E assertions. The mess is mostly **around** the code: no CI, no linter, repo clutter, doc duplication. The most valuable findings are not the line-level bugs but the **unexamined operational/legal risks** (§5): scraping ToS exposure, no React error boundary, no GPX size bound, silent localStorage data loss.

Nothing rated Critical survived verification. Two "Critical/High" claims from the first pass were **refuted** (see §6).

## 2. Severity summary

| Sev | Count | Items |
|-----|-------|-------|
| High | 3 | T1 (no CI), T2 (no lint), U1 (accessibility) |
| Medium | 9 | C1, C2, C5, S5, U2, U3, U4, T5, R5 |
| Low | 17 | C3, C4, C6, C8, C9, C+1, S1, S2, S3, S4, S6, S7, S8, S9, S+1, U5, U6, U+1, T3, T4, T6, T+1, R1–R4, R+1 |
| Refuted | 2 | C7, S10 |

(“Partial” = real but the original framing/severity was overstated; reflected in the corrected severity.)

## 3. Confirmed findings by area

### Client logic & correctness
- **C1 · Medium · confirmed** — `gpx-parser.ts:328-340` `distanceToSegment` projects in raw lat/lon as if Cartesian (no `cos(lat)`). Distance uses haversine to the projection (correct), but the *projection point* is distorted → wrong nearest-point/corridor filtering, worsening with latitude. *Fix:* scale `dx` by `cos(midLat)` before projecting, map back after.
- **C2 · Medium · confirmed** — `gpx-parser.ts:124` elevation stats `return {gain:0,loss:0}` on the **first** point missing `ele`, discarding the whole trace's gain/loss on a single GPS dropout. *Fix:* `continue` instead of `return`.
- **C5 · Medium · partial** — `poi-cache.ts:77-84` `lookupPoiBatch` returns an empty Map on any error (4xx/malformed/throw), indistinguishable from a true all-miss (`useEnrichment.ts:148-169` then enriches everything). Real, but impact is "redundant work + no telemetry," not data loss. *Fix:* return a discriminated `{status:'ok'|'unavailable', map}`.
- **C+1 · Low · confirmed** *(new)* — `overpass.ts:329` `totalDeduped: seenIds.size - allElements.length` is **always 0** (the two grow 1:1); the dedup log never reflects real dropped duplicates. *Fix:* accumulate `dedupedCount += result.elements.length - newCount`.
- **C3 · Low · partial** — `search.ts:38` `engineFailureState` is module-scope (persists between batches in the same tab). Overstated: in-memory only, doesn't survive reload or cross users, and `resetEngineFailureState` exists. Acceptable; optionally thread per-batch.
- **C4 · Low · confirmed** — `overpass.ts:16-27` client Overpass cache is FIFO (50 entries) with **no TTL** → stale OSM served for the page lifetime. *Fix:* store `insertedAt`, expire ~1 h.
- **C6 · Low · partial** — `session.ts:96-105` validates version + `Array.isArray`, but not element shape; "whole session lost on minor corruption" is by-design (`clearSession`+null). *Fix:* validate a few required fields per element.
- **C8 · Low · partial** — `poi-processor.ts:207-212` adaptive dedup radius uses undocumented magic thresholds (1200/700/300→120/80/60 m). Note: count is total post-filter, not per-category. *Fix:* comment the buckets or use a continuous function.
- **C9 · Low · partial** — `enricher.ts:954` `computeConfidence` sourceFactor caps at 0.40 and saturates at ~6 snippets — the dominant term; official-site bonus only 0.10. 6 mediocre snippets can outscore 2 authoritative ones. *Fix:* lower sourceFactor cap, raise official/diversity weight.

### Server & security
- **S5 · Medium · partial** — `index.ts:203-213` `getBrowser()` caches a **rejected** `chromium.launch()` promise and never resets it → scrapers stay permanently broken until restart. Real bug; "wait forever" is inaccurate (rejects fast). *Fix:* `.catch(e => { browserPromise = null; throw e })`.
- **S1 · Low · partial** — `assertPublicHostname` (`index.ts:62-68`) guards **only** `/fetch-page` (:696). Overpass/SearXNG/Nominatim upstreams come from env-overridable URLs with no SSRF check. Low because defaults are public and env is trusted. *Fix:* validate the three URLs once at startup.
- **S2 · Low · confirmed** — `index.ts:363` admin key compared with `!==` (non-constant-time). Protects only a non-destructive cache flush; key optional. *Fix:* `crypto.timingSafeEqual`.
- **S3 · Low · confirmed** — `google-maps.ts:263-266` follows the consent `continue` URL via `page.goto` without host allowlist (contained in headless context). *Fix:* assert `*.google.*` host.
- **S4 · Low · confirmed** — shutdown handler (`index.ts:935-951`) closes the browser but never calls `closeDb()` (exists at `db.ts:297`, marked test-only, never imported) → pg pool not drained on SIGTERM/SIGINT. *Fix:* `await closeDb()` in shutdown.
- **S6 · Low · confirmed** — `index.ts:121-134` `parseJsonLdBlocks` runs `matchAll` + `JSON.parse` on full external page HTML with **no size guard** (the 1 MB express.json limit doesn't apply to fetched HTML). *Fix:* slice HTML to ~1–2 MB first.
- **S7 · Low · confirmed** — `index.ts:452-460` caches the Overpass body and serves it as `application/json` without validating it parses as JSON (a 200 HTML error page would be cached+served mislabeled). *Fix:* validate JSON / check upstream Content-Type.
- **S8 · Low · partial** — two limiters exist (`limiter` 60/min on /overpass; `enrichLimiter` ~300/min on everything else incl. **all Playwright scraper endpoints**). The expensive scrapers share the cheap limiter. *Fix:* dedicated stricter limiter for scraper routes.
- **S9 · Low · partial** — `docker-compose.yml:22` hardcodes `POSTGRES_PASSWORD` (dev); `Dockerfile` has no `HEALTHCHECK` (the postgis service does). *Fix:* move secret to `.env`, add app `HEALTHCHECK`.
- **S+1 · Low · confirmed** *(new)* — `job-system.ts:271-281` the background IIFE does `jobCache.set`+`persist()` **before** the try block — a throw there would be an unhandled rejection (theoretical: `persist` swallows its own errors). *Fix:* move the initial set/persist inside the try.

### UI / UX / React
- **U1 · High · partial** — accessibility is thin but not zero: list rows *are* keyboard-operable (`PoiList.tsx:157-164`), `<main>` exists (`App.tsx:302`). Real gaps: map markers (`RouteMap.tsx:179-185` `L.divIcon`) have **no accessible name**; toggles lack `aria-expanded`; progress/status have no `aria-live`. *Fix:* add marker `aria-label`, `aria-expanded`+`role` on toggles, `aria-live=polite` on progress.
- **U+1 · Low · confirmed** *(new)* — `GpxUpload.tsx:73-80` hidden file input has no `id`/`aria-label`/`<label>`; drop zone (`:42-50`) is a bare `<div>` with no role. Unlabeled to assistive tech. *Fix:* label the input + role on the drop zone.
- **U2 · Medium · confirmed** — `lib/i18n.ts` only translates categories/POI names; **UI chrome is hardcoded English** (`App.tsx:141,166,169,214,229,281`, …). Non-English users see a mixed UI. *Fix:* string table keyed by `TargetLanguage`, route chrome through `t()`.
- **U3 · Medium · confirmed** — `EnrichmentPanel.tsx` is a 439-line god component: 7 `job.stage` branches + duplicated error/skipped count block (`:273-286` vs `:410+`). *Fix:* extract per-stage subcomponents + shared `<ErrorSkippedCounts>`.
- **U4 · Medium · confirmed** — **no `React.memo` anywhere**; `useRavitools.ts:98-128` `setMaxDistance` re-runs `processElements` on **every** slider `onChange` (no debounce), rebuilding all POIs and markers. *Fix:* debounce slider (commit on release/rAF), memoize RouteMap/PoiList/CategoryFilter.
- **U5 · Low · confirmed** — `PoiList.tsx:89` and `EnrichmentSandbox.tsx:48` `return null` on empty set, no message (PoiList is the user-facing one). *Fix:* render an empty-state message.
- **U6 · Low · confirmed** — `index.css` (1296 lines) has exactly **one** `@media` (768 px); no <480/640 px breakpoints, no touch-target sizing. *Fix:* add a ≤480 px query + `min-height:44px` on controls.

### Tests / E2E / CI
- **T1 · High · confirmed** — **no CI**: no `.github/`; tests only run as manual npm scripts. *Fix:* `ci.yml` running client+server `npm test` (and lint) on push/PR.
- **T2 · High · confirmed** — **no linter/formatter** (no eslint/prettier/biome/editorconfig, no lint script). *Fix:* add biome (or eslint+prettier) + scripts in both packages.
- **T5 · Medium · confirmed** — no coverage config or `test:coverage` script; server has no vitest config at all. *Fix:* add `test:coverage` + a coverage block.
- **T4 · Low · partial** — server integration IS well-tested (`server.test.ts`, 567 lines, supertest: /overpass /search /geocode /fetch-page /health /cache/stats, cache hit/miss, 429/502/504, 400/413/415; scrapers tested too). Real gap: **no React component/hook tests** (`useEnrichment`/`useRavitools`, components) and no `/fetch-page` SSRF-rejection case. *Fix:* add RTL hook/component tests + an SSRF test.
- **T3 · Low · partial** — *overstated.* `diagnostic.spec.ts:188` has a "passes regardless" comment **contradicted** by hard assertions right after (`:190 expect(poiCount).toBeGreaterThan(0)`, `:191 expect(exportOk).toBe(true)`). *Fix:* delete the misleading comment; in CI don't treat `paused-captcha` as a pass (`enrichment-diagnostic.spec.ts:219`).
- **T6 · Low · partial** — `fvm.test.ts` is 2336 lines but **not** shallow (403 `expect` vs 95 `toContain`). *Fix:* optional split by suite.
- **T+1 · Low · confirmed** *(new)* — `server.test.ts:154-168` test named "returns 504 on timeout" actually asserts **502** because `/overpass` swallows `AbortError` in the per-URL loop (inconsistent with /search & /geocode which return 504). *Fix:* surface AbortError as 504 in the /overpass handler, then correct the test.

### Repo hygiene & bloat
- **R5 · Medium · confirmed** — `web/server/package.json:18` ships **Playwright in `dependencies`** (bundles Chromium); used at runtime by the scrapers. Correct as a prod dep, but heavy. *Fix:* document the Chromium requirement; optionally lazy-import / gate the scraper if non-core.
- **R1 · Low · partial** — `tasks_archive/` = 41 files / 232 K tracked, not git-ignored. **But** AGENTS.md:44 / CONTRIBUT.md:129 explicitly mandate archiving — it's deliberate. *Decision needed:* keep (per process) or `git rm --cached` + ignore.
- **R2 · Low · partial** — real but partial doc duplication: README vs web/README Quick Start; AGENTS vs CONTRIBUT task-tracking block + source-file list. *Fix:* keep one canonical (AGENTS.md), link from CONTRIBUT.
- **R3 · Low · confirmed** — two skills dirs with different conventions: flat `skills/*.md` vs `.agents/skills/<name>/SKILL.md`. *Fix:* pick one or document the split.
- **R+1 · Low · confirmed** *(new)* — `skills-lock.json` tracks only the two `.agents/skills` entries; the three `skills/*.md` have no lock/provenance. *Fix:* add entries or document the exemption.
- **R4 · Low · partial** — MemPalace footprint is tiny (~1 KB tracked) and actively documented (AGENTS.md:84-94); not dead cruft. *Fix:* one-line note or drop if unused.

## 4. Prioritized action plan

**P0 — fast, safe, high ROI**
- T1 add CI · T2 add lint/format
- React **error boundary** in `main.tsx`/`App.tsx` (see §5) — prevents white-screen crashes
- C2 elevation `continue` (1 line) · C+1 dedup log arithmetic (trivial)
- S5 reset `browserPromise` on launch failure · S4 `closeDb()` on shutdown

**P1 — correctness, UX, coverage**
- C1 `cos(lat)` projection · C4 cache TTL · C5 discriminated cache result
- U4 debounce slider + `React.memo` · U1/U+1 a11y pass · U2 UI i18n · U5 empty states
- T5 coverage config · T4 hook/component tests + SSRF test · T+1 fix /overpass 504
- GPX size/point-count guard + localStorage-quota surfacing (see §5)

**P2 — structure & decisions**
- U3 split EnrichmentPanel · S1/S2/S6/S7/S8/S9 server hardening
- R1–R4/R+1 repo hygiene & doc consolidation
- Resolve §5 product/legal questions (scraping ToS, observability, LICENSE/attribution)

## 5. Unexamined risk areas (highest-value gaps)

These were **not** covered by the line-level findings and several matter more than any single bug. **Per the 2026-06-25 decisions ([PRD §11](./PRD.md#ratified-2026-06-25)): enrichment is v1-core → the WebLLM-download UX and enrichment-trust items are committed v1 requirements; and the tool is personal-use with no data redistribution → the scraping concern is operational (IP ban), not legal, and open-proxy / multi-tenant / heavy-observability items are de-prioritized.**

- **Scraping ban risk & fragility (operational, not legal)** — headless Playwright against `maps.google.com`/`yandex.com/maps` (`scrapers/*`). Personal use + no redistribution removes the data-licensing question; what remains is reliability: VPS-IP ban risk, CAPTCHA friction, and selector-breakage when Google/Yandex change their DOM. Treat as resilience work, not a blocker.
- **No React error boundary / crash isolation** — zero `ErrorBoundary` and no `window.onerror`/`unhandledrejection` in client. A throw in POI processing, map, or WebLLM white-screens the whole app with no recovery.
- **No GPX size/point-count bound** — `gpx-parser.ts` has no guard; a huge multi-track GPX can blow client memory and explode Overpass chunk count (self-DoS).
- **WebLLM model-download UX** — ~2.5 GB first load (Qwen2.5-3B); no examined handling of download failure, mid-download interruption, or storage/quota for cached weights.
- **localStorage quota silent data loss** — `session.ts:78-80` wraps `setItem` in try/catch and silently no-ops; large enriched sessions exceed ~5 MB and the "resume session" promise breaks silently.
- **Observability** *(lower bar — personal use)* — only pino-to-stdout. Basic logs are likely enough for one user; revisit if shared. Worth a tiny "scraper got banned/blocked" signal since enrichment is core.
- **Open-proxy abuse** *(de-prioritized — personal use)* — proxy exposes Overpass/SearXNG/Nominatim/scrapers. If the instance is ever exposed beyond personal use, tighten `CORS_ORIGIN` + rate limits. Not a single-user concern.
- **Supply chain** — no dependency-freshness/CVE story; running full Chromium on the VPS is a large attack surface (lower stakes for a personal box, still worth `npm audit` hygiene).
- **Cache restart cold-start** — in-memory caches lost on restart; cold Overpass load after each deploy not assessed.

<a id="prd-gaps"></a>
## 6. Refuted / corrected (transparency)

- **C7 · REFUTED** — claimed async race in `continueEnrichment` reading `enrichmentsRef` mid-flight. False: `enrichmentsRef.current` is set synchronously inside the `setEnrichments` updater (`useEnrichment.ts:75-84`); reads happen before `enrichBatch` or after it fully `await`s. Pattern is sound.
- **S10 · REFUTED** — claimed background jobs orphan forever with no error handler. False: `job-system.ts:271-344` wraps work in try/catch; the catch sets `status:"error"` + `appendFailure` + `persist`. (Only the pre-try set/persist is unguarded → minor S+1.)
- **T3 / T4** corrected from "non-asserting E2E" / "no server tests" — both wrong; see §3.

## 7. PRD-level gaps (product decisions)

Mirror of [PRD.md §11](./PRD.md#11-open-product-decisions-must-resolve-before-v1): success metrics, non-goals, browser/device support matrix, offline boundary, cost/hosting model, i18n scope, accessibility target, data-retention & outbound-query privacy, **licensing + OSM (ODbL) attribution** (no repo LICENSE exists), export-target compatibility matrix, and an enrichment accuracy/disclaimer policy for LLM-generated trip content.
