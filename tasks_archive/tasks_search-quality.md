# Task: Search quality — geographic filtering + query improvement
Started: 2026-04-14
Status: done

## Problem
Enrichment returns wrong POI data. Example: "Baztango nekazarien kooperatiba" (Food shop near Ustaritz, Pays Basque) gets enriched with data from "Deni's restaurant in Torrevieja" (Spain, 800km away). Two root causes:
1. Search query doesn't leverage geographic context effectively
2. No post-search geographic filtering — results from wrong city/country are kept

## Steps
- [x] Analyze current buildSearchQuery and search pipeline
- [x] Add GeoContext type (locality, county, state, country, countryCode) to types/index.ts
- [x] Update reverseGeocode to return GeoContext | null instead of string | null
- [x] Update buildSearchQuery to accept GeoContext and use geographic terms for disambiguation
- [x] Add isSnippetGeographicallyCoherent() for post-search geographic filtering
- [x] Update searchPoi to return { snippets, query } for debug visibility
- [x] Add geoContext and searchQuery fields to EnrichedData type
- [x] Update enrichPoi() to use new GeoContext flow
- [x] Update enrichBatch() — SearchStageResult + full pipeline with GeoContext/searchQuery
- [x] Remove site: dorks from query (SearXNG handles multi-engine discovery naturally)
- [x] Simplify CATEGORY_SEARCH_BIAS to lightweight context keywords per category
- [x] Show searchQuery + geoContext in EnrichmentSandbox UI
- [x] Fix search-fetch.test.ts for new { snippets, query } return type
- [x] Fix enrichment.test.ts mocks (reverseGeocode → GeoContext, searchPoi → { snippets, query })
- [x] Fix fvm.test.ts for new contextKeywords (no more OR chains, no site: dorks)
- [x] Type check passes (npx tsc --noEmit)
- [x] All 412 tests pass
- [x] Production build succeeds

## Decisions
- **No site: dorks**: SearXNG dispatches to multiple engines — Google Maps, Booking, Yelp etc. surface naturally when relevant. Adding site: to the query filters too aggressively.
- **Lightweight context keywords**: "avis restaurant horaires" instead of "avis OR review OR horaires OR menu OR google maps OR tripadvisor OR yelp". Shorter queries = better precision.
- **Geographic filtering is conservative**: only reject snippets where the title explicitly mentions a different city (e.g. "Deni's, Torrevieja" when we expect Ustaritz). Default: keep the snippet.
- **GeoContext carries county/state/country**: search query includes locality + county + state for geographic disambiguation. Also used by snippet filter.
- **searchQuery exposed for debugging**: visible in sandbox UI next to raw snippets.

## Files modified
- `web/client/src/types/index.ts` — GeoContext interface, EnrichedData fields
- `web/client/src/lib/enrichment/search.ts` — reverseGeocode, buildSearchQuery, searchPoi, isSnippetGeographicallyCoherent
- `web/client/src/lib/enrichment/enricher.ts` — enrichPoi, enrichBatch, SearchStageResult
- `web/client/src/components/EnrichmentSandbox.tsx` — searchQuery + geoContext display
- `web/client/src/__tests__/search-fetch.test.ts` — updated for { snippets, query } return
- `web/client/src/__tests__/enrichment.test.ts` — updated mocks for GeoContext + { snippets, query }
- `web/client/src/__tests__/fvm.test.ts` — updated assertions for new context keywords
