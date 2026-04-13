# Contribuer a Ravitools

Ce document explique comment faire tourner le projet, ou modifier le code, et comment garder des changements petits, comprehensibles et verifiables.

## Objectif produit

Ravitools ne cherche pas a afficher tous les POI autour d'une trace.

Le coeur du produit est de sortir des POI vraiment utiles le long d'un itineraire velo, avec un niveau de bruit assez bas pour rester exploitable avant le depart et pendant la route.

## Architecture

- `web/client`: React + Vite + TypeScript
- `web/server`: Express + TypeScript, proxy leger avec cache et rate limit
- `web/examples`: GPX de test
- `tasks`: suivi des sessions actives ou futures
- `tasks_archive`: historique des sessions terminees

Pipeline actuel:

1. Upload GPX dans le navigateur.
2. Parsing et simplification de la trace.
3. Construction des requetes Overpass par chunks.
4. Proxy serveur avec cache memoire, garde taille et rate limit.
5. Matching tags OSM vers categories POI.
6. Filtrage par distance a la trace et merge selectif par type.
7. Export offline.
8. Enrichissement optionnel via geocode + search + LLM local.

## Setup local

Prerequis:

- Node.js 18+
- npm

Serveur:

```bash
cd web/server
npm install
npm run dev
```

Client:

```bash
cd web/client
npm install
npm run dev
```

Application locale: `http://localhost:5173`

## Verification minimale

Client:

```bash
cd web/client
npx tsc --noEmit
npm test
npm run build
```

Serveur:

```bash
cd web/server
npm test
npm run build
```

Si la modif touche la logique POI, verifier aussi:

- la requete Overpass
- le filtrage distance
- la logique de merge/dedup
- l'export
- si possible un vrai GPX dans `web/examples/`

## Fichiers source prioritaires

- `web/client/src/types/index.ts`
- `web/client/src/lib/poi-config.ts`
- `web/client/src/lib/overpass.ts`
- `web/client/src/lib/poi-processor.ts`
- `web/client/src/lib/export.ts`
- `web/client/src/lib/enrichment/`
- `web/client/src/hooks/useRavitools.ts`
- `web/client/src/hooks/useEnrichment.ts`
- `web/server/src/index.ts`

## Conventions de changement

- preferer les plus petits changements corrects
- ne pas ajouter de compatibilite legacy sans besoin concret
- garder la logique proche de l'usage reel
- enlever la dead code ou la doc obsolete quand elle est clairement dans la zone touchee
- ne pas faire sortir le GPX du navigateur

## Task Tracking

Chaque session substantielle doit avoir un fichier `tasks/tasks_{id}.md`.

Format attendu:

```md
# Task: titre
Started: YYYY-MM-DD
Status: in-progress | done | blocked | abandoned

## Steps
- [x] Step completed
- [ ] Step pending

## Decisions
- Decision prise et pourquoi

## Blockers
- Si applicable
```

Regles:

- creer le fichier au debut de la session
- le mettre a jour pendant le travail
- passer le statut a `done` en fin de session
- deplacer ensuite les fichiers termines dans `tasks_archive/`

## Documentation complementaire

- `web/docs/architecture.md`
- `web/docs/deployment.md`
- `web/docs/poi-categories.md`
- `AGENTS.md`
