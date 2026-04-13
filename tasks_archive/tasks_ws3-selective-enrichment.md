# Task: WS3 — Selective enrichment by category
Started: 2026-04-13
Status: done

## Steps
- [x] Add enrichability policy map to `poi-config.ts` (full/minimal/skip per category)
- [x] Add `skipReason` field to `EnrichedData` in `types/index.ts`
- [x] Update `enricher.ts` to skip/minimal based on category policy
- [x] Update `useEnrichment.ts` with enrichable count + "enrich all" mode
- [x] Update `EnrichmentPanel.tsx` to show enrichable vs total + toggle
- [x] Update `PoiList.tsx` to show skip reason for non-enriched POIs
- [x] Add tests for category-based skipping and progress counts
- [x] Run type check + tests (136 passing, 0 type errors)

## Decisions
- Categories with high enrichment value (restaurants, sleeping, food shops, gears): `full`
- Categories with moderate value (laundry, DIY, medical, pharmacy, bank, post, tourist info, wifi, charging, viewpoint): `minimal`
- Categories with low value (water, restroom, shelter, picnic): `skip`
- `minimal` = geocode only (locality), no web search, no LLM
- `skip` = no network calls at all, just Google Maps link
- User can toggle "Enrich everything" to override policy to `full` for all
- No delay between skip-policy POIs (they don't make network calls)

## Blockers
- None
