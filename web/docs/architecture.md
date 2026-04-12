# Architecture

## Overview

Ravitools uses a **hybrid client-heavy architecture**:

```
┌─────────────────────────────────────────────┐
│                  Browser                     │
│                                              │
│  GPX Upload → Parse → Simplify → Build Query │
│                                    │         │
│  ┌───────────────────────────┐     │         │
│  │ Map + Filters + Export    │     │         │
│  │ (Leaflet, React)          │     ▼         │
│  └───────────────────────────┘  /api/overpass│
│                                    │         │
└────────────────────────────────────│─────────┘
                                     │
                            ┌────────▼────────┐
                            │   VPS (Express)  │
                            │                  │
                            │  Rate Limiter    │
                            │  Query Guard     │
                            │  In-Memory Cache │
                            │       │          │
                            └───────│──────────┘
                                    │
                            ┌───────▼──────────┐
                            │  Overpass API     │
                            │  (public OSM)     │
                            └──────────────────┘
```

## What runs where

### Client (browser)

| Step | Module | Notes |
|---|---|---|
| GPX parsing | `lib/gpx-parser.ts` | DOMParser, no server needed |
| Trace simplification | `lib/gpx-parser.ts` | Resamples to ~500m spacing |
| Query building | `lib/overpass.ts` | Constructs Overpass QL, chunks long traces |
| POI matching | `lib/poi-processor.ts` | Tag matching, distance-to-trace, dedup |
| Map rendering | `components/RouteMap.tsx` | Leaflet via react-leaflet |
| Export | `lib/export.ts` | GPX/KML/GeoJSON generated in-browser |

### Server (VPS)

| Concern | How |
|---|---|
| Overpass proxy | Express POST /overpass |
| Cache | `node-cache` (in-memory, TTL 24h) |
| Rate limiting | `express-rate-limit` (10 req/min default) |
| Query guard | Rejects queries > 16KB |
| CORS | Configurable via env |

## Key design decisions

1. **Corridor, not radius**: the trace is simplified then `around:` is used with Overpass. This queries a corridor along the route, not a naive bounding box.

2. **Chunked queries**: long traces are split into overlapping chunks of ~80 points each. Results are deduplicated by OSM element ID.

3. **Distance-to-trace filtering**: after Overpass returns raw elements, each POI's distance to the nearest segment of the trace is computed. POIs beyond 1500m are discarded.

4. **Client-side deduplication**: POIs of the same category within 50m of each other are merged, keeping the one with richer metadata.

5. **No GPX storage**: the GPX file is read in-browser and never sent to the server. Privacy by design.

6. **Config as code**: POI categories and tag matchers are defined in `lib/poi-config.ts`, a direct TypeScript port of `config/config.yaml`. Changes to categories are a code change, not a runtime config change.

## Stack

- **Frontend**: React 18 + Vite 5 + TypeScript 5 + Tailwind v4
- **Map**: Leaflet 1.9 via react-leaflet 4
- **Server**: Express 4 + TypeScript
- **Design**: Neobrutalist (heavy borders, solid shadows, bold colors)

## File map

```
web/client/src/
├── types/index.ts        # Domain types (TracePoint, POI, AppState...)
├── lib/
│   ├── gpx-parser.ts     # Parse GPX, haversine, simplify, distance-to-trace
│   ├── overpass.ts        # Query builder, chunking, API client
│   ├── poi-processor.ts   # Element→POI, dedup, distance filter
│   ├── poi-config.ts      # Category definitions + tag matchers
│   └── export.ts          # GPX/KML/GeoJSON builders
├── hooks/
│   └── useRavitools.ts    # Pipeline orchestration hook
├── components/
│   ├── GpxUpload.tsx      # Drag-and-drop upload zone
│   ├── RouteMap.tsx       # Leaflet map with trace + POI markers
│   ├── CategoryFilter.tsx # Checkbox filter panel
│   ├── ExportPanel.tsx    # Export buttons
│   └── PoiList.tsx        # Scrollable POI list
├── App.tsx                # Root layout
├── main.tsx               # Entry point
└── index.css              # Tailwind + neobrutalist styles

web/server/src/
└── index.ts               # Express proxy (single file)
```
