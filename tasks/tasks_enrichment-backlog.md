# Task: Long-term enrichment backlog
Started: 2026-04-14
Updated: 2026-04-15
Status: in-progress

## Context
All items from tasks_google-maps-graal.md are confirmed done (code verified).
This file tracks remaining quality/UX improvements.

## Steps
- [ ] Multilingual language detection renforcée (fr/en output validation) : `llm.ts`
- [ ] Extraction déterministe plus riche : horaires autres plateformes, signaux avis : `structured.ts`
- [ ] Santé engines persistée cross-sessions + exposition dans debug UI : `search.ts`, `EnrichmentSandbox.tsx`
- [ ] Pause/resume UX avec cooldown timer explicite et file de retry : `useEnrichment.ts`
- [ ] Provenance dans UI principale (PoiList, RouteMap), pas seulement sandbox : `PoiList.tsx`, `RouteMap.tsx`
- [ ] Source-quality scoring par snippet/domaine avant synthèse LLM : `search.ts`
- [ ] Structured-data officiel plus riche : menu, address, sameAs, cuisine : `structured.ts`
- [ ] Tests ciblés : repaired LLM outputs + gibberish rejection : `llm-parse.test.ts`
- [ ] ~~Provider optionnel : Google Places API~~ : abandonné, les règles Places imposent une carte Google pour afficher les résultats (carte Leaflet ici) et une carte bancaire
- [ ] Validation live sur 3 POI représentatifs (camping, restaurant, food shop) : `web/examples/`
- [ ] Schéma horaires multi-plages (coupure de midi) : `llm.ts`, `types/index.ts`, `export/hours.ts`
- [ ] Scraper Google Maps : lire le blob `APP_INITIALIZATION_STATE` de la page (approche gosom) plutôt que des sélecteurs CSS fragiles, et réduire les attentes networkidle (41 s par lieu aujourd'hui) : `scrapers/google-maps.ts`
- [ ] Patchright (drop-in Playwright, Node) uniquement si des CAPTCHA Google Maps réapparaissent : `browser.ts`
- [ ] Recherche de secours par API à clé (Tavily ou Exa, 1 000 appels/mois gratuits, pas de carte) derrière une variable d'env : `routes/search.ts`
- [ ] Modèle : Qwen2.5-7B en option pour GPU 6 Go, ou endpoint OpenAI-compatible côté serveur (Ollama) avec le même prompt et le même schéma : `llm.ts`
- [ ] Harnais `just llm-eval` : snippets réels capturés comme fixtures, mesure du taux d'acceptation et des hallucinations

## Decisions
- Keep direct Google Maps scraping as last resort; prefer stable official-site data and optional APIs.
- Treat deterministic fallback as a first-class path, not just an error case.
- Source-quality scoring should be transparent and inspectable (debug UI).

## Blockers
- None

## Hors enrichissement (ex docs/ROADMAP.md, post-v1)
- [ ] Enrichissement priorisé par isolement : déserts d'abord, zones denses en dernier
- [ ] Endpoint de recherche spatiale par rayon (index GIST déjà en place)
- [ ] Migration des dépendances majeures (React 19, Vite 7, Express 5)
- [ ] Durcissement multi-utilisateurs (CORS, rate limits) seulement si l'instance est partagée
