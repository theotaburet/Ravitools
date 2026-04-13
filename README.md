# Ravitools

Ravitools trouve des POI utiles le long d'un GPX de voyage a velo, les filtre pour reduire le bruit, puis les exporte pour un usage offline sur GPS, smartphone ou carte web.

## Features

- import d'un ou plusieurs fichiers `.gpx` dans le navigateur
- extraction de POI OpenStreetMap le long de la route, pas sur une grande zone vague
- categories pensees pour le bikepacking: eau, nourriture, couchage, toilettes, abri, reparation, etc.
- filtre par categorie et distance max a la trace via slider
- fusion selective des POI uniquement quand ca garde du sens a l'usage
- enrichissement optionnel des lieux qui meritent plus de contexte
- export en `GPX`, `KML`, `GeoJSON`, `OsmAnd GPX` et `KMZ`
- reprise de session locale et cache pour eviter des recalculs/requetes inutiles

## Workflow

1. Charger un ou plusieurs GPX.
2. Ravitools simplifie la trace dans le navigateur.
3. L'app interroge OpenStreetMap via le proxy serveur.
4. Les POI sont filtres par distance reelle a la trace puis nettoyes.
5. L'utilisateur ajuste categories et distance max selon le contexte.
6. Les POI utiles peuvent etre enrichis puis exportes offline.

Principe important: le GPX ne quitte jamais le navigateur.

## Quick Start

Prerequis:

- Node.js 18+
- npm

Lancer le serveur:

```bash
cd web/server
npm install
npm run dev
```

Lancer le client:

```bash
cd web/client
npm install
npm run dev
```

Ouvrir `http://localhost:5173`.

## Repo Guide

- `web/client`: application React
- `web/server`: proxy Express pour Overpass, search et geocode
- `web/examples`: GPX d'exemple
- `tasks`: sessions de travail actives ou futures
- `tasks_archive`: historique de sessions terminees

## Docs

- `CONTRIBUT.md`: contribution, architecture, verification et conventions du repo
- `web/docs/architecture.md`: details techniques web
- `web/docs/deployment.md`: deploiement
- `web/docs/poi-categories.md`: categories POI
