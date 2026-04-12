# Task: phase18-enrichment
Started: 2026-04-12
Status: done

## Goal
Enrich POIs found along cycling routes with external data (ratings, hours, reviews) via SearXNG web search + in-browser LLM synthesis (WebLLM). Add Google Maps links to every POI.

## Architecture
- SearXNG search proxied via server (`POST /api/search`)
- Nominatim reverse geocode proxied via server (`POST /api/geocode`)
- Google Maps link built client-side (no API key needed)
- WebLLM (Qwen2.5-1.5B q4f16) runs in-browser via WebGPU for snippet synthesis
- Batch async job: user triggers "Enrich all", progress bar, results appear incrementally
- Fallback: if no WebGPU, show raw snippets without LLM synthesis

## Steps
- [x] Add enrichment types to `types/index.ts` (EnrichedData, EnrichmentJobState, SearchSnippet)
- [x] Update `useRavitools.ts` initial state with enrichment fields
- [x] Create `lib/enrichment/search.ts` — SearXNG adapter + Google Maps link builder + Nominatim reverse geocode
- [x] Create `lib/enrichment/llm.ts` — WebLLM integration (model loading, synthesis prompt, structured output)
- [x] Create `lib/enrichment/enricher.ts` — orchestrator (search -> geocode -> LLM synthesis per POI)
- [x] Create `lib/enrichment/index.ts` — barrel export
- [x] Add server endpoint `POST /api/search` — SearXNG proxy with cache (7-day TTL, 5000 keys)
- [x] Add server endpoint `POST /api/geocode` — Nominatim proxy with cache (30-day TTL, 5000 keys)
- [x] Add separate rate limiter for enrichment endpoints (60 req/min)
- [x] Create `hooks/useEnrichment.ts` — batch job state machine
- [x] Create `components/EnrichmentPanel.tsx` — UI: model download progress, batch trigger, progress bar
- [x] Update `PoiList.tsx` — show enriched data (rating, hours, summary, specialty, price) + Google Maps link
- [x] Update `RouteMap.tsx` popup — show enriched data + Google Maps link
- [x] Update `export.ts` — include enriched data in GPX desc / KML description / GeoJSON properties / OsmAnd GPX / KMZ
- [x] Wire up `App.tsx` with `useEnrichment` hook + `EnrichmentPanel` + pass enrichments to all components
- [x] Tests for enrichment module (16 tests: Google Maps URLs, search query builder, WebGPU detection, export with enrichments)
- [x] `tsc --noEmit` passes (client + server)
- [x] `npm test` passes (121 tests, 6 files)
- [x] `npm run build` passes

## Decisions
- WebLLM over Transformers.js: higher perf for generative tasks in browser, OpenAI-compatible API
- Qwen2.5-1.5B: best multilingual quality at reasonable size (1.6 GB VRAM, ~30-50 tok/s)
- SearXNG over direct scraping: more robust, meta-search aggregates multiple engines, avoids per-site anti-bot
- No Google Places API: keeps the project zero-cost and privacy-first
- COROS DURA: impossible for custom POIs, smartphone is the target for POI consultation
- Separate caches per service: Overpass (24h), SearXNG (7d), Nominatim (30d) — different staleness profiles
- Geocode cache key rounded to 3 decimal places (~111m) for better hit rate
- Enrichment rate limiter: 60 req/min vs 10 req/min for Overpass — enrichment is many small requests
- WebLLM lazy-loaded via dynamic import to keep main bundle small (though Vite still bundles ~6MB WASM runtime)
- Google Maps links always shown on every POI (no enrichment required, just lat/lon/name)
- Export backward-compatible: enrichments parameter is optional in all export functions

## Blockers
- None
