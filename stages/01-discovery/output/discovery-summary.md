# Discovery Summary

## Objectif compris

Le projet vise a enrichir une trace GPX de voyage a velo avec des POI OpenStreetMap utiles en situation reelle, puis a exporter le resultat pour une consultation hors ligne sur GPS et en visualisation web.

La valeur metier n'est pas de lister des POI dans une zone large. La valeur est de trouver des POI utiles, plausiblement accessibles, proches de l'itineraire et priorises pour le voyage a velo.

## Pipeline actuel

1. Le backend FastAPI recoit un GPX ou un chemin de fichier.
2. `GPXSmoother` parse la trace et la reechantillonne pour reduire le nombre de points.
3. `OverpassClient` construit une requete Overpass a partir des categories definies dans `config/config.yaml`.
4. La reponse Overpass est mise en cache dans `data/cache`.
5. `DataProcessor` transforme les elements OSM en `POI` et groupes Folium.
6. `MapGenerator` genere une carte HTML et un export KML/KMZ avec icones.
7. `app_frontend.py` fournit une interface Streamlit qui appelle le backend.

## Ce qui fonctionne deja conceptuellement

- Le projet a deja un pipeline bout en bout coherent.
- Les categories de POI vivent surtout dans le YAML, ce qui est une bonne base.
- Le lissage GPX est deja separe de la logique Overpass.
- Le cache Overpass existe deja.
- L'export KMZ est deja pense comme une contrainte produit, pas comme un bonus.

## Ce qui semble encore prototype

- L'interface publique actuelle est une interface Streamlit de travail, pas un produit web public.
- Les schemas et certains retours API melangent objets metier et types difficiles a serialiser proprement, notamment `folium.FeatureGroup`.
- Il n'y a pas de vraie suite de tests automatisee.
- La qualite metier des POI n'est pas encore formalisee par des fixtures GPX et des criteres de succes.
- La logique de proximity est encore proche d'un rayon technique Overpass, plus que d'un vrai couloir metier le long de la route.

## Incoherences et points faibles identifies

## Configuration

- `main.py` utilise `Config("config/config.yaml")` dans le flux principal.
- La route `/visualize-gpx/` utilise encore `Config("config.yaml")`.
- `config.yaml` a la racine est un doublon legacy du fichier principal `config/config.yaml`.

## Packaging et execution

- `run.py` pointe vers `app.main:app`, alors que le point d'entree visible du depot est `main.py`.
- `requirements.txt` ne semble pas couvrir toutes les dependances effectivement utilisees dans `utils/map_generator.py` et `utils/overpass_client.py`.

## Donnees et rendu

- `DataProcessor` contient une logique de post-traitement demonstrative (`Processed with NLP`) qui ne semble pas etre une vraie regle produit.
- `DataProcessor` duplique une methode `_add_to_feature_group` dans le fichier.
- Le choix des POI repose surtout sur le YAML, mais les heuristiques de tri et de deduplication ne sont pas encore explicites.

## Export et UX

- Le projet produit deja HTML et KMZ, mais la compatibilite GPS ciblee n'est pas encore formalisee.
- La contrainte "offline GPS utile" doit rester le contrat principal.

## Decision de discovery

Le projet est suffisamment clair pour passer a une phase d'architecture puis d'implementation. Il ne faut pas partir tout de suite dans une reecriture totale aveugle. Il faut d'abord figer une cible claire:

- frontend TypeScript public,
- calcul local maximal dans le navigateur,
- VPS leger pour proxy/cache/protection Overpass,
- export GPS/offline garde comme contrainte forte.

## Recommandation immediate

La prochaine etape doit etre un prototype vertical minimal, pas une refonte globale. Ce prototype doit valider:

1. upload GPX,
2. simplification de trace,
3. recuperation d'au moins deux categories de POI utiles,
4. affichage web,
5. export reutilisable hors ligne.
