# Contribuer à Ravitools

Ravitools enrichit une trace GPX avec des POI OpenStreetMap utiles au voyage à vélo, puis les exporte pour un usage hors ligne. Le critère de qualité est l'utilité des POI le long de l'itinéraire, pas leur nombre. Le GPX ne quitte jamais le navigateur.

## Prérequis

- [Bun](https://bun.sh) 1.x
- [just](https://github.com/casey/just)
- Docker, facultatif : SearXNG et PostGIS pour l'enrichissement

## Démarrer

```bash
just install   # bun install (workspaces web/client + web/server)
just server    # proxy Express sur :3001
just client    # Vite sur :5173
```

`just` sans argument liste les recettes.

Pour l'enrichissement : `just searxng` lance SearXNG en Docker. Le cache PostGIS est facultatif (`docker compose up -d postgis`, puis `DATABASE_URL` dans l'environnement du serveur) ; sans lui le serveur tourne en proxy pur.

## Vérifier

```bash
just check      # typecheck + tests + lint, client et serveur, zéro warning
just test-e2e   # Playwright (client)
```

Un changement n'est terminé que si `just check` passe. Les warnings sont des erreurs.

Si la modification touche la logique POI (requête Overpass, matching, filtrage, dédup, export) :

1. charger un GPX de `web/examples/` dans l'app ;
2. vérifier que les POI restent proches de la trace et que le bruit reste acceptable ;
3. ouvrir un export (GPX, KML, GeoJSON, OsmAnd, KMZ) dans un vrai viewer si possible.

## Où est quoi

| Chemin | Rôle |
|---|---|
| `web/client/src/types/index.ts` | types du domaine |
| `web/client/src/lib/poi-config.ts` | catégories POI et tags OSM (source de vérité) |
| `web/client/src/lib/gpx-parser.ts` | parsing, simplification, distance à la trace |
| `web/client/src/lib/overpass.ts` | requêtes Overpass par chunks |
| `web/client/src/lib/poi-processor.ts` | matching, dédup, filtrage |
| `web/client/src/lib/export/` | un module par format |
| `web/client/src/lib/enrichment/` | geocode, recherche SearXNG, WebLLM, fallbacks |
| `web/client/src/state/` | atoms jotai (route, enrichment, ui) |
| `web/client/src/components/` | UI React |
| `web/server/src/app.ts` + `routes/` | proxy Express, caches, rate limit |
| `web/server/src/scrapers/` | jobs Playwright (Google Maps) |
| `web/docs/` | architecture, déploiement, catégories POI |
| `tasks/` | suivi des travaux en cours |

## Ajouter ou modifier une catégorie POI

1. Vérifier si des tags OSM peuvent être ajoutés à une catégorie existante.
2. Choisir les tags les plus pertinents pour l'usage vélo et estimer le risque de faux positifs.
3. Modifier `POI_CATEGORIES` et les mappings OsmAnd dans `poi-config.ts`, le type `PoiCategory` dans `types/index.ts`, les libellés dans `lib/i18n.ts` (fr + en).
4. Documenter le choix et ses limites dans `web/docs/poi-categories.md`.
5. `just check`, puis test sur un GPX d'exemple.

## Conventions

- Changements petits et vérifiables. Pas de compatibilité legacy sans besoin concret.
- Pas de nouvelle dépendance pour ce que quelques lignes font déjà.
- Supprimer le code mort et la doc obsolète dans la zone touchée.
- Toute chaîne visible passe par `t(key, lang)` dans `lib/i18n.ts` (fr + en).
- Pas de tiret cadratin dans le code, les commentaires, l'UI ou la doc : deux-points, point-virgule ou parenthèses.
- Un commentaire explique un choix non évident, jamais l'historique d'un changement (c'est le rôle de git).
- Tailwind v4 : pas de `@apply` sur des classes custom du même fichier CSS.
- Tests qui parsent du GPX : `// @vitest-environment jsdom` (pas de `DOMParser` en Node).
- Commits : une ligne, pas de corps.

## Suivi des travaux

Une session de travail substantielle a son fichier `tasks/tasks_{id}.md` (étapes cochées, décisions, blocages). Terminé, il part dans `tasks_archive/`, qui n'est pas suivi par git.
