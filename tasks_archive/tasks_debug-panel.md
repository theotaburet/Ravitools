# Task: Debug panel + Overpass optimizations
Started: 2026-04-13
Status: done

## Goal
Add a client-side debug panel to diagnose pipeline performance, optimize Overpass query throughput for long traces (300-600km), and fix the bug where GPX traces disappear after an Overpass error.

## Steps
- [x] Analyze 42km test GPX: 1043 pts → 84 simplified → 4 chunks (sequential, ~12-60s)
- [x] Identify bottlenecks: sequential chunks, 10 req/min rate limit, 25pts/chunk
- [x] Create debug-log.ts: circular buffer, scoped loggers, timers, subscriber pattern
- [x] Create DebugPanel.tsx: collapsible dark-themed log viewer with auto-scroll
- [x] Instrument overpass.ts: timing, cache hits, retries, per-chunk element counts
- [x] Instrument useRavitools.ts: timing for parse, query, process stages
- [x] Optimize: chunks 25→50 pts, sequential→2-concurrent, rate limit 10→60/min, query 16→32KB
- [x] Fix bug: traces persist after Overpass error, retryQuery() for re-query without re-upload
- [x] Update App.tsx: DebugPanel, retry button, conditional upload visibility
- [x] Update server test: oversized query threshold 20000→40000 chars
- [x] All 203 tests pass, tsc clean, build succeeds
- [x] Commit: 90c352a

## Decisions
- Chunk size 50 pts chosen as balance: halves chunk count, keeps query under 32KB
- Concurrency 2 (not higher) to stay friendly with Overpass public API
- Rate limit 60/min: this is a personal tool, not a public service
- Debug panel always rendered but collapsed — no perf cost when closed
- Logging is opt-in (disabled by default), toggled via panel checkbox
- retryQuery() reads traces from state, doesn't need file re-upload

## Performance projections

| Trace    | Before (chunks) | After (chunks) | Speedup |
|----------|-----------------|----------------|---------|
| 42 km    | 4 sequential    | 2 (1 batch)    | ~2x     |
| 300 km   | 27 sequential   | 13 (7 batches) | ~4x     |
| 600 km   | 54 sequential   | 26 (13 batches)| ~4x     |

## Blockers
- None
