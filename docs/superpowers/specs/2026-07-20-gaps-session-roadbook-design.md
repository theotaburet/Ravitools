# Déserts de ravito, export/import de session, roadbook imprimable

Date : 2026-07-20 · Statut : approuvé

Trois features indépendantes, livrées dans cet ordre, chacune committée
séparément avec `just check` vert.

## 1. Déserts de ravito

**But** : signaler les segments de trace plus longs que X km sans point d'eau
ou sans nourriture — LA question du bikepacker.

- Nouveau `web/client/src/lib/gaps.ts` : fonction pure
  `findGaps(distancesM: number[], totalDistM: number, thresholdM: number): Gap[]`
  avec `Gap = { startM: number; endM: number }`. Les bords comptent :
  départ → premier POI et dernier POI → arrivée sont des intervalles.
- Deux jauges séparées :
  - **eau** = catégorie `Water` ;
  - **nourriture** = `Food shop` + `Restaurant or Bar`.
- Source des POIs : les POIs attribués à la trace affichée (même attribution
  nearest-trace que les pastilles du profil), **sans appliquer le filtre de
  catégories actif** — décocher « Water » ne doit pas transformer la trace en
  désert. On lit `poisAtom`, pas `filteredPoisAtom`.
- Seuil : réglable, défaut 25 km. Input numérique (km) dans l'en-tête du
  profil, stocké dans un atom jotai non persisté.
- UI dans `ElevationProfile` :
  - bandes verticales semi-transparentes sur le SVG — bleu pour « sans eau »,
    orange pour « sans nourriture » (superposables) ;
  - résumé texte dans l'en-tête, ex. « ⚠ 2 × >25 km sans 💧 · 1 × sans 🛒 »,
    absent si aucun désert ;
  - i18n fr/en pour les libellés.
- Tests unitaires `gaps.test.ts` : trace sans POI (un seul désert plein),
  POI pile au seuil (pas d'alerte), bords, seuil modifié.

## 2. Export/import de session (`.ravitools.json`)

**But** : partager/archiver un plan complet (traces + POIs + enrichissements),
aujourd'hui prisonnier du localStorage.

- Refactor de `lib/session.ts` : extraire `serializeSession(snapshot): string`
  et `parseSession(json: string): SessionSnapshot | null` du couple
  `saveSession`/`loadSession`, qui les réutilisent. Même schéma versionné
  (`SCHEMA_VERSION`), même validation par élément.
- Export : bouton « Sauvegarder le plan » dans `ExportPanel`, actif quand
  `stage === "done"`. Téléchargement Blob nommé `ravitools-plan.json`
  (préfixé du nom de la première trace si dispo). Zéro dépendance.
- Import : la dropzone `GpxUpload` accepte aussi `.json` ; si le parse
  session réussit, restauration identique au « Reprendre » actuel
  (`restoreRoute` + `restoreEnrichments` + préférences). Version de schéma
  différente ou JSON invalide → message d'erreur i18n existant, pas de crash.
- Tests : round-trip serialize → parse, rejet version inconnue, rejet JSON
  corrompu.

## 3. Roadbook imprimable (vue dédiée)

**But** : une feuille de route papier à scotcher sur la potence.

- Composant `Roadbook` chargé en lazy (même patron que `EnrichmentSandbox`),
  ouvert par un bouton « Roadbook » dans `ExportPanel` (actif quand
  `stage === "done"`), rendu en overlay plein écran avec boutons
  Imprimer (`window.print()`) et Fermer.
- Contenu, par trace (saut de page entre traces à l'impression) :
  - en-tête : nom, distance totale, D+/D- ;
  - profil altimétrique SVG réutilisant `buildProfile`/`downsampleProfile` ;
  - tableau des POIs de la trace triés par `alongTraceDistance` :
    km · catégorie (émoji + nom) · nom du POI · horaires (`opening_hours`
    formatés par l'existant `lib/export/hours.ts`).
- Style : `@media print` masque le reste de l'app ; le roadbook s'imprime
  sobre, noir et blanc, sans les aplats néobrutalistes. À l'écran, l'overlay
  garde le style de l'app.
- i18n fr/en des libellés de colonnes.
- Test : rendu du composant avec une trace + POIs (smoke test vitest),
  le rendu papier se vérifie à l'œil.

## Hors périmètre

Seuils séparés eau/nourriture, persistance du seuil, surlignage des déserts
sur la carte, liens de partage serveur, personnalisation du roadbook.
