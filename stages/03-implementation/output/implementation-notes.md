# Implementation Notes

## Cible immediate

Le prochain cycle d'implementation doit produire un premier vertical slice oriente futur produit public, sans reecriture totale du projet en une fois.

## Objectif du premier lot

Construire une base d'implementation qui valide les points suivants:

1. un GPX peut etre charge dans une future interface web publique,
2. la trace peut etre simplifiee cote client ou dans une logique portable,
3. deux categories de POI utiles peuvent etre recuperes de maniere fiable,
4. les resultats peuvent etre affiches clairement,
5. un export offline reste possible ou au minimum prepare proprement.

## Priorites d'implementation recommandees

## Lot A: fiabiliser l'existant comme reference

- unifier la source de config sur `config/config.yaml`,
- clarifier le point d'entree reel,
- retirer ou documenter les comportements demonstratifs non produit,
- verifier les dependances reelles.

Ce lot doit rester minimal. Son but n'est pas de perfectionner le Python, mais d'en faire une reference plus propre pour la suite.

## Lot B: preparer la migration produit

- definir l'interface de donnees minimale entre GPX, requetes OSM et POI,
- isoler les decisions metier des details de rendu,
- documenter le contrat de sortie attendu pour le frontend futur.

## Lot C: premier prototype TypeScript

- uploader un GPX,
- le parser,
- calculer un sous-ensemble de points de requete,
- passer par un proxy VPS minimal pour Overpass,
- afficher eau + camping,
- mesurer la qualite et le bruit.

## Decisions de mise en oeuvre

- Ne pas commencer par le KMZ complet si cela bloque tout.
- Ne pas commencer par toutes les categories de POI.
- Ne pas commencer par une UX complexe.
- Prioriser un flux simple mais valide bout en bout.

## Definition de done pour le premier vrai prototype

- un GPX reel est traite de bout en bout,
- les resultats sont visuellement cohérents,
- le nombre de faux positifs reste acceptable,
- la strategie Overpass ne sature pas rapidement,
- l'export offline n'est pas rendu plus difficile par les choix de structure.

## Fichiers candidats pour la prochaine implementation Python de stabilisation

- `main.py`
- `run.py`
- `requirements.txt`
- `utils/data_processor.py`

## Fichiers candidats pour le futur prototype produit

- nouveau frontend TypeScript hors de l'actuel Streamlit,
- proxy VPS minimal,
- spec de contrat GPX -> POI -> export.
