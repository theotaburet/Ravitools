# Architecture Decision

## Decision

La cible recommandee est une architecture hybride:

- frontend public en TypeScript,
- calcul local maximal dans le navigateur,
- VPS leger pour proxy, cache, rate limiting et fallback autour d'Overpass,
- Python actuel conserve temporairement comme reference fonctionnelle, pas comme cible long terme.

## Pourquoi cette option

## Full client seul

Avantages:

- charge serveur minimale,
- cout faible,
- machine cliente pleinement exploitee,
- aucune sensibilite au leak de code puisque ce n'est pas un probleme ici.

Limites:

- exposition directe aux limites Overpass,
- CORS et fiabilite potentiellement variables,
- absence de cache mutualise,
- pas de garde-fou central en cas d'abus ou de requetes trop lourdes,
- plus dur de garantir un service public stable.

## Backend lourd serveur

Avantages:

- comportement plus controle,
- centralisation du cache et des garde-fous,
- plus simple pour supervision et fallback.

Limites:

- cout plus eleve,
- moins de calcul sur le client,
- moins aligne avec l'objectif de faire porter un maximum de charge a la machine utilisateur.

## Hybride client lourd + VPS leger

Cette option combine:

- calcul geospatial et rendu cote client,
- controle des appels reseau et mutualisation du cache cote serveur,
- migration TypeScript naturelle,
- bon compromis entre cout, robustesse et performance percue.

## Repartition recommandee

## Cote navigateur

- upload local du GPX,
- parsing GPX,
- simplification/lissage de la trace,
- calcul d'un couloir ou d'un sous-ensemble de points de requete,
- affichage carte,
- filtrage secondaire et tri des POI,
- export web ou preparation d'un export simple,
- usage de Web Workers si les calculs deviennent lourds.

## Cote VPS

- proxy Overpass,
- cache mutualise des requetes,
- rate limiting,
- garde-fous sur taille/forme des requetes,
- fallback ou degradation propre quand Overpass est lent ou indisponible,
- eventuelle generation d'exports plus lourds si l'export navigateur est limite.

## Contrat produit a garder

Le viewer web ne doit pas devenir l'objectif principal au detriment de l'usage GPS. Le contrat cible reste:

- charger un GPX,
- obtenir des POI utiles pour le voyage a velo,
- sortir un artefact offline exploitable.

## Langage et stack cibles

## Frontend

- TypeScript
- React + Vite est la recommandation la plus simple pour un prototype rapide
- librairie carto moderne a choisir lors de l'implementation
- geospatial JS pour buffer, distance, simplification

## Serveur

- VPS avec API tres legere
- Node/TypeScript ou Python minimal acceptables
- la fonction cle est le proxy/cache, pas une logique metier lourde

## Strategie de migration

1. Garder le Python actuel comme reference et oracle fonctionnel.
2. Implementer un prototype vertical TypeScript minimal.
3. Valider la qualite des resultats sur de vrais GPX.
4. Migrer progressivement les briques reussies.
5. Ne retirer le Python que lorsque le flux TypeScript couvre l'usage reel.

## Premier scope d'implementation recommande

Le premier lot d'implementation doit viser:

- categories: eau + camping,
- un seul GPX a la fois,
- affichage web simple,
- proxy/cache Overpass minimal sur VPS,
- export intermediaire simple avant KMZ complet si besoin.
