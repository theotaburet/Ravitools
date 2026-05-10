# Task: Long-term enrichment backlog
Started: 2026-04-14
Updated: 2026-04-15
Status: in-progress

## Context
All items from tasks_google-maps-graal.md are confirmed done (code verified).
This file tracks remaining quality/UX improvements.

## Steps
- [ ] Multilingual language detection renforcée (fr/en output validation) — `llm.ts`
- [ ] Extraction déterministe plus riche : horaires autres plateformes, signaux avis — `structured.ts`
- [ ] Santé engines persistée cross-sessions + exposition dans debug UI — `search.ts`, `EnrichmentSandbox.tsx`
- [ ] Pause/resume UX avec cooldown timer explicite et file de retry — `useEnrichment.ts`
- [ ] Provenance dans UI principale (PoiList, RouteMap), pas seulement sandbox — `PoiList.tsx`, `RouteMap.tsx`
- [ ] Source-quality scoring par snippet/domaine avant synthèse LLM — `search.ts`
- [ ] Structured-data officiel plus riche : menu, address, sameAs, cuisine — `structured.ts`
- [ ] Tests ciblés : repaired LLM outputs + gibberish rejection — `llm-parse.test.ts`
- [ ] Provider optionnel : Google Places API derrière config utilisateur
- [ ] Validation live sur 3 POI représentatifs (camping, restaurant, food shop) — `web/examples/`

## Decisions
- Keep direct Google Maps scraping as last resort; prefer stable official-site data and optional APIs.
- Treat deterministic fallback as a first-class path, not just an error case.
- Source-quality scoring should be transparent and inspectable (debug UI).

## Blockers
- None
