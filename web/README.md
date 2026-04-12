# Ravitools

**Trouve des POIs utiles le long de ton itinéraire vélo, exporte-les sur ton smartphone.**

Ravitools enrichit des traces GPX avec des POI OpenStreetMap utiles pour le voyage à vélo et le bikepacking, puis exporte des résultats consultables hors ligne sur GPS ou en visualisation web.

---

## Table des matières

- [Architecture](#architecture)
- [Lancer en local](#lancer-en-local)
- [Pipeline de traitement](#pipeline-de-traitement)
- [Formats d'export](#formats-dexport)
- [Catégories de POI](#catégories-de-poi)
- [Enrichissement](#enrichissement)
- [Tests](#tests)
- [Structure du projet](#structure-du-projet)
- [Variables d'environnement](#variables-denvironnement)
- [Analyse UX/UI](#analyse-uxui)
- [Limitations connues et prochaines étapes](#limitations-connues-et-prochaines-étapes)

---

## Architecture

- **Frontend** : React 18 + Vite 5 + TypeScript 5 + Tailwind v4
- **Carte** : Leaflet 1.9 via react-leaflet 4
- **Serveur** : Express 4 + TypeScript (proxy léger)
- **Design** : Neobrutalist (bordures épaisses, ombres solides, couleurs franches)
- **Enrichissement** : SearXNG (web scraping) + WebLLM (Qwen2.5-1.5B in-browser via WebGPU)

```
┌──────────────────────────────────────────────────────────────────┐
│                         NAVIGATEUR                               │
│                                                                  │
│   ┌──────────┐    ┌──────────┐    ┌───────────────────────┐      │
│   │  Upload   │───>│  Parse   │───>│  Simplification trace │      │
│   │  GPX      │    │  GPX     │    │  (resampling 500m)    │      │
│   │ (drag&drop)│   │(DOMParser)│   └───────────┬───────────┘      │
│   └──────────┘    └──────────┘                │                  │
│                                               ▼                  │
│   ┌───────────────────────────────────────────────────────────┐  │
│   │  Construction requêtes Overpass                           │  │
│   │  • Chunking (25 pts/chunk, 3 pts overlap)                 │  │
│   │  • around:1000 sur trace simplifiée                       │  │
│   │  • 18 catégories POI (9 essential + 9 optional)           │  │
│   └───────────────────────┬───────────────────────────────────┘  │
│                           │ POST /api/overpass                   │
│                           ▼                                      │
│   ┌─────────────────────────────┐   ┌──────────────────────┐     │
│   │  Traitement POI             │   │  Carte Leaflet       │     │
│   │  • Tag matching             │   │  • Trace (polyline)  │     │
│   │  • Distance perpendiculaire │   │  • POIs (markers)    │     │
│   │  • Filtre < 1500m           │   │  • Popups enrichis   │     │
│   │  • Dédup 50m même catégorie │   └──────────────────────┘     │
│   │  • Tri par distance         │                                │
│   └─────────────┬───────────────┘                                │
│                 ▼                                                │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │  Export offline (tout côté client)                       │    │
│   │  .GPX │ .KML │ .GeoJSON │ .GPX OsmAnd │ .KMZ            │    │
│   └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│   ┌─────────────────────────────────────────────────────────┐    │
│   │  Enrichissement POI (post-pipeline, en arrière-plan)    │    │
│   │  • Reverse geocode ──> POST /api/geocode ──> Nominatim  │    │
│   │  • Web search ──> POST /api/search ──> SearXNG           │    │
│   │  • Synthèse locale ──> WebLLM (Qwen2.5-1.5B, WebGPU)   │    │
│   │  • Résultat: rating, horaires, résumé, lien Google Maps │    │
│   └─────────────────────────────────────────────────────────┘    │
└──────────────────────────────────────────────────────────────────┘
                            │
          POST /api/overpass │ POST /api/search │ POST /api/geocode
                            │
                 ┌──────────▼──────────┐
                 │  Serveur Express     │
                 │  (proxy léger)       │
                 │                      │
                 │  5 endpoints :       │
                 │  • GET  /health      │
                 │  • GET  /cache/stats │
                 │  • POST /overpass    │
                 │  • POST /search      │
                 │  • POST /geocode     │
                 │                      │
                 │  Rate limit, cache,  │
                 │  garde taille, retry │
                 └──┬─────┬─────┬──────┘
                    │     │     │
        ┌───────────▼┐ ┌─▼────────┐ ┌──▼──────────┐
        │ Overpass   │ │ SearXNG  │ │ Nominatim   │
        │ API (OSM)  │ │ (search) │ │ (geocode)   │
        └────────────┘ └──────────┘ └─────────────┘
```

**Principe fondamental** : le GPX ne quitte jamais le navigateur. Le serveur ne voit que les requêtes Overpass (coordonnées de la trace simplifiée) et les requêtes search/geocode. Privacy by design.

---

## Lancer en local

### Prérequis

- **Node.js >= 18**
- **npm**
- Un fichier `.gpx` à tester (3 exemples fournis dans `web/examples/`)
- Pour l'enrichissement : une instance **SearXNG** accessible (par défaut `http://localhost:8080`)

### Installation et démarrage

```bash
# 1. Cloner le repo
git clone <repo-url>
cd Ravitools

# 2. Installer les dépendances serveur
cd web/server
npm install

# 3. Installer les dépendances client
cd ../client
npm install

# 4. Lancer le serveur (terminal 1)
cd ../server
npm run dev
# ✓ Écoute sur http://localhost:3001
# ✓ Logs pino en mode pretty

# 5. Lancer le client (terminal 2)
cd ../client
npm run dev
# ✓ Écoute sur http://localhost:5173
# ✓ Vite proxy /api/* → localhost:3001

# 6. Ouvrir http://localhost:5173 dans le navigateur
```

### Résumé des ports

| Service | Port | Rôle |
|---------|------|------|
| Client Vite | `5173` | Frontend React, proxy `/api/*` vers le serveur |
| Serveur Express | `3001` | Proxy Overpass + search + geocode, cache, rate limit |

### Commandes utiles

```bash
# Build production
cd web/client && npm run build    # → web/client/dist/
cd web/server && npm run build    # → web/server/dist/

# Preview build prod client
cd web/client && npm run preview

# Lancer serveur prod
cd web/server && npm start

# Tests unitaires (121 tests, 6 suites)
cd web/client && npm test

# Tests E2E (Playwright, lance les 2 serveurs automatiquement)
cd web/client && npm run test:e2e

# Type check sans build
cd web/client && npx tsc --noEmit
```

---

## Pipeline de traitement

```
  ┌─────────┐     ┌─────────┐     ┌────────────┐     ┌──────────┐     ┌────────────┐     ┌──────┐
  │  idle    │────>│ parsing │────>│ simplifying│────>│ querying │────>│ processing │────>│ done │
  └─────────┘     └─────────┘     └────────────┘     └──────────┘     └────────────┘     └──────┘
       │                                                                                     │
       │                              ┌─────────┐                                            │
       └─────────────────────────────>│  error   │<───────────────────────────────────────────┘
                (reset)               └─────────┘              (exception)
```

| Étape | Où ça tourne | Ce qui se passe |
|-------|-------------|-----------------|
| **idle** | Client | En attente d'un fichier GPX |
| **parsing** | Client | `DOMParser` lit le XML, extrait les `<trkpt>` ou `<rtept>` |
| **simplifying** | Client | Resampling de la trace tous les 500m par interpolation linéaire |
| **querying** | Client → Serveur → Overpass | Envoi de chunks de 25 points avec `around:1000`, retry sur 429/504 |
| **processing** | Client | Matching tags → catégories, calcul distance perpendiculaire, dédup, filtre |
| **done** | Client | Affichage carte + filtres + export + enrichissement en arrière-plan |
| **error** | Client | Message d'erreur, bouton "Try again" |

---

## Formats d'export

### Pour GPS de vélo (Garmin, Wahoo, COROS...)

| Format | Extension | Contenu | Usage |
|--------|-----------|---------|-------|
| **GPX** | `.gpx` | Waypoints + trace originale | Format universel GPS |
| **KML** | `.kml` | Placemarks groupés par catégorie en dossiers | Google Earth |
| **GeoJSON** | `.geojson` | FeatureCollection standard | Apps web, QGIS |

### Pour smartphone offline (OsmAnd, Organic Maps, Guru Maps)

| Format | Extension | Contenu | App cible |
|--------|-----------|---------|-----------|
| **OsmAnd GPX** | `.gpx` | GPX + extensions `osmand:` (icônes, couleurs, groupes) | **OsmAnd** (meilleure expérience) |
| **KMZ** | `.kmz` | Archive ZIP contenant un KML avec dossiers par catégorie | **Organic Maps**, **Guru Maps** |

Tous les exports incluent les données enrichies (rating, horaires, résumé, lien Google Maps) quand elles sont disponibles.

Le GPX OsmAnd reste lisible par toutes les apps — les extensions `osmand:` sont simplement ignorées par les apps qui ne les connaissent pas. Le KMZ est construit sans dépendance externe (ZIP builder minimal, méthode STORE + CRC-32).

---

## Catégories de POI

18 catégories couvrant les besoins du bikepacking : 9 essentielles (activées par défaut) + 9 optionnelles (désactivées par défaut, l'utilisateur choisit).

### Essentielles (activées par défaut)

| Catégorie | Couleur | Tags OSM principaux | Nombre de tags |
|-----------|---------|---------------------|----------------|
| Water | `#0066CC` | `amenity=drinking_water`, `water_point` | 2 |
| Sleeping place | `#1A1A2E` | `tourism=camp_site`, `hostel`, `hotel`, `alpine_hut`, `chalet`, `guest_house`, `motel` | 7 |
| Restroom | `#FFD700` | `amenity=toilets`, `shower` | 2 |
| Shelter | `#444444` | `amenity=shelter` | 1 |
| Food shop | `#228B22` | `shop=supermarket`, `convenience`, `bakery`, `butcher`... | 28 |
| Restaurant or Bar | `#FF6B35` | `amenity=restaurant`, `cafe`, `fast_food`, `bar`, `pub`, `biergarten`, `food_court`, `ice_cream` | 8 |
| Gears | `#CC0000` | `shop=bicycle`, `outdoor`, `sports` | 3 |
| DIY | `#E65100` | `amenity=bicycle_repair_station` | 1 |
| Laundry | `#FFB6C1` | `shop=laundry` | 1 |

### Optionnelles (désactivées par défaut)

| Catégorie | Couleur | Tags OSM principaux | Nombre de tags |
|-----------|---------|---------------------|----------------|
| Medical | `#DC2626` | `amenity=hospital`, `clinic`, `doctors`, `dentist`, `veterinary` | 5 |
| Pharmacy | `#16A34A` | `amenity=pharmacy` | 1 |
| Bank & ATM | `#1D4ED8` | `amenity=atm`, `bank`, `bureau_de_change` | 3 |
| Post office | `#CA8A04` | `amenity=post_office`, `post_box` | 2 |
| Viewpoint | `#7C3AED` | `tourism=viewpoint`, `attraction`, `museum` + `historic=castle`, `monument`, `memorial`, `ruins` | 7 |
| Tourist info | `#38BDF8` | `tourism=information` + `information=office` | 2 |
| Charging | `#FACC15` | `amenity=charging_station`, `device_charging_station` | 2 |
| Picnic | `#059669` | `tourism=picnic_site`, `leisure=picnic_table`, `amenity=bbq` | 3 |
| Wifi | `#6366F1` | `amenity=internet_cafe`, `library` + `internet_access=wlan` | 3 |

**Paramètres de corridor** : rayon Overpass 1000m, distance max perpendiculaire 1500m, dédup 50m même catégorie.

---

## Enrichissement

L'enrichissement ajoute des données réelles aux POIs : note, horaires, avis, spécialité, niveau de prix, et un lien Google Maps.

### Pipeline d'enrichissement

Pour chaque POI :
1. **Reverse geocode** (Nominatim via `POST /api/geocode`) → adresse, ville, pays
2. **Recherche web** (SearXNG via `POST /api/search`) → snippets Google Maps, avis, horaires
3. **Synthèse LLM** (WebLLM, Qwen2.5-1.5B-Instruct q4f16) → extraction structurée des données

### Caractéristiques

- **Tourne dans le navigateur** (sauf search/geocode proxiés par le serveur)
- **WebGPU requis** pour le LLM — Firefox ne supporte pas WebGPU par défaut → fallback : snippets bruts sans synthèse
- **Modèle** : ~1.6 GB VRAM, téléchargé une fois et caché par le navigateur
- **Traitement batch** : tous les POIs sont enrichis en arrière-plan après le pipeline principal
- **Résultat** : lien Google Maps, note, horaires, résumé, spécialité, niveau de prix par POI
- **Les données enrichies apparaissent** dans la liste POI, les popups carte, et les 5 formats d'export

---

## Tests

```
 ✓ src/__tests__/poi-config.test.ts     (32 tests)  — complétude catégories, lookups, mappings OsmAnd
 ✓ src/__tests__/overpass.test.ts       (5 tests)   — construction requêtes, chunking
 ✓ src/__tests__/export.test.ts         (46 tests)  — GPX, KML, GeoJSON, OsmAnd, KMZ, ZIP, exports enrichis
 ✓ src/__tests__/poi-processor.test.ts  (9 tests)   — matching, distance, dédup, tri
 ✓ src/__tests__/gpx-parser.test.ts     (13 tests)  — haversine, parsing, simplification
 ✓ src/__tests__/enrichment.test.ts     (16 tests)  — URLs Google Maps, requêtes search, détection WebGPU, exports enrichis

 121 tests, 6 suites — tous passants
```

2 tests E2E Playwright (pipeline complet + gestion d'erreur).

---

## Structure du projet

```
web/
├── client/                          # Frontend React + Vite + Tailwind v4
│   ├── index.html
│   ├── package.json                 # React 18, Leaflet, Tailwind v4, @mlc-ai/web-llm
│   ├── vite.config.ts
│   ├── playwright.config.ts
│   ├── tsconfig.json
│   ├── e2e/
│   │   └── smoke.spec.ts            # 2 tests E2E Playwright
│   └── src/
│       ├── main.tsx
│       ├── App.tsx                   # Layout : sidebar 380px + carte flex-1
│       ├── index.css                # Tailwind v4 + design system neobrutalist
│       ├── vite-env.d.ts
│       ├── types/
│       │   └── index.ts             # TracePoint, POI, AppState, EnrichedData...
│       ├── lib/
│       │   ├── gpx-parser.ts        # Parse GPX, haversine, simplify, distanceToTrace
│       │   ├── overpass.ts          # Query builder, chunking 25pts, retry 429/504
│       │   ├── poi-processor.ts     # Tag match, distance filter, dédup, tri
│       │   ├── poi-config.ts        # 18 catégories + mappings OsmAnd
│       │   ├── export.ts            # 5 formats : GPX, KML, GeoJSON, OsmAnd GPX, KMZ
│       │   └── enrichment/          # Module d'enrichissement POI
│       │       ├── search.ts        # Adaptateur SearXNG, Google Maps URL, Nominatim
│       │       ├── llm.ts           # Intégration WebLLM (Qwen2.5-1.5B)
│       │       ├── enricher.ts      # Orchestrateur batch (geocode → search → synthèse)
│       │       └── index.ts         # Barrel export
│       ├── hooks/
│       │   ├── useRavitools.ts      # Machine à états du pipeline
│       │   └── useEnrichment.ts     # Machine à états du batch enrichissement
│       ├── components/
│       │   ├── GpxUpload.tsx        # Drag & drop zone
│       │   ├── RouteMap.tsx         # Carte Leaflet (trace + markers + popups enrichis)
│       │   ├── CategoryFilter.tsx   # Checkboxes par catégorie avec compteurs
│       │   ├── ExportPanel.tsx      # 5 boutons export (GPS + smartphone)
│       │   ├── PoiList.tsx          # Liste scrollable avec données enrichies
│       │   └── EnrichmentPanel.tsx  # Téléchargement modèle, déclenchement batch, barre de progression
│       └── __tests__/               # 121 tests vitest
│           ├── gpx-parser.test.ts
│           ├── overpass.test.ts
│           ├── poi-processor.test.ts
│           ├── poi-config.test.ts
│           ├── export.test.ts
│           └── enrichment.test.ts
│
├── server/                          # Backend Express (proxy léger)
│   ├── package.json                 # Express 4, node-cache, pino, helmet
│   ├── tsconfig.json
│   └── src/
│       └── index.ts                 # 5 endpoints : /health, /cache/stats, /overpass, /search, /geocode
│
├── examples/                        # GPX de test
│   ├── paris-urban-short.gpx        # 8.3km urbain dense
│   ├── loire-tours-saumur.gpx      # 67.8km plat rural
│   └── galibier-climb.gpx          # 25.5km montagne
│
└── docs/
    ├── architecture.md
    ├── deployment.md
    └── poi-categories.md
```

---

## Variables d'environnement

Le serveur se configure entièrement par variables d'env (pas de fichier `.env` requis, les valeurs par défaut fonctionnent en local) :

| Variable | Défaut | Description |
|----------|--------|-------------|
| `PORT` | `3001` | Port d'écoute du serveur |
| `OVERPASS_URL` | `https://overpass-api.de/api/interpreter` | Endpoint Overpass |
| `CACHE_TTL` | `86400` | Durée du cache Overpass en secondes (24h) |
| `MAX_QUERY_LENGTH` | `16000` | Taille max d'une requête Overpass (bytes) |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Fenêtre de rate limit (ms) |
| `RATE_LIMIT_MAX` | `10` | Requêtes Overpass max par fenêtre |
| `CORS_ORIGIN` | `*` | Origines CORS autorisées |
| `SEARXNG_URL` | `http://localhost:8080` | URL de l'instance SearXNG pour l'enrichissement |
| `NOMINATIM_URL` | `https://nominatim.openstreetmap.org` | Endpoint Nominatim pour le reverse geocoding |
| `SEARCH_CACHE_TTL` | `604800` | Durée du cache search en secondes (7 jours) |
| `GEOCODE_CACHE_TTL` | `2592000` | Durée du cache geocode en secondes (30 jours) |

---

## Analyse UX/UI

### Ce qui marche bien

**Le pipeline est solide.** Le flux upload → traitement → résultat est linéaire et clair. L'utilisateur voit à chaque étape ce qui se passe ("Querying Overpass... 2/5 chunks"), ce qui est important vu que les requêtes Overpass prennent 10-30s. La barre de statut avec le spinner chunky donne une bonne rétroaction.

**Le corridor `around:` est le bon choix technique.** Pas de "bruit" de POIs à 10km de la route. La dédup et le filtre perpendiculaire sont bien calibrés. Les résultats des 3 validations (Paris, Loire, Galibier) montrent des résultats pertinents dans les 3 contextes.

**L'export smartphone est bien pensé.** Offrir l'OsmAnd GPX enrichi tout en restant compatible avec les apps qui ignorent les extensions est pragmatique. Le KMZ sans dépendance externe est un bon choix d'ingénierie.

**Privacy by design.** Le GPX ne quitte pas le navigateur — c'est un vrai argument pour des utilisateurs qui partagent leur itinéraire sur des forums et ne veulent pas uploader leur trace sur un serveur inconnu.

### Ce qui mérite attention

**La carte est sous-exploitée.** Elle occupe ~70% de l'écran mais n'offre que de l'affichage. Quelques gains rapides :
- **Cliquer un POI dans la liste devrait centrer/zoomer la carte dessus** (et inversement, cliquer un marker devrait le highlighter dans la liste). C'est l'interaction la plus naturelle et elle manque.
- **Les `CircleMarker` radius 8 sont petits** sur un écran desktop. Sur mobile ils seront difficiles à toucher. Des markers plus gros ou des clusters (Leaflet.markercluster) sur les zones denses (Paris = 1524 POIs) amélioreraient la lisibilité.
- **Pas d'indication de direction/progression** le long de la trace. Un utilisateur voudrait savoir "qu'est-ce que je trouve dans les 20 prochains km ?" — un slider de distance ou un filtre par segment serait très utile.

**La sidebar à 380px fixe est rigide.** Sur un écran 13" la carte est compressée. Sur un 27" la sidebar est inutilement étroite. Un panneau redimensionnable ou un tiroir escamotable (surtout en mode "je regarde juste la carte") serait mieux.

**Le responsive mobile est basique.** Le `column-reverse` (carte en haut, sidebar en bas) fonctionne mécaniquement mais l'UX mobile n'a pas été réfléchie : la sidebar scrollable en bas est peu pratique, les boutons d'export sont petits, et la zone de drag & drop ne fonctionne pas bien sur mobile (il faudrait un bouton "Parcourir" plus visible).

**200 POIs max affichés dans la liste, sans explication évidente.** Le message "...and N more. Export to see all." est coupant — l'utilisateur pourrait croire que l'export est le seul moyen de voir le reste. Une pagination ou un scroll infini virtuel serait plus naturel.

**Pas de persistance d'état.** Si l'utilisateur rafraîchit la page, tout est perdu. Pour un outil de planification de voyage, pouvoir sauvegarder/reprendre une session (même juste en localStorage) serait important.

**Le design neobrutalist est distinctif mais peut fatiguer.** Les bordures 3px noires partout + les ombres solides créent beaucoup de "poids visuel". Sur une utilisation prolongée (planification d'un voyage de 2 semaines), ça peut devenir oppressant. La palette de fond `#fffdf5` est un bon choix (doux), mais les contrastes restent durs. C'est un choix assumé — juste être conscient que certains utilisateurs trouveront ça "agressif".

**Pas de mode sombre.** Pour un outil qu'on consulterait le soir sous la tente avant l'étape du lendemain, c'est un manque.

### Suggestions prioritaires (par impact/effort)

| Priorité | Suggestion | Effort |
|----------|-----------|--------|
| 1 | Interaction liste ↔ carte (clic = centrer + highlight) | Faible |
| 2 | Clusters de markers sur zones denses | Moyen |
| 3 | Slider "distance le long de la trace" pour filtrer les POIs par segment | Moyen |
| 4 | Persistance session (localStorage) | Moyen |
| 5 | Sidebar redimensionnable / escamotable | Moyen |
| 6 | Mode sombre | Moyen-élevé |

---

## Limitations connues et prochaines étapes

- **Traces longues (>500km)** : le chunking gère bien, mais les requêtes cumulées peuvent toucher le rate limit Overpass. Le cache serveur atténue ça pour les requêtes répétées.
- **Web Workers** : les GPX >50k points mériteraient un offloading en Worker pour ne pas bloquer le UI thread.
- **Cache serveur persistant** : actuellement en mémoire (perdu au restart). Redis ou SQLite pour la production.
- **Pas de tuiles offline** : la carte nécessite internet. Hors scope V1.
- **Pas de suite de tests serveur** : vitest configuré mais 0 tests écrits côté serveur.
- **WebLLM chunk ~6 MB** (WASM runtime). Le dynamic import fait du code-split mais Vite le bundle quand même. Cosmétique, pas bloquant.
- **COROS DURA** ne supporte pas les POI custom (fichiers `.csm` = Garmin IMG renommés, format de rendu non documenté).
- **Firefox** n'a pas WebGPU par défaut — la synthèse LLM de l'enrichissement nécessite Chrome/Edge/Safari.
