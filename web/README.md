# Ravitools Web

Application web de Ravitools: import GPX, recherche de POI utiles le long de la trace, enrichissement optionnel, export offline.

## Ce que fait l'application

- parse un ou plusieurs GPX dans le navigateur
- simplifie la trace pour limiter le cout des requetes
- interroge OpenStreetMap via Overpass par chunks
- filtre les POI par distance reelle a la trace
- fusionne seulement certaines categories quand cela garde du sens
- propose un enrichissement additionnel pour les POI qui meritent plus de contexte
- exporte le resultat en 5 formats offline

## Workflow

1. Upload GPX.
2. Parsing et simplification.
3. Construction des requetes Overpass.
4. Proxy serveur avec cache et rate limit.
5. Matching OSM -> categories POI.
6. Filtrage distance + merge selectif + tri.
7. Enrichissement optionnel.
8. Export.

## Parametres produit actuels

- resampling trace: `500m`
- chunk Overpass: `25` points avec overlap
- rayon Overpass: au moins `1000m`
- distance max a la trace: reglable dans l'UI
- merge adaptatif reserve aux categories mergeables

Le but est de garder des POI exploitables meme si le GPX traverse une grande ville, sans perdre des lieux distincts qui comptent pour l'enrichissement ou la decision utilisateur.

## Lancer en local

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

Client sur `http://localhost:5173`, serveur sur `http://localhost:3001`.

## Verification

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

## Structure utile

```text
web/
├── client/
│   └── src/
│       ├── components/
│       ├── hooks/
│       ├── lib/
│       ├── types/
│       └── __tests__/
├── server/
│   └── src/
├── examples/
└── docs/
```

## Fichiers importants

- `client/src/hooks/useRavitools.ts`
- `client/src/lib/overpass.ts`
- `client/src/lib/poi-processor.ts`
- `client/src/lib/export.ts`
- `client/src/lib/enrichment/`
- `server/src/index.ts`

## SearXNG (requis pour l'enrichissement)

L'enrichissement utilise SearXNG pour la recherche web.

**Option 1 - Docker Compose (recommande):**
```bash
docker-compose up -d searxng
```

**Option 2 - Docker seul:**
```bash
docker run -d -p 8888:8080 --rm -e SEARXNG_BASE_URL=http://localhost:8888 searxng/searxng
```

Le client verifie automatiquement la Disponibilite de SearXNG au chargement. Si indisponible, le bouton d'enrichissement est desactive avec un message d'erreur.

## Enrichissement

L'enrichissement ajoute des infos d'usage quand OSM seul ne suffit pas: horaires, note, resume, specialite, niveau de prix, lien Google Maps.

Pipeline:

1. reverse geocoding
2. recherche web
3. synthese locale via WebLLM quand WebGPU est disponible

## Notes importantes

- le GPX ne quitte jamais le navigateur
- le cache serveur est en memoire
- le cache client reutilise les memes requetes Overpass pendant la session
- Firefox n'active pas WebGPU par defaut
- COROS DURA ne supporte pas les POI custom exportes par cette app

## Aller plus loin

- `../CONTRIBUT.md`
- `docs/architecture.md`
- `docs/deployment.md`
- `docs/poi-categories.md`
