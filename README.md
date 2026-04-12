# Ravitools

Ravitools enrichit des traces GPX avec des POI OpenStreetMap utiles pour le voyage a velo et le bikepacking, puis exporte des resultats consultables hors ligne sur GPS ou smartphone.

Le projet principal est l'application web dans `web/`.

## Ce que fait le projet

- charge un fichier GPX dans le navigateur
- simplifie la trace pour construire des requetes Overpass raisonnables
- recupere des POI vraiment proches de l'itineraire, pas juste dans un grand rayon bruite
- filtre, dedup et classe les POI par categories utiles a velo
- exporte le resultat en formats exploitables offline
- enrichit en option les POI avec recherche web + synthese locale dans le navigateur

## Par ou commencer

Si tu veux utiliser ou faire evoluer le produit, commence ici:

- `web/README.md`: documentation fonctionnelle et technique principale
- `web/client/src/hooks/useRavitools.ts`: pipeline principal cote client
- `web/client/src/lib/poi-config.ts`: categories POI et mapping OSM
- `web/client/src/lib/overpass.ts`: construction des requetes Overpass
- `web/client/src/lib/poi-processor.ts`: filtrage distance + dedup
- `web/client/src/lib/export.ts`: exports GPX, KML, GeoJSON, OsmAnd GPX, KMZ
- `web/server/src/index.ts`: proxy Express pour Overpass, search et geocode

Contexte agentique et regles projet:

- `AGENTS.md`

## Etat du repo

- `web/`: source principale, active
- `tasks/`: journal de sessions de travail a garder
- `skills/`, `shared/`, `_config/`: support au travail d'implementation

La logique metier actuelle est decrite en version courte dans `AGENTS.md` et en version detaillee dans `web/README.md`.

## Lancer le projet

Prerequis:

- Node.js 18+
- npm

Installation et lancement:

```bash
cd web/server
npm install
npm run dev
```

Dans un second terminal:

```bash
cd web/client
npm install
npm run dev
```

Ensuite ouvrir `http://localhost:5173`.

Le client appelle le serveur Express sur `http://localhost:3001` via le proxy Vite.

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
npm run build
```

## Architecture rapide

Pipeline web actuel:

1. Upload GPX dans le navigateur.
2. Parsing et simplification de la trace.
3. Construction de requetes Overpass par chunks.
4. Proxy serveur avec cache, rate limit et garde taille.
5. Matching des tags OSM vers les categories POI.
6. Filtrage par distance perpendiculaire et dedup.
7. Export offline.
8. Enrichissement optionnel via geocode + recherche web + LLM local dans le navigateur.

Principe important: le GPX ne quitte jamais le navigateur.

## Formats de sortie

- `GPX`
- `KML`
- `GeoJSON`
- `OsmAnd GPX`
- `KMZ`

Le detail des formats, categories POI, variables d'environnement et limitations connues est documente dans `web/README.md`.

## Workflow de contribution

- faire des changements minimaux et verifies
- ne pas traiter le code legacy comme source principale sans raison claire
- creer un fichier `tasks/tasks_{id}.md` pour toute session de travail substantielle
- garder ce fichier a jour pendant la session, puis le passer a `Status: done`

Format attendu pour `tasks/tasks_{id}.md`:

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

## Ce qui merite attention

- la valeur du projet est tres claire: extraire des POI vraiment utiles le long d'un itineraire velo est un vrai probleme produit
- le coeur metier actuel semble bien cadre autour du signal utile plutot que du volume de POI
- le README racine ne doit pas dupliquer toute la doc web: son role est d'orienter rapidement vers la bonne partie du repo
- le positionnement produit semble net: usage avant depart et pendant le trajet, avec resume offline des lieux utiles

## Docs utiles

- `web/README.md`
- `web/docs/architecture.md`
- `web/docs/deployment.md`
- `web/docs/poi-categories.md`
