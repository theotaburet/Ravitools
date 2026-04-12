# AGENTS.md

## Mission

Ravitools enrichit des traces GPX avec des POI OpenStreetMap utiles pour le voyage a velo et le bikepacking, puis exporte des resultats consultables hors ligne sur GPS ou en visualisation web.

Le coeur metier est: trouver des POI vraiment utiles le long d'un itineraire, pas simplement dans un rayon large et bruite.

## Regles globales

- Garder ce fichier court. Tout ce qui devient trop specifique doit aller dans `skills/`, `shared/`, `stages/` ou `tasks/`.
- Travailler avec un contexte minimal: charger seulement les fichiers utiles a la tache en cours.
- Pour les taches larges, suivre les stages ICM du depot plutot que de tout faire dans une seule session.
- Ne pas introduire de `CLAUDE.md` dans ce projet. La source d'instructions agentiques partagees est `AGENTS.md`.
- Preferer des changements minimaux, verifiables et orientes usage reel.

## Task Tracking

Chaque session de travail substantielle doit etre suivie dans un fichier `tasks/tasks_{id}.md`.

### Regles

1. **Creer** un fichier `tasks/tasks_{id}.md` au debut d'une session (id = nom court descriptif, ex: `phase18-enrichment`, `fix-overpass-timeout`).
2. **Mettre a jour** le fichier au fur et a mesure: cocher les items termines, ajouter les items decouverts en cours de route.
3. **Format standard** (Markdown checkboxes):

```markdown
# Task: {titre}
Started: {date}
Status: in-progress | done | blocked

## Steps
- [x] Step completed
- [ ] Step pending
- [ ] Step not started

## Decisions
- {decision prise et pourquoi}

## Blockers
- {si applicable}
```

4. Quand une session est terminee, marquer `Status: done` et mettre a jour la liste.
5. Ne pas supprimer les fichiers tasks termines — ils servent d'historique.
6. Si un fichier task est abandonne, marquer `Status: abandoned` avec une explication.

## Architecture metier actuelle (web)

1. Upload GPX dans le navigateur (drag & drop).
2. Parsing et simplification de la trace (resampling 500m).
3. Construction de requetes Overpass par chunks (25 pts/chunk, `around:1000`).
4. Proxy serveur Express (cache memoire, rate-limit, guard taille).
5. Matching tags OSM -> 18 categories POI (9 essential + 9 optional).
6. Filtrage distance perpendiculaire (< 1500m), dedup (50m meme categorie).
7. Export 5 formats: GPX, KML, GeoJSON, OsmAnd GPX (extensions), KMZ (ZIP builder).
8. (WIP) Enrichissement POI via SearXNG + LLM in-browser (WebLLM).

## Sources prioritaires

### Web (source principale)
- `web/client/src/types/index.ts`
- `web/client/src/lib/poi-config.ts`
- `web/client/src/lib/overpass.ts`
- `web/client/src/lib/poi-processor.ts`
- `web/client/src/lib/export.ts`
- `web/client/src/hooks/useRavitools.ts`
- `web/server/src/index.ts`
- `web/README.md`

### Python legacy (lecture seule)
- `config/config.yaml`
- `CONTEXT.md`

## Verification minimale

- Type check: `cd web/client && npx tsc --noEmit`
- Tests: `cd web/client && npm test`
- Build prod: `cd web/client && npm run build`
- Syntaxe Python (legacy): `python -m compileall main.py services utils config app_frontend.py`
- Si une modif touche la logique POI: verifier la requete OSM, le filtrage, l'export et le resultat sur un vrai GPX si possible.

## Token Saving

- Ne pas relire tout le depot si la tache est locale.
- Utiliser `stages/` pour separer exploration, architecture, implementation et validation.
- Utiliser `skills/` pour les workflows repetables plutot que de gonfler `AGENTS.md`.
- Utiliser `tasks/` pour le suivi operationnel des sessions de travail.

## MemPalace

- Environnement local: `./.tools/mempalace-py312`
- Palace local du projet: `./.mempalace/palace`
- Config projet: `mempalace.yaml`

Commandes utiles:

- `./.tools/mempalace-py312/bin/mempalace --palace ./.mempalace/palace status`
- `./.tools/mempalace-py312/bin/mempalace --palace ./.mempalace/palace search "query"`
- `./.tools/mempalace-py312/bin/mempalace --palace ./.mempalace/palace wake-up`

## Contraintes connues

- `MemPalace` doit tourner avec le venv Python 3.12 du repo, pas avec Python 3.14.
- `config.yaml` a la racine est un doublon legacy; la reference principale est `config/config.yaml`.
- Tailwind v4 ne supporte pas `@apply` sur des classes custom definies dans le meme fichier CSS — utiliser du CSS pur.
- `DOMParser` n'existe pas en Node — les tests qui parsent du GPX ont besoin de `// @vitest-environment jsdom`.
- Le GPX ne quitte jamais le navigateur (privacy by design).
- Les fichiers GPX d'exemple sont dans `web/examples/`.
- COROS DURA ne supporte pas les POI custom (fichiers `.csm` = Garmin IMG renommes, format de rendu non documente).
