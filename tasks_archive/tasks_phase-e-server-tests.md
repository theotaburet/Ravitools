# Task: Phase E — WS10 server-side test coverage
Started: 2026-04-13
Status: done

## Steps
- [x] Install supertest + @types/supertest as devDependencies
- [x] Guard app.listen() with NODE_ENV !== "test" to prevent server start during tests
- [x] Exclude src/__tests__ from tsconfig.json (top-level await not compatible with commonjs module)
- [x] Write /health test (status ok, cache_keys, uptime)
- [x] Write /cache/stats test (overpass, search, geocode stats shape)
- [x] Write /overpass tests: missing query, non-string, oversized, proxy success, cache hit, upstream error, timeout (504), network failure (502), form-encoded body
- [x] Write /search tests: missing query, non-string, oversized, proxy success, cache hit, language passthrough, upstream error, timeout, network failure
- [x] Write /geocode tests: missing lat/lon, partial, non-numeric, out-of-range lat, out-of-range lon, proxy success, cache hit (rounded coords), upstream error, timeout, network failure, User-Agent header, boundary coordinates
- [x] All 32 server tests pass
- [x] tsc --noEmit clean (server)
- [x] Client tests still pass (167/167)

## Decisions
- Used vi.stubGlobal("fetch", mockFetch) to mock upstream services without network calls
- Rate limiting disabled in tests via RATE_LIMIT_MAX=1000 env var
- Each test uses unique query/coords to avoid cache collisions between tests
- Test file excluded from tsc build (uses top-level await, which vitest supports but commonjs doesn't)

## Blockers
- None
