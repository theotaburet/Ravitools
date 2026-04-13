# Task: Multi-GPX file loading
Started: 2026-04-13
Status: done

## Goal
Support loading multiple GPX files simultaneously. Each file rendered as a distinct trace on the map with its name as label. Hover on label or trace highlights the associated trace.

## Steps
- [x] Update types: TraceData with id/color, AppState.traces as TraceData[]
- [x] Update GpxUpload: multi-file input + drag multi
- [x] Update gpx-parser: assign unique id per trace
- [x] Update useRavitools: processFiles for multiple GPX, merge simplified points
- [x] Update poi-processor: distanceToTrace min across all traces
- [x] Update RouteMap: multiple Polylines, colors, labels, hover highlight
- [x] Update App.tsx: wire multi-trace state
- [x] Update session.ts: persist traces array, bump schema version
- [x] Update export.ts: multiple <trk> in GPX, multiple placemarks in KML/KMZ
- [x] Update tests for multi-trace (gpx-parser, session, enrichment, export, poi-processor)
- [x] tsc clean, 169 tests pass, build passes
- [x] Commit: 92c5d76

## Decisions
- TraceData gets `id: string` and `color: string` fields
- AppState.trace → AppState.traces: TraceData[]
- Overpass queries use concatenated simplified points from all traces
- POI distance = min distance to any trace
- 10 distinct trace colors, cycling
- Session schema version bump to 2 (old sessions cleared on load)
- TraceLegend only shown when >1 trace loaded

## Blockers
- None
