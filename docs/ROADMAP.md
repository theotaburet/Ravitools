# Ravitools — v1 Milestones

> Status: 2026-06-25 · Derived from [PRD.md](./PRD.md) + [AUDIT.md](./AUDIT.md). Item IDs (C#/S#/U#/T#/R#) trace back to AUDIT findings.

## v1 definition

A reliable, accessible, **FR/EN**, **personal-use** tool where:
- core POI-along-route discovery is solid and tested,
- **enrichment (incl. Google/Yandex fallback) is a first-class, trustworthy feature** (ratified v1-core),
- the project has CI/lint/tests and doesn't white-screen,
- exports work on the committed device matrix (generic GPX, OsmAnd, Garmin, Wahoo/COROS).

Personal-use posture means open-proxy/multi-tenant/heavy-observability work is **out of v1**.

## Sequencing at a glance

```
M0 Foundation ──▶ M1 Correctness & crash-safety ──▶ M2 Enrichment hardening (CORE)
                          │                                      │
                          └────────────▶ M3 UX / a11y / i18n ◀───┘
                                                 │
                                                 ▼
                                         M4 Export matrix & finish
```
M0 first (gates everything: CI catches regressions in all later work). M1 before M2/M3 (crash-safety + correct data underpin the enrichment and UX work). M2 and M3 can overlap once M1 lands. M4 last (commits the user-facing export promise + final polish).

---

## M0 — Foundation & guardrails  ·  size S  ·  ✅ DONE (branch `chore/m0-foundation`)

> Done: CI (typecheck+test gate, advisory lint), biome + scripts, LICENSE (MIT), .editorconfig.
> Deferred: T5 coverage (reporting only); repo hygiene R2 (doc dedup) / R3 (skills dirs); tasks_archive kept per AGENTS.md.

**Goal:** safety net + repo hygiene so every later change is checked, and the "en bordel" surface is cleaned.

**Scope**
- **T1** CI: `.github/workflows/ci.yml` running `tsc --noEmit` + `vitest run` (+ lint) on both `web/client` and `web/server`, on push/PR.
- **T2** Linter/formatter (biome recommended, one tool) + `lint`/`format` scripts in both packages.
- **T5** Coverage config + `test:coverage` script (no threshold gate yet — just visibility).
- **LICENSE** (MIT) at repo root.
- **Repo hygiene:** decide `tasks_archive/` (keep per AGENTS.md, or `git rm --cached` + ignore — **R1**); consolidate duplicated docs into AGENTS.md + link (**R2**); pick one skills convention (**R3/R+1**); one-line MemPalace note (**R4**).

**Exit:** green CI on a PR; `npm run lint` clean (or baseline-suppressed); LICENSE present; no duplicated task-tracking/source-file blocks across docs.

**Decision-gate:** none (all defaulted).

---

## M1 — Correctness & crash-safety  ·  size M  ·  ✅ DONE (branch `chore/m0-foundation`)

> Done: ErrorBoundary + global rejection handler; GPX size/point guards; localStorage-quota surfaced;
> C1 cos(lat) projection, C2 elevation, C4 cache TTL, C5 observable cache, C6 session validation, C+1 dedup log;
> S4 closeDb, S5 browserPromise reset, S+1, S6 HTML cap, S7 JSON validation, T+1 504. +5 regression tests; all green.

**Goal:** kill the silent data bugs and make the app fail gracefully instead of white-screening.

**Scope — crash-safety (from AUDIT §5)**
- React **ErrorBoundary** in `App.tsx` + `window.onerror`/`unhandledrejection` handler → recover instead of blank screen.
- **GPX size/point-count guard** in `gpx-parser.ts` (reject/warn on oversized files before they explode memory + Overpass chunk count).
- **localStorage quota**: surface the silent `setItem` failure (`session.ts:78`) to the user instead of a broken "resume".

**Scope — client logic bugs**
- **C1** `distanceToSegment` cos(lat) projection · **C2** elevation `continue` not `return` · **C+1** dedup-log arithmetic · **C4** client cache TTL · **C5** discriminated cache result · **C6** per-element session validation.

**Scope — server correctness/resilience**
- **S5** reset `browserPromise` on launch failure · **S4** `closeDb()` on shutdown · **S+1** move pre-try set/persist inside try · **S6** HTML size guard before JSON-LD parse · **S7** validate Overpass body is JSON before caching · **T+1** make `/overpass` surface AbortError as 504 + fix the misnamed test.

**Exit:** thrown error in processing/map/LLM shows a recovery UI, not blank; oversized GPX handled; quota failure visible; each fixed bug has a regression test; CI green.

**Decision-gate:** none.

---

## M2 — Enrichment hardening (CORE)  ·  size L  ·  depends on M1

**Goal:** bring enrichment from WIP to a dependable, trustworthy v1 feature — the headline of v1.

**Scope — reliability (operational ban risk, not legal)**
- Scraper robustness: per-scraper timeouts, retry/backoff sanity, graceful degradation when Google/Yandex block; **S8** dedicated stricter rate limiter for scraper endpoints.
- Lightweight "scraper blocked/banned" signal (log + a UI hint) — the one bit of observability worth it at personal scale.
- Selector-breakage resilience: fail soft (skip fallback, keep SearXNG path) rather than crash.

**Scope — model UX (AUDIT §5)**
- WebLLM ~2.5 GB download UX (Qwen2.5-3B): real progress, failure/interruption handling, cached-weights/quota awareness, clear "first load is big" messaging + WebGPU/browser-matrix gating.

**Scope — trust**
- Surface provenance/confidence already computed (sourceConfirmation, synthesisSource, divergences) in the UI; show stale/uncertain clearly; add an **LLM disclaimer** for trip-planning content.
- **C9** rebalance `computeConfidence` (lower raw-snippet weight, raise official/diversity).

**Scope — tests**
- **T4 (part)** hook tests for `useEnrichment`/`useRavitools` (model-load state machine, retry, CAPTCHA pause/resume, cache hit).

**Exit:** enrichment either completes or degrades **visibly**; model download is not a mystery; each result shows where its data came from + a disclaimer; hooks have state-transition tests; WebGPU support matrix documented.

**Decision-gates:** **enrichment accuracy/disclaimer policy** (PRD open) — how stale/wrong data is surfaced. **Success-metric** for "enrichment success rate" if you want it gated.

---

## M3 — UX, accessibility & i18n  ·  size M  ·  depends on M1 (overlaps M2)

**Goal:** pleasant, FR/EN, keyboard-usable, responsive.

**Scope**
- **U2** Translate UI chrome FR+EN (string table keyed by `TargetLanguage`, route chrome through `t()`).
- **U1 + U+1** Accessibility AA-basics: marker `aria-label`, `aria-expanded`+role on toggles, `aria-live` on progress/status, file-input label + drop-zone role.
- **U4** Perf: debounce the distance slider (commit on release/rAF) + `React.memo` on RouteMap/PoiList/CategoryFilter.
- **U5** Empty states (PoiList "no POIs match filters").
- **U6** Responsive: ≤480 px breakpoint + 44 px touch targets.
- **U3** Split the 439-line EnrichmentPanel into per-stage subcomponents + shared error/skipped block.
- **T4 (part)** key component tests (GpxUpload, EnrichmentPanel, CategoryFilter).

**Exit:** UI fully fr/en; keyboard + screen-reader can operate map/filters/enrichment; AA contrast; no re-render storm dragging the slider; usable ≤480 px.

**Decision-gates:** **accessibility depth** (AA-basics confirmed?); **non-goals ratification** (affects what UI we *don't* build).

---

## M4 — Export matrix & finish  ·  size S–M  ·  depends on M2, M3

**Goal:** make good on the export promise + final tidy before calling it v1.

**Scope**
- Verify/commit exports for **generic GPX viewers, OsmAnd, Garmin, Wahoo/COROS**; document the **COROS DURA custom-POI limitation** (don't promise it).
- **OSM ODbL attribution** on exports + map.
- Cleanup deprecated `EnrichedData` fields (summary/translatedSummary/specialty/essentials).
- Low-stakes server tidy: **S1** validate upstream URLs at startup · **S2** `timingSafeEqual` admin key · **S9** docker secret to `.env` + Dockerfile `HEALTHCHECK`.

**Exit:** each target device/app verified working or documented unsupported; attribution present; no dead deprecated fields; CI green.

**Decision-gate:** **success-metric targets** ratified (to declare v1 "done" against something).

---

## Out of v1 (post-v1 backlog)

- Spatial radius-search endpoint (GIST index already exists).
- Languages beyond FR/EN.
- Multi-tenant/public hardening (open-proxy, CORS tightening, stronger rate limits) — only if the instance is ever shared.
- Telemetry/Sentry-grade observability.
- `fvm.test.ts` split (**T6**) and other non-blocking refactors.

## Open decisions still needed (and which milestone they gate)

| Decision (PRD §11 "Still open") | Gates |
|---|---|
| Enrichment accuracy + LLM disclaimer policy | M2 |
| Success-metric targets | M2 (optional) / M4 (v1 "done") |
| Non-goals ratification | M3 |
| Accessibility depth (AA-basics?) | M3 |
| Cost/hosting budget (personal scale) | none — low priority |
| Outbound-query privacy note | none — doc note only (personal) |
