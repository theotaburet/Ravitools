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
│   │  • LLM synthesis ──── WebLLM (Qwen2.5-1.5B, WebGPU)  │  │
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
| Map rendering | `components/RouteMap.tsx` | Leaflet via react-leaflet |
| Export | `lib/export.ts` | GPX/KML/GeoJSON/OsmAnd/KMZ generated in-browser |
| Enrichment search | `lib/enrichment/search.ts` | Builds search queries, Google Maps URLs |
| LLM synthesis | `lib/enrichment/llm.ts` | WebLLM (Qwen2.5-1.5B via WebGPU) |
| Enrichment orchestration | `lib/enrichment/enricher.ts` | Batch: geocode → search → synthesize per POI |

### Server (VPS)

| Endpoint | Concern | How |
|---|---|---|
| `POST /overpass` | Overpass proxy | Cache 24h, rate limit 10/min, query guard 16KB |
| `POST /search` | SearXNG proxy | Cache 7 days, rate limit 60/min |
| `POST /geocode` | Nominatim proxy | Cache 30 days, rate limit 60/min |
| `GET /health` | Health check | Returns status |
| `GET /cache/stats` | Cache statistics | Hit/miss counts per cache |

## Key design decisions

1. **Corridor, not radius**: the trace is simplified then `around:` is used with Overpass. This queries a corridor along the route, not a naive bounding box.

2. **Chunked queries**: long traces are split into overlapping chunks of 25 points each (with 3 points overlap). Results are deduplicated by OSM element ID.

3. **Distance-to-trace filtering**: after Overpass returns raw elements, each POI's distance to the nearest segment of the trace is computed. POIs beyond 1500m are discarded.

4. **Client-side deduplication**: POIs of the same category within 50m of each other are merged, keeping the one with richer metadata.

5. **No GPX storage**: the GPX file is read in-browser and never sent to the server. Privacy by design.

6. **Config as code**: POI categories and tag matchers are defined in `lib/poi-config.ts`. Changes to categories are a code change, not a runtime config change.

7. **In-browser LLM**: enrichment synthesis runs via WebLLM (Qwen2.5-1.5B-Instruct q4f16, ~1.6 GB VRAM). No external LLM API needed. Requires WebGPU (Chrome/Edge/Safari). Firefox fallback: raw snippets without synthesis.

## Stack

- **Frontend**: React 18 + Vite 5 + TypeScript 5 + Tailwind v4
- **Map**: Leaflet 1.9 via react-leaflet 4
- **Server**: Express 4 + TypeScript
- **Enrichment**: @mlc-ai/web-llm (WebGPU), SearXNG, Nominatim
- **Design**: Neobrutalist (heavy borders, solid shadows, bold colors)

## File map

```
web/client/src/
├── types/index.ts        # Domain types (TracePoint, POI, AppState, EnrichedData...)
├── lib/
│   ├── gpx-parser.ts     # Parse GPX, haversine, simplify, distance-to-trace
│   ├── overpass.ts        # Query builder, chunking, API client
│   ├── poi-processor.ts   # Element→POI, dedup, distance filter
│   ├── poi-config.ts      # 18 category definitions + tag matchers + OsmAnd mappings
│   ├── export.ts          # GPX/KML/GeoJSON/OsmAnd/KMZ builders (with enriched data)
│   └── enrichment/
│       ├── search.ts      # SearXNG adapter, Google Maps URL builder, Nominatim
│       ├── llm.ts         # WebLLM integration (model loading, synthesis prompt)
│       ├── enricher.ts    # Batch orchestrator (geocode → search → synthesize)
│       └── index.ts       # Barrel export
├── hooks/
│   ├── useRavitools.ts    # Main pipeline orchestration hook
│   └── useEnrichment.ts   # Enrichment batch job state machine
├── components/
│   ├── GpxUpload.tsx      # Drag-and-drop upload zone
│   ├── RouteMap.tsx       # Leaflet map with trace + POI markers + enriched popups
│   ├── CategoryFilter.tsx # Checkbox filter panel
│   ├── ExportPanel.tsx    # Export buttons (5 formats)
│   ├── PoiList.tsx        # Scrollable POI list with enriched data
│   └── EnrichmentPanel.tsx # Model download progress, batch trigger, progress bar
├── App.tsx                # Root layout
├── main.tsx               # Entry point
└── index.css              # Tailwind + neobrutalist styles

web/server/src/
└── index.ts               # Express proxy (5 endpoints)
```
