# Task: Migration bun/jotai/just + no-warning + dé-god-filisation
Started: 2026-07-18
Status: done

## Steps
- [x] Phase 1: Bun workspaces + justfile + CI + Dockerfile bun
- [x] Phase 2: no-warning policy (tsconfig strict unused, biome, build)
- [x] Phase 3: split server index.ts en config/app/routes
- [x] Phase 4: split export.ts, enricher.ts, search.ts
- [x] Phase 5: migration jotai (state/, composants autonomes, App dégraissé)
- [x] Phase 6: refonte tests (fvm.test.ts 2556 l. → 4 fichiers + helpers)
- [x] Phase 7 (1ère passe): carnet de route, tokens, Archivo, a11y — branche ui/neobrutalism-refine
- [ ] Phase 7 (suite possible): PoiList/popups/EnrichmentPanel (bruit visuel des notices)

## Decisions
- Express conservé sous Bun, vitest conservé, workspaces Bun, jotai pour tout l'état app
  (choix validés par Théo, voir docs/superpowers/specs/2026-07-18-bun-jotai-just-design.md)
- structured.ts (707 l.) non splitté: domaine unique cohérent, sections internes claires
- llm.ts (539 l.) et scrapers/google-maps.ts (654 l.) conservés: modules cohérents
- enrichment.test.ts (1229 l.) = candidat de split futur (15 describes propres)
- Question de Théo (scraping avec credentials user): analysée, voir réponse de session

## Blockers
- (aucun)
