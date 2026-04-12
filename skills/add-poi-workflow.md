# Skill: Add POI Workflow

## Quand utiliser ce skill

Utiliser ce workflow quand il faut ajouter ou ajuster une categorie de POI OSM.

## Procedure

1. Verifier si le besoin peut etre couvert en ajoutant des tags a une categorie existante dans `web/client/src/lib/poi-config.ts`.
2. Identifier les tags OSM les plus pertinents pour l'usage velo.
3. Evaluer le risque de bruit ou de faux positifs.
4. Modifier `poi-config.ts`: ajouter la categorie a `POI_CATEGORIES`, les mappings OsmAnd, et le type a `PoiCategory` dans `types/index.ts`.
5. Verifier que le mapping produit encore des POI valides.
6. Documenter le choix du tag et ses limites.
7. Lancer `npx tsc --noEmit && npm test` pour valider.
