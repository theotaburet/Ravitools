# Architecture

## Overview

Ravitools uses a **hybrid client-heavy architecture**:

```
┌──────────────────────────────────────────────────────────────┐
│                        NAVIGATEUR                            │
│                                                              │
│   ┌──────────┐    ┌──────────┐    ┌───────────────────────┐  │
│   │  Upload   │───>│  Parse   │───>│  Simplification trace │  │
│   │  GPX      │    │  GPX     │    │  (resampling 500m)    │  │
│   │ (drag&drop)│   │(DOMParser)│   └───────────┬───────────┘  │
│   └──────────┘    └──────────┘                │              │
│                                               ▼              │
│   ┌───────────────────────────────────────────────────────┐  │
│   │  Construction requêtes Overpass                       │  │
│   │  • Chunking (50 pts/chunk, 3 pts overlap)             │  │
│   │  • around:1000 sur trace simplifiée                   │  │
│   │  • 18 catégories POI (9 essential + 9 optional)       │  │
│   └───────────────────────┬───────────────────────────────┘  │
│                           │                                  │
│   ┌───────────────────────┼───────────────────────────────┐  │
│   │  Traitement POI       │  POST /api/overpass            │  │
│   │  • Tag matching       │                               │  │
│   │  • Distance ⊥         ▼                               │  │
│   │  • Filtre < 1500m  ┌──────┐                           │  │
│   │  • Dédup 50m       │Server│                           │  │
│   │  • Tri distance    └──┬───┘                           │  │
│   └───────────────────────┼───────────────────────────────┘  │
│                           │                                  │
│   ┌───────────────────────┼───────────────────────────────┐  │
│   │  Enrichissement POI   │                               │  │
│   │  • Reverse geocode ───┤ POST /api/geocode             │  │
│   │  • Web search ────────┤ POST /api/search              │  │
│   │  • LLM synthesis ──── WebLLM (Qwen2.5-3B, WebGPU)  │  │
│   │  • Rating, hours, summary, Google Maps link           │  │
│   └───────────────────────────────────────────────────────┘  │
│                                                              │
│   ┌─────────────────────────────────────────────────────┐    │
│   │  Export offline (tout côté client)                   │    │
│   │  .FIT │ .GPX │ .KML │ .GeoJSON │ OsmAnd │ .KMZ      │    │
│   └─────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────┘
                            │
              POST /api/overpass, /search, /geocode
                            │
                 ┌──────────▼──────────┐
                 │  Serveur Express     │
                 │  (proxy léger)       │
                 │                      │
                 │  • Rate limit        │
                 │    - Overpass 10/min  │
                 │    - Enrichment 60/m │
                 │  • Garde taille 16KB │
                 │  • Cache mémoire     │
                 │    - Overpass 24h    │
                 │    - Search 7j       │
                 │    - Geocode 30j     │
                 │  • Retry + backoff   │
                 └──┬────┬────┬────────┘
                    │    │    │
        ┌───────────┘    │    └───────────┐
        ▼                ▼                ▼
  ┌───────────┐   ┌───────────┐   ┌────────────┐
  │ Overpass   │   │ SearXNG   │   │ Nominatim  │
  │ API (OSM)  │   │ (search)  │   │ (geocode)  │
  └───────────┘   └───────────┘   └────────────┘
```

## What runs where

### Client (browser)

| Step | Module | Notes |
|---|---|---|
| GPX parsing | `lib/gpx-parser.ts` | DOMParser, no server needed |
| Trace simplification | `lib/gpx-parser.ts` | Resamples to ~500m spacing |
| Query building | `lib/overpass.ts` | Constructs Overpass QL, chunks long traces (50 pts/chunk), retries failed chunks split in two |
| POI matching | `lib/poi-processor.ts` | Tag matching, distance-to-trace, dedup |
| Map rendering | `components/RouteMap.tsx` | Leaflet via react-leaflet, screen-grid clustering (`lib/poi-cluster.ts`) |
| App state | `state/` | jotai atoms: route (traces, POIs, pipeline), enrichment, session (save, resume, import, reset), ui |
| Export | `lib/export/` | FIT/GPX/KML/GeoJSON/OsmAnd/KMZ generated in-browser; FIT carries typed course points for Garmin Up Ahead, Wahoo and Karoo |
| Enrichment search | `lib/enrichment/search.ts` | SearXNG queries in the country's language (`vocabulary.ts`), Google Maps URLs |
| Official site | `lib/enrichment/websites.ts`, `evidence.ts` | Homepage plus up to two linked pages (prices, hours, booking, menu, contact); evidence windows around times, amounts, phones and date ranges become snippets |
| LLM synthesis | `lib/enrichment/llm.ts` | WebLLM (Qwen2.5-3B via WebGPU) |
| Machine check | `lib/enrichment/capability.ts` | WebGPU adapter limits, device memory, mobile: ready / limited / unsupported, gates AI synthesis |
| Enrichment orchestration | `lib/enrichment/enricher.ts` | Batch: geocode → official site → search → read the two best result pages → synthesize per POI |
| OSM facts | `lib/enrichment/osm-facts.ts` | Beds, booking, fee, operator, water... read from the tags, shown for every POI, fed to the LLM and the exports |
| Practical fields | `lib/enrichment/deterministic.ts`, `llm.ts` | Beyond weekly hours: `season` (date range), `priceNote` (amounts with units), `booking` (required / recommended / not needed); LLM first, regex fallback |

### Server (VPS)

| Endpoint | Concern | How |
|---|---|---|
| `POST /overpass` | Overpass proxy | Cache 24h, rate limit, query guard 16KB, mirror fallback, serialized upstream calls |
| `POST /search` | SearXNG proxy | Cache 7 days |
| `POST /geocode` | Nominatim proxy | Cache 30 days |
| `POST /fetch-page` | Official-website preview | SSRF guard, redirect re-validation, JSON-LD extraction, size cap |
| `POST /poi/search`, `PUT /poi/:type/:id` | Shared enrichment cache | PostGIS keyed by (osm_type, osm_id), 90-day TTL; disabled without `DATABASE_URL` |
| `POST/GET /google-maps-preview/jobs` | Google Maps fallback | Playwright job queue (page forced to English, week hours read from the day buttons), stricter rate limit, persisted jobs |
| `GET /health` | Ops | SearXNG reachability and Overpass cache size; restart to flush the in-memory caches |
| `GET /searxng-ui` | CAPTCHA resolution | Redirect to the local SearXNG UI |

## Key design decisions

1. **Corridor, not radius**: the trace is simplified then `around:` is used with Overpass. This queries a corridor along the route, not a naive bounding box.

2. **Chunked queries**: long traces are split into overlapping chunks of 50 points each (with 3 points overlap), queried one at a time. Each trace is chunked on its own: `around:` over several points is a polyline, so a chunk spanning two traces would scan the gap between them. A failed chunk is retried in up to 3 rounds (10, 20, 30 s backoff), split in two each time: a dense city corridor times Overpass out, a smaller one does not. This is the only client-side retry; the server tries the mirrors in turn. Results are deduplicated by OSM element ID.

3. **Distance-to-trace filtering**: after Overpass returns raw elements, each POI's distance to the nearest segment of the trace is computed. POIs beyond 1500m are discarded.

4. **Client-side deduplication**: POIs of the same category within 50m of each other are merged, keeping the one with richer metadata.

5. **No GPX storage**: the GPX file is read in-browser and never sent to the server. Privacy by design.

6. **Config as code**: POI categories and tag matchers are defined in `lib/poi-config.ts`. Changes to categories are a code change, not a runtime config change.

7. **In-browser LLM**: enrichment synthesis runs via WebLLM (Qwen2.5-3B-Instruct q4f16, ~2.5 GB VRAM). No external LLM API needed. Requires WebGPU (Chrome/Edge/Safari). A machine check (`lib/enrichment/capability.ts`) runs before the model loads: a limited machine (under 8 GB, small GPU buffers, phone) keeps AI synthesis off unless the user opts in; Firefox and other no-WebGPU browsers get raw snippets without synthesis.

## Stack

- **Runtime / package manager**: Bun 1.x (workspaces `web/client`, `web/server`), `just` as task runner
- **Frontend**: React 19 + Vite 8 + TypeScript 7 + Tailwind v4, state in jotai atoms
- **Map**: Leaflet 1.9 via react-leaflet 5
- **Server**: Express 5 under Bun, Postgres + PostGIS (optional enrichment cache), Playwright (Google Maps scraper)
- **Enrichment**: @mlc-ai/web-llm (WebGPU), SearXNG, Nominatim
- **Quality**: biome (lint + format), vitest, Playwright e2e, GitHub Actions (typecheck, test, lint, Pages deploy)
- **Design**: "carnet de route" (paper and ink, 2 px frames, square corners, lime as the only action color, hard shadow only on the active step and primary actions, sentence case, dark theme via CSS tokens only). On small screens the sidebar is a bottom sheet over the map: a tap on the handle switches between peek and raised, the map never resizes

## File map

```
web/client/src/
├── types/index.ts            # Domain types (TracePoint, POI, EnrichedData, ...)
├── state/                    # jotai atoms: route.ts (traces, POIs, pipeline), enrichment.ts, ui.ts
├── lib/
│   ├── gpx-parser.ts         # Parse GPX, haversine, simplify, distance-to-trace
│   ├── overpass.ts           # Query builder, chunking, API client
│   ├── poi-processor.ts      # Element to POI, dedup, distance filter
│   ├── poi-config.ts         # Categories, tag matchers, OsmAnd mappings, enrichment contracts
│   ├── poi-cluster.ts        # Screen-grid clustering for the map
│   ├── elevation.ts          # Elevation profile helpers
│   ├── gaps.ts               # Segments without water/food along a trace
│   ├── format.ts             # Price tier and km formats shared by the UI and the exports
│   ├── session.ts            # localStorage session + .ravitools.json plan file
│   ├── poi-cache.ts          # Client side of the shared PostGIS enrichment cache
│   ├── i18n.ts               # fr/en strings and category labels
│   ├── export/               # One module per format (fit, gpx, kml, kmz, geojson, osmand) + description, hours, zip
│   └── enrichment/           # enricher (batch pipeline), search (SearXNG), vocabulary (country language), websites + evidence (official site, one hop, result pages), osm-facts (tags as facts), llm (WebLLM), geocode,
│                             # structured/deterministic fallbacks, confidence, provenance, google-fallback
├── components/
│   ├── GpxUpload.tsx         # Drag-and-drop upload, plan file import, example route
│   ├── RouteMap.tsx          # Leaflet map: traces, clustered POI markers, popups
│   ├── ElevationProfile.tsx  # Profile strip under the map, gap alerts, hover sync
│   ├── CategoryFilter.tsx    # Category chip grid + max distance slider
│   ├── PoiList.tsx           # Virtualized POI list
│   ├── EnrichmentPanel.tsx   # Machine check, model download, batch progress, CAPTCHA pause
│   ├── EnrichmentDetails.tsx # Shared rendering of an enriched POI
│   ├── ExportPanel.tsx       # Export cards (6 formats, plan file, roadbook)
│   ├── Roadbook.tsx          # Printable roadbook
│   ├── Step.tsx              # Numbered sidebar section
│   ├── TraceSummary.tsx      # Step 01 result card: per trace name, km, D+, POI count
│   ├── ErrorBoundary.tsx
│   └── DebugPanel.tsx, EnrichmentSandbox.tsx   # Dev tooling
├── App.tsx                   # Layout + session lifecycle
├── main.tsx                  # Entry point
└── index.css                 # Tailwind + theme tokens + component styles

web/server/
├── migrations/001_init.sql   # PostGIS schema
└── src/
    ├── index.ts              # Bootstrap, graceful shutdown
    ├── app.ts                # Express app: middleware, /health, /searxng-ui, routers
    ├── config.ts             # Env vars parsed once
    ├── routes/               # overpass, search, geocode, fetch-page, poi (PostGIS cache)
    ├── scrapers/             # Playwright job system + Google Maps scraper endpoints
    ├── caches.ts             # In-memory TTL caches (Overpass, search, geocode, scraper jobs)
    ├── limiters.ts           # Per-IP rate limits
    ├── db.ts                 # Postgres/PostGIS pool + migrations
    ├── browser.ts, browser-context.ts   # Shared Playwright browser
    └── ssrf.ts, structured-data.ts, http.ts (cached proxy), logger.ts
```
