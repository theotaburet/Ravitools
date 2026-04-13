# Task: Enrichment graal
# Started: 2026-04-13
# Status: in-progress

## Goal
Atteindre un enrichissement POI tres fiable, tres utile en voyage a velo, stable en production, facile a evaluer, et suffisamment durci pour limiter au maximum les iterations futures.

## Success Criteria
- [ ] Les POI essentiels ont une sortie dense, stable, actionnable, sans blabla marketing.
- [ ] Les commerces generaux ont une synthese courte mais tres complete, agregeant clairement les plateformes pertinentes.
- [ ] Les hotels et sleeping places exploitent correctement Booking / Hotels.com / site officiel quand disponibles.
- [ ] La structure enrichie est assez solide pour l'UI, l'export, la sandbox, et l'evaluation automatique.
- [ ] Le systeme degrade proprement sans LLM, sans site officiel, ou avec peu de sources.
- [ ] Les regressions de qualite sont detectables par tests et corpus d'evaluation.

## Workstreams

### 1. Product Definition
- [ ] Definir la version finale du contrat produit pour chaque categorie enrichissable.
- [ ] Fixer le niveau de detail cible pour `Restaurant or Bar`.
- [ ] Fixer le niveau de detail cible pour `Food shop`.
- [ ] Fixer le niveau de detail cible pour `Sleeping place`.
- [ ] Fixer le niveau de detail cible pour `Gears`.
- [ ] Definir explicitement ce qui n'est PAS attendu pour les categories `minimal` et `skip`.
- [ ] Definir la longueur cible du texte principal pour mobile, popup carte, liste, export.
- [ ] Definir l'ordre canonical des informations affichees.
- [ ] Definir les cas ou il faut preferer le silence a une synthese faible.

### 2. Canonical Output Schema
- [ ] Geler la structure canonique finale de `structured`.
- [ ] Determiner si `essentials` reste un champ derive ou un champ explicitement maintenu.
- [ ] Ajouter, si necessaire, un champ `lastVerifiedAt` pour les infos site officiel.
- [ ] Ajouter, si necessaire, un champ `sourceCoverageScore` distinct du `confidence` global.
- [ ] Ajouter, si necessaire, un champ `recommendationFit` oriente cyclotourisme.
- [ ] Distinguer proprement `facts`, `signals`, `cautions`, `unknowns`.
- [ ] Distinguer les infos confirmees par site officiel vs plateformes d'avis.
- [ ] Definir une representation stricte des divergences de sources.
- [ ] Definir une representation stricte des absences d'information importantes.

### 3. Category-Specific Editorial Rules
- [ ] Ecrire les regles editoriales finales pour `Restaurant or Bar`.
Regles visees: type de cuisine, qualite percue, praticite route, horaires, prix, caveat principal.
- [ ] Ecrire les regles editoriales finales pour `Food shop`.
Regles visees: ravitaillement reel, plage horaire, taille/perimetre de l'offre, fiabilite, caveat principal.
- [ ] Ecrire les regles editoriales finales pour `Sleeping place`.
Regles visees: type d'hebergement, signaux de reservation, praticite cycliste, infos sommeil/check-in, caveat principal.
- [ ] Ecrire les regles editoriales finales pour `Gears`.
Regles visees: atelier vs vente, pertinence velo, services, fiabilite, caveat principal.
- [ ] Definir les formulations bannies.
- [ ] Definir les formulations preferees pour les cas de sources faibles.
- [ ] Definir les formulations preferees pour les cas de contradiction.

### 4. Source Strategy And Ranking
- [ ] Definir la priorite exacte entre Google Maps, Yelp, Tripadvisor, Facebook, Instagram, Booking, Hotels.com, site officiel.
- [ ] Definir ce que chaque plateforme est censee apporter et ce qu'elle ne doit pas surpondere.
- [ ] Distinguer signaux de reputation vs signaux operationnels.
- [ ] Definir quand ignorer une plateforme meme si elle apparait dans la recherche.
- [ ] Definir les heuristiques de rejet des faux positifs de plateforme.
- [ ] Distinguer page officielle, annuaire, mirror, agregateur, profile social, marketplace.
- [ ] Prioriser site officiel pour les faits recents quand disponible.
- [ ] Definir la place exacte d'Instagram et Facebook dans la synthese finale.
- [ ] Definir le role exact de Booking et Hotels.com sur les sleeping places.

### 5. Official Website Handling
- [ ] Durcir la detection de site officiel depuis OSM tags.
- [ ] Ajouter une heuristique pour reconnaitre un domaine officiel parmi les snippets.
- [ ] Mieux extraire titre, description, texte utile, CTA, booking link, contact, horaires.
- [ ] Filtrer les pages non pertinentes du site officiel.
- [ ] Mieux gerer les redirects et domaines canoniques.
- [ ] Definir la politique en cas de site officiel inaccessible ou vide.
- [ ] Definir si les sites officiels multilingues doivent influencer la langue cible.
- [ ] Ajouter un garde-fou contre les homepages trop marketing et pauvres en facts.

### 6. Search Query Quality
- [ ] Revoir les requetes par categorie pour maximiser les sources utiles et minimiser le bruit.
- [ ] Ajuster les biais de requete pour les hotels.
- [ ] Ajuster les biais de requete pour les food shops.
- [ ] Ajuster les biais de requete pour les bike shops / gears.
- [ ] Ajouter des heuristiques de requete selon pays/langue si necessaire.
- [ ] Definir un plan de retry sur requetes alternatives quand la recherche est pauvre.
- [ ] Evaluer si le nom du POI doit etre nettoye ou simplifie avant requete.

### 7. Source Matching And Dedup
- [ ] Durcir le matching entre POI OSM et resultats web.
- [ ] Rejeter les resultats hors localite / hors coherence geographique.
- [ ] Rejeter les resultats qui semblent etre une autre enseigne homonyme.
- [ ] Deduper les URLs miroir / tracking / mobile / locale.
- [ ] Deduper les variantes d'une meme plateforme.
- [ ] Distinguer les snippets repetes vs signaux independants.
- [ ] Noter les collisions de nom frequentes et les traiter proprement.

### 8. LLM Prompt Hardening
- [ ] Geler un prompt system final, tres prescriptif, par schema et par categorie.
- [ ] Reduire encore les sorties vagues et generiques.
- [ ] Interdire explicitement les phrases marketing et les extrapolations.
- [ ] Durcir la production des `sourceDigests`.
- [ ] Durcir la production du caveat final.
- [ ] Durcir la gestion des contradictions.
- [ ] Ajouter des exemples few-shot si necessaire.
- [ ] Determiner si des prompts differents par categorie valent le cout.

### 9. Deterministic Fallback Quality
- [ ] Ameliorer la qualite du mode sans LLM.
- [ ] Produire une sortie tres utile meme sans `translatedSummary`.
- [ ] Renforcer la construction de `sourceRollup`.
- [ ] Renforcer la construction des `cautions`.
- [ ] Renforcer la construction des `practicalities`.
- [ ] S'assurer que le fallback reste preferable a une mauvaise synthese LLM.

### 10. Confidence And Coverage Model
- [ ] Revoir la formule de `confidence` pour mieux representer la fiabilite percue.
- [ ] Distinguer qualite des sources, diversite, recence, site officiel, coherence.
- [ ] Ajouter une notion explicite de `coverage` des dimensions importantes.
- [ ] Penaliser les cas de snippets repetitifs ou trop faibles.
- [ ] Penaliser les cas de contradiction non resolue.
- [ ] Bonusser les cas avec site officiel utile + plateformes concordantes.
- [ ] Rendre les seuils interpretable en UI et export.

### 11. Contradiction Handling
- [ ] Definir la taxonomie des contradictions importantes.
- [ ] Horaires contradictoires.
- [ ] Fermeture / ouverture contradictoire.
- [ ] Type de lieu contradictoire.
- [ ] Niveau de qualite contradictoire.
- [ ] Presence ou absence de service utile contradictoire.
- [ ] Definir comment condenser une contradiction sans noyer l'utilisateur.
- [ ] Definir quand une contradiction doit faire baisser fortement la confiance.

### 12. UI Integration
- [ ] Verifier que la liste POI affiche seulement l'information la plus utile.
- [ ] Verifier que la popup carte reste tres concise.
- [ ] Verifier que les labels `sourceRollup` sont lisibles sur mobile.
- [ ] Verifier que les caveats ressortent assez.
- [ ] Verifier que les sleeping places ont un rendu adapte a leur usage.
- [ ] Verifier qu'un commerce pauvre en infos reste lisible et non trompeur.
- [ ] Definir si les `sourceDigests` doivent etre collapses par defaut.

### 13. Export Quality
- [ ] Verifier que le GPX exporte la bonne densite d'information sans devenir illisible.
- [ ] Verifier que le KML reste propre dans Google Earth et outils compatibles.
- [ ] Verifier que le GeoJSON expose toutes les infos utiles sans duplication excessive.
- [ ] Determiner si `structured` doit etre exporte en sous-objet JSON plutot qu'a plat.
- [ ] Verifier les limites de longueur pour les appareils GPS et viewers.
- [ ] Verifier la lisibilite sur OsmAnd.

### 14. Sandbox And Evaluation Tooling
- [ ] Transformer la sandbox en vrai outil d'evaluation de qualite.
- [ ] Permettre de tester plusieurs POI reels rapidement.
- [ ] Permettre de comparer brut, site officiel, structured, essentials.
- [ ] Permettre de figer des cas de reference.
- [ ] Permettre de visualiser les sources retenues vs rejetees.
- [ ] Ajouter un mode comparaison avant/apres prompt ou heuristique.

### 15. Evaluation Corpus
- [ ] Constituer un petit corpus d'etablissements reels representatifs.
- [ ] Inclure restaurants urbains, restos ruraux, boulangeries, supérettes, campings, hotels, bike shops.
- [ ] Inclure cas faciles, moyens, ambigus, tres bruyants.
- [ ] Inclure plusieurs pays / langues si pertinents pour le produit.
- [ ] Definir le gold standard attendu pour chaque cas.
- [ ] Stocker les sorties attendues ou au moins leurs criteres de qualite.

### 16. Automated Tests
- [ ] Ajouter des tests unitaires sur `buildStructuredContent`.
- [ ] Ajouter des tests unitaires sur la priorisation des plateformes.
- [ ] Ajouter des tests unitaires sur les `cautions`.
- [ ] Ajouter des tests unitaires sur les sleeping places avec Booking / Hotels.com.
- [ ] Ajouter des tests unitaires sur les websites previews.
- [ ] Ajouter des tests unitaires sur les contradictions.
- [ ] Ajouter des tests d'integration sur export + structured.
- [ ] Ajouter des tests de non-regression sur quelques POI de reference.

## Feature Validation Matrix

### A. Source Discovery
- [ ] Test: `buildSearchQuery` pour `Restaurant or Bar` inclut bien les plateformes review attendues.
- [ ] Test: `buildSearchQuery` pour `Food shop` favorise bien la logique de ravitaillement.
- [ ] Test: `buildSearchQuery` pour `Sleeping place` inclut bien Booking / Hotels.com.
- [ ] Test: `buildSearchQuery` pour `Gears` favorise bien atelier / bike shop / repair.
- [ ] Test: fallback propre si le POI n'a pas de vrai nom exploitable.
- [ ] Test: requetes alternatives ou retry strategy si les resultats initiaux sont trop pauvres.

### B. Source Parsing And Classification
- [ ] Test: `classifySourcePlatform` reconnait Google Maps.
- [ ] Test: `classifySourcePlatform` reconnait Yelp.
- [ ] Test: `classifySourcePlatform` reconnait Tripadvisor.
- [ ] Test: `classifySourcePlatform` reconnait Facebook.
- [ ] Test: `classifySourcePlatform` reconnait Instagram.
- [ ] Test: `classifySourcePlatform` reconnait Booking.
- [ ] Test: `classifySourcePlatform` reconnait Hotels.com.
- [ ] Test: `classifySourcePlatform` range les autres domaines dans `other`.
- [ ] Test: dedup correcte des URLs proches/mirroirs/trackees.
- [ ] Test: rejection des resultats manifestement hors sujet ou homonymes.

### C. Official Website
- [ ] Test: `getOfficialWebsiteUrl` detecte `website`.
- [ ] Test: `getOfficialWebsiteUrl` detecte `contact:website`.
- [ ] Test: `getOfficialWebsiteUrl` normalise un domaine sans schema.
- [ ] Test: `fetchWebsitePreview` retourne `title`, `description`, `excerpt`, `finalUrl`.
- [ ] Test: `fetchWebsitePreview` degrade proprement sur timeout.
- [ ] Test: `fetchWebsitePreview` degrade proprement sur contenu non HTML.
- [ ] Test: le site officiel enrichit bien `sourceRollup` quand il apporte de l'info.
- [ ] Test: le site officiel n'ecrase pas abusivement des sources reviews plus utiles.

### D. Structured Output Core
- [ ] Test: `buildStructuredContent` produit un `headline` pour un cas riche.
- [ ] Test: `buildStructuredContent` produit un `operationalSummary` pour un cas riche.
- [ ] Test: `buildStructuredContent` produit des `practicalities` ordonnees et utiles.
- [ ] Test: `buildStructuredContent` produit des `cautions` quand les infos manquent.
- [ ] Test: `buildStructuredContent` produit un `sourceRollup` stable et lisible.
- [ ] Test: `buildEssentialsText` compose correctement depuis `structured`.
- [ ] Test: `buildEssentialsText` reste concise et stable.

### E. Category-Specific Structured Rules
- [ ] Test: `Restaurant or Bar` met en avant type, reputation, praticite, caveat.
- [ ] Test: `Food shop` met en avant ravitaillement, horaires, utilite concrete.
- [ ] Test: `Sleeping place` met en avant hebergement, booking signal, sommeil/check-in.
- [ ] Test: `Gears` met en avant atelier/vente/services et pertinence velo.
- [ ] Test: chaque categorie `full` degrade proprement quand les sources sont faibles.

### F. LLM Output Contract
- [ ] Test: `parseLlmOutput` accepte une sortie JSON valide complete.
- [ ] Test: `parseLlmOutput` nettoie un bloc markdown autour du JSON.
- [ ] Test: `parseLlmOutput` rejette une sortie invalide ou trop libre.
- [ ] Test: `parseLlmOutput` borne bien `rating` et `priceLevel`.
- [ ] Test: `parseLlmOutput` borne bien `sourceDigests`.
- [ ] Test: le pipeline retombe sur le fallback si le LLM ne renvoie pas une structure exploitable.

### G. Confidence And Coverage
- [ ] Test: `computeConfidence` monte avec plus de sources utiles.
- [ ] Test: `computeConfidence` monte avec une meilleure diversite de moteurs/sources.
- [ ] Test: `computeConfidence` baisse quand il n'y a pas de facts structurels.
- [ ] Test: `computeConfidence` reste a zero sans snippets.
- [ ] Test: ajout futur d'un score `coverage` si introduit.

### H. Contradictions And Missing Data
- [ ] Test: contradiction horaires -> caveat present.
- [ ] Test: contradiction qualite/reputation -> caveat present.
- [ ] Test: manque d'horaires -> caution explicite.
- [ ] Test: manque de note -> caution explicite.
- [ ] Test: manque de site officiel -> pas de faux signal positif.

### I. Pipeline Integration
- [ ] Test: `enrichPoi` enrichit correctement un POI `full` avec search + site + LLM.
- [ ] Test: `enrichPoi` enrichit correctement un POI `full` avec search + site sans LLM.
- [ ] Test: `enrichPoi` degrade proprement avec zero resultat.
- [ ] Test: `enrichPoi` degrade proprement sur erreur search.
- [ ] Test: `enrichPoi` degrade proprement sur erreur website fetch.
- [ ] Test: `enrichPoi` respecte la policy `minimal`.
- [ ] Test: `enrichPoi` respecte la policy `skip`.
- [ ] Test: `enrichBatch` melange correctement `full`, `minimal`, `skip`.
- [ ] Test: `enrichBatch` conserve une structure canonique sur tous les POI `done`.

### J. UI Rendering
- [ ] Test: la liste POI prefere `essentials` / `structured` aux vieux champs libres.
- [ ] Test: la popup carte prefere `essentials` / `structured`.
- [ ] Test: les `cautions` remontent correctement dans la sandbox.
- [ ] Test: la sandbox n'apparait pas sans `?sandbox`.
- [ ] Test: la sandbox apparait avec `?sandbox`.

### K. Export Validation
- [ ] Test: GPX inclut `structured.headline` quand disponible.
- [ ] Test: GPX inclut `structured.operationalSummary` quand disponible.
- [ ] Test: GPX inclut `structured.practicalities` quand disponibles.
- [ ] Test: GPX inclut `structured.cautions` quand disponibles.
- [ ] Test: GPX inclut `sourceRollup` quand disponible.
- [ ] Test: KML inclut les memes briques structurees.
- [ ] Test: GeoJSON expose `enrichment_essentials`.
- [ ] Test: GeoJSON expose `enrichment_structured_headline`.
- [ ] Test: GeoJSON expose `enrichment_structured_operationalSummary`.
- [ ] Test: GeoJSON expose `enrichment_structured_practicalities`.
- [ ] Test: GeoJSON expose `enrichment_structured_cautions`.
- [ ] Test: GeoJSON expose `enrichment_structured_sourceRollup`.

### L. Non-Regression Reference Cases
- [ ] Test snapshot/reference: restaurant urbain riche en sources.
- [ ] Test snapshot/reference: boulangerie ou food shop de ravito.
- [ ] Test snapshot/reference: camping ou hotel avec Booking.
- [ ] Test snapshot/reference: bike shop / repair shop.
- [ ] Test snapshot/reference: cas pauvre sans site officiel.
- [ ] Test snapshot/reference: cas contradictoire.
- [ ] Test snapshot/reference: cas homonyme / bruit de recherche.

### M. Server Proxy Validation
- [ ] Test: `/search` garde les headers et erreurs attendues.
- [ ] Test: `/geocode` garde les garde-fous et le cache attendus.
- [ ] Test: `/fetch-page` parse une page HTML simple.
- [ ] Test: `/fetch-page` rejette les contenus non HTML.
- [ ] Test: `/fetch-page` gere timeout et erreurs reseau.

### N. Perf And Stability Checks
- [ ] Test: batch de POI `full` ne casse pas la structure finale sous charge moderee.
- [ ] Test: cancellation pendant enrichment ne laisse pas d'etat incoherent.
- [ ] Test: absence de WebGPU garde un comportement utile et stable.
- [ ] Test: absence de site officiel garde un comportement utile et stable.
- [ ] Test: snippets dupliques ou pauvres ne produisent pas de sortie trompeuse.

### 17. Performance And Resource Use
- [ ] Mesurer le cout reel de l'enrichissement complet sur un parcours long.
- [ ] Mesurer l'impact du fetch de site officiel.
- [ ] Mesurer le taux de pages inutiles fetchées.
- [ ] Mesurer le temps moyen full pipeline par POI full.
- [ ] Determiner si certains appels doivent etre memoizes ou caches plus fortement.
- [ ] Determiner si le WebLLM doit etre reserve a certains cas seulement.

### 18. Caching And Freshness
- [ ] Clarifier la politique de cache pour recherche, geocode, site officiel.
- [ ] Definir la notion de fraicheur des facts web.
- [ ] Definir si le site officiel doit avoir un TTL plus court.
- [ ] Definir si certaines categories meritent une recence plus agressive.
- [ ] Exposer assez d'infos pour comprendre quand l'enrichissement date.

### 19. Privacy And Safety
- [ ] Verifier que le fetch de site officiel n'introduit pas de fuite ou comportement inattendu.
- [ ] Verifier les garde-fous sur types de contenu et taille de page.
- [ ] Verifier les redirects et domaines suspects.
- [ ] Verifier qu'aucune execution de script n'est possible cote client via contenu web.
- [ ] Revoir les liens externes exposes dans UI/export.

### 20. Observability And Debugging
- [ ] Ajouter les logs minimaux pour comprendre pourquoi une synthese est faible.
- [ ] Logger la plateforme retenue pour chaque digest.
- [ ] Logger les cas de contradiction.
- [ ] Logger les cas ou le site officiel a ameliore ou n'a rien apporte.
- [ ] Ajouter des compteurs simples de qualite en mode debug.

### 21. Documentation
- [ ] Documenter le contrat final de l'enrichissement.
- [ ] Documenter les politiques par categorie.
- [ ] Documenter les limites assumees.
- [ ] Documenter le fonctionnement de la sandbox `?sandbox`.
- [ ] Documenter la strategie de fallback sans LLM.
- [ ] Documenter la lecture correcte du `confidence`.

### 22. Release Readiness
- [ ] Passer un check manuel sur un vrai GPX avec POI varies.
- [ ] Verifier au moins un cas reussi par categorie `full`.
- [ ] Verifier au moins un cas degradé propre par categorie `full`.
- [ ] Verifier un cas avec site officiel utile.
- [ ] Verifier un cas sans site officiel.
- [ ] Verifier un cas avec sources contradictoires.
- [ ] Verifier un cas de sleeping place avec Booking / Hotels.com.
- [ ] Verifier un cas de food shop tres utile au ravito.
- [ ] Verifier un cas de bike shop / gears.

## Milestones
- [ ] M1: Contrat de sortie final fige
- [ ] M2: Regles editoriales par categorie figees
- [ ] M3: Strategie sources + site officiel figee
- [ ] M4: Corpus d'evaluation + tests de non-regression en place
- [ ] M5: Validation manuelle sur vrais GPX
- [ ] M6: Enrichissement considere "graal-ready"

## Decisions
- Le "graal" n'est pas seulement un meilleur prompt: c'est un contrat produit stable, un systeme d'evaluation, un fallback robuste, et une strategie source explicite.
- La qualite finale doit reposer sur un mix heuristiques + structure canonique + LLM, pas sur le LLM seul.
- Les sleeping places doivent etre traitees comme un vertical a part, avec des attentes specifiques de reservation et de fiabilite.

## Blockers
- Aucun pour l'instant. Le principal risque est l'absence d'un corpus d'evaluation reel assez representatif.
