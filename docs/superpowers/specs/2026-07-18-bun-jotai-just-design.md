# Design: migration bun/jotai/just, no-warning policy, dé-god-filisation

Date: 2026-07-18
Statut: approuvé (choix validés par Théo: Express sous Bun, vitest conservé, Bun workspaces, jotai pour tout l'état app)

## Objectif

Amener Ravitools à un état "perfection outillage": runtime/PM Bun, état client jotai,
task runner just, zéro warning toléré, tests refondus, code DRY/KISS sans god file.
Aucun changement de comportement produit.

## Décisions

| Sujet | Décision |
|---|---|
| Serveur | Express conservé, exécuté sous Bun (pas de Hono, pas de réécriture) |
| Tests | vitest conservé (dépendance à `@vitest-environment jsdom` par fichier) |
| Structure | Monorepo Bun workspaces (`web/client`, `web/server`), lockfile unique racine |
| État client | jotai pour tout l'état app (route, POI, filtres, session, enrichissement) |
| Task runner | `justfile` remplace le Makefile |

## Phases

### Phase 1 — Bun workspaces + just + CI
- `package.json` racine avec `workspaces: ["web/client", "web/server"]`.
- `bun install` racine, suppression des `package-lock.json`, `bun.lock` unique.
- `justfile` remplaçant le Makefile (install, dev, build, test, lint, typecheck, check, searxng, stop).
- Serveur: `tsx` supprimé (Bun exécute le TS directement), scripts `dev`/`start` via `bun`.
- CI: `oven-sh/setup-bun`, `bun install` racine, typecheck/test/lint par workspace.
- Dockerfile serveur sur image `oven/bun`.

### Phase 2 — No-warning policy
- Client tsconfig: `noUnusedLocals` et `noUnusedParameters` réactivés, fallout corrigé.
- Biome: règles `off` retirées si le code peut être corrigé; sinon justification en commentaire.
- Build prod sans warning (chunk WebLLM ~6MB: warning limite de taille silencé explicitement
  via `chunkSizeWarningLimit`, c'est un runtime WASM connu et code-splitté).
- CI déjà bloquante sur lint — elle le reste.

### Phase 3 — Serveur: split du god file
- `src/index.ts` (1023 l.) → `config.ts`, `app.ts` (middlewares + montage routes),
  `routes/overpass.ts`, `routes/search.ts`, `routes/geocode.ts`, `routes/scrape.ts`.
- `index.ts` = bootstrap (listen) uniquement. Les tests supertest importent `app`.

### Phase 4 — Client: split des god files
- `lib/export.ts` (883 l.) → `lib/export/` un module par format (gpx, kml, geojson, osmand, kmz) + `common.ts`.
- `lib/enrichment/enricher.ts` (1099 l.) et `search.ts` (981 l.) → découpage par étape de pipeline
  (requête / fetch / parsing / scoring), sans changer l'API publique du module.
- `poi-config.ts` (753 l.): données de config, toléré; split data/logique seulement si trivial.

### Phase 5 — jotai
- `bun add jotai` (client).
- `src/state/`: atoms route/POI/filtres/session/enrichissement + atoms dérivés (POI filtrés).
- Persistance session: effet sur atoms (remplace les appels manuels save/load de App.tsx).
- `useRavitools`/`useEnrichment` deviennent des hooks minces exposant actions + atoms;
  les composants lisent les atoms directement — fin du prop drilling depuis App.tsx.

### Phase 6 — Tests refondus
- `__tests__/fvm.test.ts` (2556 l.) splitté par domaine.
- Helpers dupliqués regroupés dans `__tests__/helpers.ts`.
- Chaque phase précédente garde la suite verte; cette phase améliore lisibilité/DRY des tests.

## Vérification (chaque phase)

`just check` = typecheck + tests + lint sur les deux workspaces, zéro warning.
Baseline de départ: 517 tests client + 132 serveur, verts.

## Hors périmètre

- Pas de changement de comportement produit (mêmes requêtes Overpass, mêmes exports).
- Pas de migration bun test, pas de Hono, pas de refonte UI.
- Le GPX ne quitte jamais le navigateur (invariant conservé).
