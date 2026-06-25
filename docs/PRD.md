# Ravitools — Product Requirements Document

> Status: working draft · Last updated 2026-06-25
> Derived from the codebase + existing docs (README, web/README, AGENTS.md, _config/, web/docs/). Every requirement traces back to shipped code or stated intent. Companion document: [AUDIT.md](./AUDIT.md).

## 1. Overview

Ravitools is a privacy-first web app that turns a cycling/bikepacking **GPX route** into a curated set of **useful points-of-interest (POIs) along the actual trace** — water, food, sleeping, repair, etc. — optionally enriches the notable ones with practical context (hours, rating, price, summary) using an **in-browser LLM**, and exports the result for **offline use** on GPS units, phones, and web maps.

The differentiator is **relevance, not coverage**: POIs are filtered to a corridor along the route (not a noisy radius around a city) and deduplicated so the set stays usable both before departure and on-route.

**Core principle — privacy by design:** the GPX file never leaves the browser. Parsing, simplification, POI processing, LLM synthesis, and export all run client-side. Only OSM/search/geocode queries pass through a lightweight server proxy.

## 2. Target users

Bikepackers and long-distance cyclists who plan multi-day routes and need offline-ready, low-noise POI data — both for trip planning and for on-route decisions where connectivity is unreliable.

## 3. Goals & success metrics

**Goals**
- Surface genuinely useful, on-route POIs with low noise.
- Make the output usable offline on real cycling devices/apps.
- Keep user route data private (never uploaded).
- Add practical context to notable POIs at zero external-API cost (local LLM).

**Success metrics — ⚠️ NOT YET DEFINED (decision needed).** Candidates to ratify: POI relevance precision along route, % of routes that enrich without manual CAPTCHA, time-to-first-export, enrichment success rate per category, export-format adoption. See [AUDIT.md › PRD gaps](./AUDIT.md#prd-gaps).

## 4. Non-goals — ⚠️ proposed (not yet ratified)

To preserve the "relevance, not a generic map" positioning, Ravitools is **not**:
- a route planner or turn-by-turn navigation app;
- a live GPS tracking app;
- a generic full-coverage POI map;
- a hosted account/cloud-sync service (no user accounts; state is local).

## 5. Capabilities (current state)

| Capability | Status |
|---|---|
| GPX import, multi-file drag & drop | shipped |
| Client-side trace parse + ~500 m resampling | shipped |
| Corridor POI discovery via Overpass (`around:1000`, 25-pt chunks, 3-pt overlap, dedup by OSM id) | shipped |
| 18 POI categories (9 essential + 9 optional), config-as-code | shipped |
| Tag→category matching, perpendicular distance filter (≤1500 m default), 50 m same-category dedup, sort along trace | shipped |
| Category + max-distance filtering (UI checkboxes + slider) | shipped |
| Leaflet map with markers + enriched popups; virtualized POI list | shipped |
| Server proxy: rate-limit, cache (Overpass 24 h / Search 7 d / Geocode 30 d), 16 KB query guard, retry/backoff | shipped |
| Postgres+PostGIS enrichment cache, keyed by (osm_type, osm_id), 90-day query-time TTL; graceful proxy-only mode if DB absent | shipped |
| Client session cache + local session resume | shipped |
| Multi-format export: GPX, KML, GeoJSON, OsmAnd GPX, KMZ (all client-side) | shipped |
| **POI enrichment pipeline** (geocode → SearXNG search + official-site + Google/Yandex Maps fallback → in-browser WebLLM synthesis → structured/provenance/confidence) | **core (v1) — currently WIP** |
| In-browser LLM (Qwen2.5-3B-Instruct q4f16 via WebGPU/WebLLM, ~2.5 GB); deterministic fallback when no WebGPU | shipped |
| Search-engine health mgmt + CAPTCHA pause/manual-resolve | shipped |
| Enrichment output language fr/en | shipped |
| Spatial radius-search endpoint (GIST index exists) | planned |

## 6. Functional requirements

**Routing & POIs**
1. Import one or more `.gpx` files via drag & drop, parsed in-browser.
2. Parse to trace points (lat/lon/ele/time); compute total distance and elevation gain/loss; resample to ~500 m.
3. Build Overpass corridor queries (`around:1000`) on the simplified trace; chunk long traces (25 pts, 3-pt overlap); dedup by OSM element id. Route all OSM queries through the proxy.
4. Match OSM tags to the 18 categories; compute perpendicular distance-to-trace; filter beyond `maxDistanceM` (1500 m default, user-tunable); dedup same-category within 50 m keeping richer metadata; sort by along-trace distance.
5. Let the user toggle categories and adjust max distance; map + list reflect filters live.

**Enrichment** (experimental)
6. Per-category enrichability policy: `full` (geocode+search+LLM) / `minimal` (geocode + official site) / `skip` (link only). Skip unnamed/generic POIs with recorded `skipReason`.
7. For `full` POIs: reverse-geocode → multi-engine SearXNG search (+ optional official-site preview, + Google/Yandex Maps fallback when snippets < 2 or engines unresponsive) → rank/filter snippets → LLM synthesis.
8. LLM must return JSON only (rating, reviewCount, hours table, description, review, priceLevel), never invent data, use `null` when unknown, output in target language; validate (JSON/lang/length/readability) with up to 2 repair attempts, else deterministic extraction.
9. Every POI yields an `EnrichedData` record with status, confidence (0–1), provenance (engines, URLs, per-platform digests, Google-sourced fields), `synthesisSource` (AI / AI-repaired / deterministic), structured content (headline, operational summary, practicalities, cautions, unknowns, divergences, sourceConfirmation).
10. Detect divergences (conflicting hours, rating spread, closure signals); emit cautions on weak sources; penalize confidence accordingly.
11. Pause the batch with a manual CAPTCHA-resolve URL when all engines are suspended. Report per-POI status + phase + ETA.

**Persistence & export**
12. Export GPX, KML, GeoJSON, OsmAnd GPX, KMZ entirely client-side with enriched data embedded.
13. Resume a local session; reuse identical Overpass queries within a session.
14. Server caches enrichment in Postgres by (osm_type, osm_id) with single/batch/upsert and a query-time TTL (90 days default).

## 7. Non-functional requirements

- **Privacy:** GPX never sent to server; no user data persisted server-side (cache stores only public OSM POIs + enrichment, anonymous read/write). ⚠️ A privacy statement for *outbound* queries (POI names + coords sent to Overpass/Nominatim/SearXNG/Google/Yandex) is **missing** — see AUDIT.
- **Offline:** all 5 export formats generated client-side, usable offline. (Note: the *app itself* needs network for Overpass/enrichment; the offline boundary should be stated explicitly — gap.)
- **Cost/independence:** enrichment LLM runs fully in-browser (no paid LLM API); self-hosted SearXNG/Nominatim; Maps links built without an API key.
- **Performance:** model first load ~2.5 GB / 30 s–2 min (~2 s cached) for Qwen2.5-3B; LLM 512 tokens, temp 0.1; search timeout 15 s; geocode+search concurrency 3 with 500 ms stagger; serial LLM stage.
- **Resilience:** proxy retry/backoff; per-engine 30 min cooldown after 2 failures; DB degradation → strict proxy mode.
- **Hardware/browser:** Tier-1 for enrichment = Chrome/Edge/Safari desktop with WebGPU; Firefox & non-WebGPU = degraded (raw snippets, no synthesis). Since enrichment is v1-core, the WebGPU support matrix (~2.5 GB VRAM for Qwen2.5-3B) **and** the model-download UX (failure/interruption/quota handling) are committed requirements — see AUDIT §5.
- **i18n:** Officially **FR + EN** (UI + enrichment). Enrichment output already fr/en; **translating the UI chrome is required v1 work** (currently hardcoded English — AUDIT U2).
- **Accessibility:** target **WCAG 2.1 AA basics** (keyboard nav, accessible names on map markers/controls, `aria-live` progress, contrast) — see AUDIT U1.
- **Export-target constraints:** some devices restrict custom POIs (e.g. COROS DURA unsupported). Committed compatibility matrix is **missing**.

## 8. Primary user flow

Upload GPX → parse + simplify (in-browser) → corridor Overpass query via proxy → process POIs (match, distance filter, dedup, sort) → render on map + list → user tunes categories / max distance → optionally enrich notable POIs (model load → per-POI geocode/search/synthesize → CAPTCHA pause if blocked) → export in chosen format.

Pipeline stages: `idle → parsing → simplifying → querying → processing → done`.
Enrichment stages: `idle → loading-model → running → (paused-captcha) → done | error`.

## 9. Data model (key entities)

- **TracePoint** `{lat, lon, ele?, time?}`
- **TraceData** `{id, original[], simplified[], totalDistanceM, elevationGainM/LossM, name?, color}`
- **POI** `{id, lat, lon, category, name, icon, distanceToTrace, alongTraceDistance, tags, style, osmId?, osmType?}`
- **PoiCategoryConfig** `{category, style, tags[], defaultEnabled?}` (config-as-code in `lib/poi-config.ts`)
- **EnrichedData** — rating, reviewCount, hours/openingHours[], description, review, priceLevel, googleMapsUrl, sourceUrls[], rawSnippets[], confidence, sourceEngines[], structured, synthesisSource, googleMapsFields, status… (+ deprecated `summary`/`translatedSummary`/`specialty`/`essentials` pending cleanup)
- **EnrichmentStructuredContent** — headline, operationalSummary, practicalities[], sourceRollup[], cautions[], unknowns[], divergences[], sourceConfirmation
- **EnrichmentJobState** — stage, total/completed/errorCount/skippedCount, currentPoi, activePoiIds, modelLoadProgress, webGpuAvailable, searxngAvailable, targetLanguage, phase, etaSeconds, captchaUrl?
- **AppState** — stage, traces[], pois[], activeCategories, routeSettings.maxDistanceM, error, progress
- **poi_enrichment** (DB) — PK (osm_type, osm_id), category, location `GEOGRAPHY(POINT,4326)`, name, enrichment JSONB, enriched_at/updated_at; GIST + enriched_at + category indexes

## 10. Constraints & assumptions

- Fixed tuning: corridor `around:1000`, 25-pt/3-pt chunking, 1500 m distance cutoff, 50 m dedup, ~500 m resample, 16 KB Overpass query cap.
- Categories are code, not runtime config — adding one is a code change.
- Server in-memory caches are lost on restart; Postgres cache survives.
- PostGIS `ST_MakePoint(lon, lat)` ordering must be respected.
- Tailwind v4: no `@apply` on custom classes; Node has no `DOMParser` (GPX tests need jsdom).
- Prereqs: Node 18+, npm. Enrichment search needs a reachable SearXNG.

## 11. Product decisions

### Ratified 2026-06-25
- **Enrichment scope = CORE v1.** The LLM + scraping pipeline is a first-class feature, not optional. Consequences (now requirements, not "nice to have"): legal review of Google/Yandex scraping, server/scraper observability, WebGPU browser matrix, model-download UX (~2.5 GB for Qwen2.5-3B), and an enrichment-trust/disclaimer policy.
- **License = MIT** for the code (add a repo `LICENSE`). Exports/map carry **OpenStreetMap ODbL attribution**. **Personal use, no redistribution of scraped data** → the Google/Yandex enrichment fallback is *not* a data-licensing blocker; residual risk is operational only (IP ban / ToS friction), not legal.
- **Deployment posture = personal / single-user** (not a multi-tenant public service). De-prioritizes open-proxy abuse, multi-tenant scaling, and heavy observability — right-size infra for one user.
- **Languages = FR + EN** (UI chrome + enrichment output).
- **Export targets (committed matrix):** generic GPX viewers, **OsmAnd**, **Garmin**, **Wahoo/COROS** — note COROS DURA cannot ingest custom POIs (document the limitation; don't promise it).
- **Offline boundary (default):** generated exports and an already-loaded local session work offline; POI discovery (Overpass) and enrichment (search/scrape/geocode) require network. The app is online-to-build, offline-to-use.
- **Data retention (default, from code):** server caches Overpass 24 h / Search 7 d / Geocode 30 d (in-memory) and Postgres enrichment 90 d; **no user route data stored** server-side.

### Still open (need a call)
- **Success-metric targets** — candidates in §3; numbers not set.
- **Non-goals** — proposed in §4, awaiting ratification.
- **Accessibility** — AA-basics is the proposed target (§7); confirm scope/depth.
- **Cost/hosting model** — personal scale → concurrent load is a non-issue; only the personal VPS/Overpass budget remains (low priority).
- **Outbound-query privacy** — POI names + coords go to Overpass/Nominatim/SearXNG/Google/Yandex. Personal use → these are your own queries; downgrade to a doc note unless the app is later opened to others.
- **Enrichment accuracy expectations + LLM disclaimer** — how stale/wrong data is surfaced; disclaimer for trip-planning use.

## 12. Roadmap signals (from code/backlog)

- Promote enrichment from experimental → stable.
- Spatial radius-search endpoint (index already in place).
- Clean up deprecated `EnrichedData` fields.
- Keep maximizing client-side compute; VPS stays proxy/cache/fallback.
