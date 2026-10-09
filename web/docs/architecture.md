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
│   │  • Chunking (25 pts/chunk, 3 pts overlap)             │  │
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
│   │  .GPX │ .KML │ .GeoJSON │ .GPX OsmAnd │ .KMZ       │    │
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
| Query building | `lib/overpass.ts` | Constructs Overpass QL, chunks long traces (25 pts/chunk) |
| POI matching | `lib/poi-processor.ts` | Tag matching, distance-to-trace, dedup |
| Map rendering | `components/RouteMap.tsx` | Leaflet via react-leaflet, screen-grid clustering (`lib/poi-cluster.ts`) |
| App state | `state/` | jotai atoms: route (traces, POIs, pipeline), enrichment, ui |
| Export | `lib/export/` | GPX/KML/GeoJSON/OsmAnd/KMZ generated in-browser |
| Enrichment search | `lib/enrichment/search.ts` | Builds search queries, Google Maps URLs |
| LLM synthesis | `lib/enrichment/llm.ts` | WebLLM (Qwen2.5-3B via WebGPU) |
| Enrichment orchestration | `lib/enrichment/enricher.ts` | Batch: geocode → search → synthesize per POI |

### Server (VPS)

| Endpoint | Concern | How |
|---|---|---|
| `POST /overpass` | Overpass proxy | Cache 24h, rate limit, query guard 16KB, mirror fallback, serialized upstream calls |
| `POST /search` | SearXNG proxy | Cache 7 days |
| `POST /geocode` | Nominatim proxy | Cache 30 days |
| `POST /fetch-page` | Official-website preview | SSRF guard, redirect re-validation, JSON-LD extraction, size cap |
| `GET/POST/PUT /poi/...` | Shared enrichment cache | PostGIS keyed by (osm_type, osm_id), 90-day TTL; disabled without `DATABASE_URL` |
| `POST /google-maps-preview`, `/google-maps-preview/jobs` | Google Maps fallback | Playwright job queue, stricter rate limit, persisted jobs |
| `GET /health`, `GET /cache/stats`, `DELETE /cache/search` | Ops | Admin key required for the flush |
| `GET /searxng-ui` | CAPTCHA resolution | Redirect to the local SearXNG UI |

## Key design decisions

1. **Corridor, not radius**: the trace is simplified then `around:` is used with Overpass. This queries a corridor along the route, not a naive bounding box.

2. **Chunked queries**: long traces are split into overlapping chunks of 25 points each (with 3 points overlap). Results are deduplicated by OSM element ID.

3. **Distance-to-trace filtering**: after Overpass returns raw elements, each POI's distance to the nearest segment of the trace is computed. POIs beyond 1500m are discarded.

4. **Client-side deduplication**: POIs of the same category within 50m of each other are merged, keeping the one with richer metadata.

5. **No GPX storage**: the GPX file is read in-browser and never sent to the server. Privacy by design.

6. **Config as code**: POI categories and tag matchers are defined in `lib/poi-config.ts`. Changes to categories are a code change, not a runtime config change.

7. **In-browser LLM**: enrichment synthesis runs via WebLLM (Qwen2.5-3B-Instruct q4f16, ~2.5 GB VRAM). No external LLM API needed. Requires WebGPU (Chrome/Edge/Safari). Firefox fallback: raw snippets without synthesis.

## Stack

- **Runtime / package manager**: Bun 1.x (workspaces `web/client`, `web/server`), `just` as task runner
- **Frontend**: React 18 + Vite 5 + TypeScript 5 + Tailwind v4, state in jotai atoms
- **Map**: Leaflet 1.9 via react-leaflet 4
- **Server**: Express 4 under Bun, Postgres + PostGIS (optional enrichment cache), Playwright (Google Maps scraper)
- **Enrichment**: @mlc-ai/web-llm (WebGPU), SearXNG, Nominatim
- **Quality**: biome (lint + format), vitest, Playwright e2e, GitHub Actions (typecheck, test, lint, Pages deploy)
- **Design**: neobrutalist "carnet de route" (heavy borders, solid shadows, lime accent, dark theme via CSS tokens)

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
│   ├── trace-attribution.ts  # Nearest-trace POI attribution (multi-GPX)
│   ├── session.ts            # localStorage session + .ravitools.json plan file
│   ├── poi-cache.ts          # Client side of the shared PostGIS enrichment cache
│   ├── i18n.ts               # fr/en strings and category labels
│   ├── export/               # One module per format (gpx, kml, kmz, geojson, osmand) + description, hours, zip
│   └── enrichment/           # enricher (batch pipeline), search (SearXNG), llm (WebLLM), geocode,
│                             # structured/deterministic fallbacks, confidence, provenance, google-fallback
├── components/
│   ├── GpxUpload.tsx         # Drag-and-drop upload, plan file import
│   ├── RouteMap.tsx          # Leaflet map: traces, clustered POI markers, popups
│   ├── ElevationProfile.tsx  # Profile strip under the map, gap alerts, hover sync
│   ├── CategoryFilter.tsx    # Category checkboxes + max distance slider
│   ├── PoiList.tsx           # Virtualized POI list
│   ├── EnrichmentPanel.tsx   # Model download, batch progress, CAPTCHA pause
│   ├── EnrichmentDetails.tsx # Shared rendering of an enriched POI
│   ├── ExportPanel.tsx       # Export buttons (5 formats + plan file)
│   ├── Roadbook.tsx          # Printable roadbook
│   ├── Step.tsx              # Numbered sidebar section
│   ├── ErrorBoundary.tsx
│   └── DebugPanel.tsx, EnrichmentSandbox.tsx   # Dev tooling
├── App.tsx                   # Layout + session lifecycle
├── main.tsx                  # Entry point
└── index.css                 # Tailwind + theme tokens + component styles

web/server/
├── migrations/001_init.sql   # PostGIS schema
└── src/
    ├── index.ts              # Bootstrap, graceful shutdown
    ├── app.ts                # Express app: middleware, /health, /cache/*, /searxng-ui, routers
    ├── config.ts             # Env vars parsed once
    ├── routes/               # overpass, search, geocode, fetch-page, poi (PostGIS cache)
    ├── scrapers/             # Playwright job system + Google Maps scraper endpoints
    ├── caches.ts, limiters.ts
    ├── db.ts                 # Postgres/PostGIS pool + migrations
    ├── browser.ts, browser-context.ts   # Shared Playwright browser
    └── ssrf.ts, structured-data.ts, safe-set.ts, http.ts, logger.ts
```
