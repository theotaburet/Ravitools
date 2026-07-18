# Task: Migration bun/jotai/just + no-warning + dé-god-filisation
Started: 2026-07-18
Status: in-progress

## Steps
- [ ] Phase 1: Bun workspaces + justfile + CI + Dockerfile bun
- [ ] Phase 2: no-warning policy (tsconfig strict unused, biome, build)
- [ ] Phase 3: split server index.ts en config/app/routes
- [ ] Phase 4: split export.ts, enricher.ts, search.ts
- [ ] Phase 5: migration jotai (state/, hooks minces, App dégraissé)
- [ ] Phase 6: refonte tests (split fvm.test.ts, helpers communs)

## Decisions
- Express conservé sous Bun, vitest conservé, workspaces Bun, jotai pour tout l'état app
  (choix validés par Théo, voir docs/superpowers/specs/2026-07-18-bun-jotai-just-design.md)

## Blockers
- (aucun)
