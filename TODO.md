# Todo List

## 1. Vision produit

- [ ] Confirmer l'objectif central: enrichir un GPX velo avec des POI OSM vraiment utiles le long de la trace.
- [ ] Fixer la cible principale de la V1: web public, export GPS offline, ou les deux.
- [ ] Definir le persona principal: bikepacker autonome, cyclotouriste longue distance, utilisateur GPS expert.
- [ ] Fixer les categories V1 prioritaires: eau, camping, toilettes, abri, alimentation, restauration, reparation velo, couchage.
- [ ] Definir ce que veut dire "utile" pour un POI sur itineraire.
- [ ] Definir si la priorite produit est la pertinence, la vitesse, l'offline, ou la simplicite d'usage.

## 2. Audit de l'existant Python

- [ ] Auditer le backend FastAPI actuel.
- [ ] Auditer l'interface Streamlit actuelle.
- [ ] Auditer le service `services/gpx_service.py`.
- [ ] Auditer `utils/overpass_client.py`.
- [ ] Auditer `utils/data_processor.py`.
- [ ] Auditer la logique de lissage GPX.
- [ ] Auditer la generation HTML/KMZ.
- [ ] Lister ce qui est prototype et ce qui est reutilisable.
- [ ] Lister les incoherences actuelles de configuration et de point d'entree.
- [ ] Verifier les dependances manquantes ou obsoletees dans `requirements.txt`.

## 3. Donnees et logique metier

- [ ] Definir precisement la notion de "le long de la route".
- [ ] Choisir entre rayon simple, buffer geometrique, ou couloir intelligent le long de la trace.
- [ ] Definir la distance maximale acceptable entre POI et trace.
- [ ] Definir une methode de tri des POI.
- [ ] Definir une methode de deduplication des POI proches.
- [ ] Definir les champs a conserver par categorie de POI.
- [ ] Definir les regles pour exclure les faux positifs.
- [ ] Documenter les tags OSM prioritaires par categorie.
- [ ] Prevoir une strategie de fallback quand les tags OSM sont incomplets ou bruyants.

## 4. Sortie et compatibilite GPS

- [ ] Definir le format de sortie principal attendu.
- [ ] Decider si KMZ reste obligatoire en V1.
- [ ] Verifier les besoins reels des GPS cibles.
- [ ] Definir les contraintes d'icones, de noms et de descriptions pour l'export GPS.
- [ ] Definir si un GPX enrichi, KML/KMZ, GeoJSON et viewer web doivent coexister.
- [ ] Construire une matrice compatibilite GPS par format.

## 5. Architecture cible

- [ ] Comparer trois options: Python conserve, reecriture TypeScript, hybride.
- [ ] Evaluer une architecture full client.
- [ ] Evaluer une architecture client lourd + proxy VPS.
- [ ] Evaluer une architecture backend plus forte si Overpass devient limitant.
- [ ] Decider ce qui tourne dans le navigateur: parsing GPX, lissage, buffer, filtrage, rendu carte, export.
- [ ] Decider ce qui tourne sur le VPS: proxy OSM, cache, rate limiting, fallback, analytics eventuels.
- [ ] Documenter les compromis perf/cout/robustesse.

## 6. TypeScript et frontend

- [ ] Valider TypeScript comme langage cible de la future version publique.
- [ ] Choisir le socle frontend: Vite + React, Next.js, ou autre.
- [ ] Evaluer les libs TypeScript pour GPX.
- [ ] Evaluer les libs geospatiales TypeScript pour buffer, distance et simplification.
- [ ] Evaluer les libs de cartographie pour le viewer.
- [ ] Evaluer les libs d'export KML/KMZ cote JS.
- [ ] Definir une architecture frontend modulaire avec Web Workers si calcul lourd.
- [ ] Definir le cache navigateur utile.

## 7. Overpass et robustesse publique

- [ ] Definir une strategie de requetes compatible avec un usage public.
- [ ] Limiter la taille et la densite des requetes.
- [ ] Prevoir un cache mutualise sur le VPS.
- [ ] Prevoir un systeme de retry/backoff.
- [ ] Prevoir un fallback quand Overpass est indisponible.
- [ ] Verifier les contraintes de CORS si une partie des appels part du navigateur.
- [ ] Documenter clairement les limites de couverture et de fraicheur OSM.

## 8. Hebergement et exploitation

- [ ] Definir l'usage exact du VPS.
- [ ] Choisir entre frontend statique seul, frontend + API proxy, ou backend plus complet.
- [ ] Definir la politique de retention des GPX uploades.
- [ ] Definir la politique de logs et de respect de la vie privee.
- [ ] Ajouter des limites de taille de fichier et de temps de traitement.
- [ ] Prevoir une surveillance minimale des erreurs de prod.

## 9. Validation fonctionnelle

- [ ] Constituer un corpus de GPX reels.
- [ ] Ajouter un petit trajet urbain.
- [ ] Ajouter un trajet rural.
- [ ] Ajouter un trajet montagne.
- [ ] Ajouter un trajet longue distance.
- [ ] Definir des criteres de qualite mesurables.
- [ ] Comparer les resultats par categorie de POI.
- [ ] Evaluer la taille des exports produits.
- [ ] Evaluer la rapidite sur machine cliente.

## 10. MemPalace

- [x] Installer Python 3.12 compatible.
- [x] Installer `MemPalace` dans `./.tools/mempalace-py312`.
- [x] Initialiser `mempalace.yaml` pour le projet.
- [x] Miner le depot dans `./.mempalace/palace`.
- [ ] Ajouter des conventions d'usage MemPalace au flux quotidien.
- [ ] Definir quelles recherches doivent passer par MemPalace.
- [ ] Eventuellement miner plus tard les notes, specs et conversations exportees du projet.

## 11. ICM et structure agentique

- [x] Remplacer `AGENT.md` par `AGENTS.md`.
- [x] Ajouter `CONTEXT.md` a la racine.
- [x] Ajouter des stages ICM dedies.
- [x] Ajouter `_config/`, `shared/` et `skills/`.
- [x] Produire un premier `stages/01-discovery/output/discovery-summary.md`.
- [x] Produire une premiere decision d'architecture dans `stages/02-architecture/output/architecture-decision.md`.
- [ ] Garder `AGENTS.md` court et stable.

## 12. Skills a iterer

- [x] Ajouter un skill d'ajout de POI.
- [x] Ajouter un skill de revue d'architecture.
- [x] Ajouter un skill de validation GPX.
- [ ] Ajouter un skill de migration Python -> TypeScript si la reecriture est retenue.
- [ ] Ajouter un skill de revue export GPS si les contraintes materiel sont precisees.

## 13. Roadmap recommandee

### Phase 1

- [ ] Finaliser l'audit discovery.
- [ ] Fixer la V1 produit.
- [ ] Fixer les formats de sortie cibles.

### Phase 2

- [ ] Choisir l'architecture cible.
- [ ] Decider la place exacte du VPS.
- [ ] Decider la migration TypeScript ou non.

### Phase 3

- [ ] Monter un prototype vertical minimal sur un vrai GPX.
- [ ] Verifier eau + camping + export simple.
- [ ] Mesurer les limites Overpass.

### Phase 4

- [ ] Iterer sur la qualite metier des POI.
- [ ] Iterer sur l'offline et le GPS.
- [ ] Preparer la mise en ligne publique.
