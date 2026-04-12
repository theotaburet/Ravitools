# Architecture Risks

## Risques majeurs

## 1. Overpass devient le vrai goulot d'etranglement

Description:

La meilleure UI ne sert a rien si les requetes Overpass sont lentes, rate-limitees ou trop grosses.

Impact:

- experience publique fragile,
- temps d'attente eleves,
- resultats incomplets.

Mitigation:

- proxy VPS,
- cache mutualise,
- reduction agressive du nombre de points de requete,
- requetes plus ciblees par categorie,
- fallback clair cote UI.

## 2. Le viewer web prend le dessus sur l'usage GPS

Description:

Le projet peut facilement glisser vers une jolie carte web sans livrer un export vraiment utile hors ligne.

Impact:

- produit moins utile pour l'usage reel initial,
- dette fonctionnelle sur l'export.

Mitigation:

- garder un corpus de validation GPS,
- maintenir l'export offline comme critere d'acceptation,
- tester les limitations de format des GPS cibles des le debut.

## 3. La proximity metier reste trop naive

Description:

Un simple rayon autour de points du GPX peut produire beaucoup de bruit ou manquer des POI vraiment utiles selon la forme de la trace.

Impact:

- faux positifs,
- baisse de confiance utilisateur,
- POI utiles masques dans le bruit.

Mitigation:

- introduire un vrai couloir autour de la trace,
- deduplication,
- tri par distance a la trace,
- tests sur plusieurs types de trajets.

## 4. Reecriture TypeScript trop large trop vite

Description:

Une migration totale immediate risque de melanger objectifs produit, refonte UX et reimplementation geospatiale en un seul lot.

Impact:

- lenteur,
- regressions,
- impossibilite de savoir ce qui casse vraiment.

Mitigation:

- commencer par un prototype vertical minimal,
- utiliser le Python comme reference,
- migrer par capacites et non par fichiers.

## 5. Export KMZ cote navigateur plus difficile que prevu

Description:

Le rendu et la compression d'icones ou de styles peuvent etre moins simples en TypeScript qu'en Python actuel.

Impact:

- V1 incomplete,
- detour serveur necessaire.

Mitigation:

- accepter un export intermediaire dans un premier temps,
- garder une possibilite serveur pour l'export lourd,
- traiter le KMZ complet comme une tranche dediee si necessaire.

## 6. Dette technique du prototype Python actuel

Description:

Le depot contient deja des signes de prototype: duplications, incoherences de config, point d'entree ambigu, absence de tests.

Impact:

- comprehension plus lente,
- comportements difficiles a reproduire,
- risque de prendre le prototype pour une base de prod.

Mitigation:

- corriger seulement les points bloquants,
- documenter clairement les ecarts,
- ne pas surinvestir dans une architecture Python vouee a etre reference et non destination finale.

## Compromis assumes

- Le code frontend sera visible: accepte.
- Le navigateur fera une partie importante du travail: voulu.
- Le VPS n'est pas un moteur central, mais un filet de securite technique: voulu.
- La qualite produit dependra davantage des heuristiques POI et de la strategy Overpass que du choix du framework frontend: assume.
