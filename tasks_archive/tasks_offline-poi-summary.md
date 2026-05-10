# Task: Offline POI summary in GPX <desc>
Started: 2026-05-10
Status: done

## Context
Current `formatPoiDescription()` in `web/client/src/lib/export.ts` exported a
verbose multi-line block including ~15 fields. On a Garmin/Wahoo/COROS GPS or
in OsmAnd, this is too long and noisy. Goal: produce a compact, prioritized
summary for `<desc>`, while keeping the verbose form in KML's `<description>`.

## Steps
- [x] Define `formatPoiDescriptionCompact(poi, enrichment)` in `export.ts`
- [x] Format `OpeningHoursEntry[]` to compact "Mo 12-14 · Tu 12-14 · …" line
- [x] Use compact helper in GPX `<desc>` (writeGpx + writeOsmAndGpx)
- [x] Keep verbose HTML helper for KML `<description>`
- [x] Update existing tests (5 broke, intentional)
- [x] Add 7 unit tests covering: enriched POI, OSM fallback, length cap,
      phone-vs-website priority, structured hours, single caution
- [x] Drop dead `formatPoiDescription()` (replaced by compact)
- [x] Visual smoke test on a realistic POI: 249 / 400 chars, 5 readable lines

## Sample output (verified)
```
Restaurant or Bar · ★4.3 (127) · $$ · km 12.3 — 85m
Excellent French bistro with cyclist-friendly terrace, fresh local produce.
Mo 12-14 · Tu 12-14 · We 12-14 · Th 12-14 · Fr 12-14 · Sa 19-22 · Su closed
☎ +33 5 59 12 34 56
⚠ Cash only on Saturdays.
```

## Decisions
- 400 chars hard cap (covers Garmin Edge, Wahoo Bolt, COROS Dura screens).
- Drop from compact: confidence %, synthesis source, sources count,
  googleMapsFields, divergences, source rollup, locality, review (still in KML).
- Phone wins over website on small screens (one-tap dial > URL).
- Show only first caution (most important; others would clutter screen).
- Use ★ / ☎ / ⚠ glyphs (rendered by all modern GPS units; safe Unicode).
- Strip leading "0" in times: "08:00" → "8" so "Mo 8-18" not "Mo 08-18".

## Verification
- Type check client: clean
- Tests: 480/480 pass (was 473/473 + 7 new)
- Production build: OK

## Blockers
- None

## Follow-ups (deferred)
- DB Postgres+PostGIS for shared cache across users
- Day-of-week awareness (highlight today's hours) — needs device TZ

