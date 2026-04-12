# AGENTS.md

## Mission

Ravitools enrichit des traces GPX avec des POI OpenStreetMap utiles pour le voyage a velo et le bikepacking, puis exporte des resultats consultables hors ligne sur GPS ou en visualisation web.

Le coeur metier est: trouver des POI vraiment utiles le long d'un itineraire, pas simplement dans un rayon large et bruité.

## Regles globales

- Garder ce fichier court. Tout ce qui devient trop specifique doit aller dans `skills/`, `shared/` ou `stages/`.
- Travailler avec un contexte minimal: charger seulement les fichiers utiles a la tache en cours.
- Pour les taches larges, suivre les stages ICM du depot plutot que de tout faire dans une seule session.
- Ne pas introduire de `CLAUDE.md` dans ce projet. La source d'instructions agentiques partagees est `AGENTS.md`.
- Preferer des changements minimaux, verifiables et orientes usage reel.

## Architecture metier actuelle

1. Upload ou lecture d'un GPX.
2. Lissage/regularisation de la trace.
3. Construction d'une requete Overpass a partir de `config/config.yaml`.
4. Recuperation et cache des donnees OSM.
5. Mapping OSM -> POI affichables.
6. Export HTML/KMZ.

## Sources prioritaires

- `main.py`
- `services/gpx_service.py`
- `utils/overpass_client.py`
- `utils/data_processor.py`
- `config/config.yaml`
- `CONTEXT.md`

## Verification minimale

- Syntaxe Python: `python -m compileall main.py services utils config app_frontend.py`
- Memory/tooling: utiliser `./.tools/mempalace-py312/bin/mempalace ...`
- Si une modif touche la logique POI: verifier la requete OSM, le filtrage, l'export et le resultat sur un vrai GPX si possible.

## Token Saving

- Ne pas relire tout le depot si la tache est locale.
- Utiliser `stages/` pour separer exploration, architecture, implementation et validation.
- Utiliser `skills/` pour les workflows repetables plutot que de gonfler `AGENTS.md`.
- Utiliser MemPalace pour retrouver decisions et artefacts, pas comme substitut a des fichiers de spec clairs.

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
- `config.yaml` a la racine est un doublon legacy; la reference principale doit etre `config/config.yaml` sauf verification contraire.
- Le projet n'a pas encore de vraie suite de tests automatisee.
