# Stage 02 Architecture

## Inputs

| Source | File/Location | Section/Scope | Why |
|--------|--------------|---------------|-----|
| Previous stage | `../01-discovery/output/` | Full files | Base de travail |
| Global rules | `../../AGENTS.md` | Full file | Regles de travail |
| Vision | `../../_config/project-vision.md` | Full file | Objectif cible |
| Domain | `../../shared/domain-notes.md` | Full file | Contraintes OSM/GPS |
| Memory | `../../shared/mempalace.md` | Full file | Retrouver le contexte |

## Process

1. Comparer les options: Python maintenu, migration TS, hybride client/VPS.
2. Evaluer la repartition calcul client/serveur.
3. Proposer une architecture cible exploitable.
4. Ecrire la decision et les risques dans `output/`.

## Outputs

| Artifact | Location | Format |
|----------|----------|--------|
| Decision d'architecture | `output/architecture-decision.md` | Markdown |
| Risques et compromis | `output/architecture-risks.md` | Markdown |
