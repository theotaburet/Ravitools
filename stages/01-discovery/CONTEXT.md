# Stage 01 Discovery

## Inputs

| Source | File/Location | Section/Scope | Why |
|--------|--------------|---------------|-----|
| Global rules | `../../AGENTS.md` | Full file | Cadre agentique |
| Routing | `../../CONTEXT.md` | Full file | Positionner le stage |
| Vision | `../../_config/project-vision.md` | Full file | Rappeler l'objectif produit |
| Domain | `../../shared/domain-notes.md` | Full file | Contraintes OSM/GPS |
| Code | `../../main.py` | Routes et wiring | Comprendre le point d'entree |
| Code | `../../services/gpx_service.py` | Full file | Comprendre le pipeline principal |
| Code | `../../utils/overpass_client.py` | Full file | Comprendre Overpass/cache |
| Config | `../../config/config.yaml` | OSM_POI_configuration | Comprendre les categories |

## Process

1. Comprendre l'objectif utilisateur reel.
2. Cartographier le flux de donnees actuel.
3. Identifier les incoherences et zones floues.
4. Produire un resume clair dans `output/`.

## Outputs

| Artifact | Location | Format |
|----------|----------|--------|
| Audit de comprehension | `output/discovery-summary.md` | Markdown |
