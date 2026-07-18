# Spec — Profil altimétrique (validé 2026-07-18)

Bandeau repliable sous la carte, SVG maison (zéro dépendance), une trace à la fois.

- **Placement** : strip horizontal dans `.map-container` (devient colonne carte + profil). En-tête toujours visible : nom trace, D+/D−, bouton replier. Corps ~160 px desktop / 120 px mobile. Masqué si pas de trace ou pas de données `ele`.
- **Rendu** : courbe downsamplée (~300 pts), aplat lime sous la courbe, cadre noir 3 px, min/max altitude en mono.
- **Données** : `lib/elevation.ts` (fonctions pures) — distances cumulées via `haversine` du gpx-parser, downsampling, interpolation altitude/position à une distance donnée.
- **POIs** : pastilles émoji à `x = alongTraceDistance`, `y` interpolé ; vrais boutons → `selectedPoiIdAtom` (flyTo + popup existants). Multi-traces : attribution POI→trace la plus proche via `TraceIndex`.
- **Sync carte** : survol profil → `profileHoverAtom` ({lat, lon} | null) dans `state/ui.ts` → marqueur de position sur RouteMap.
- **Multi-traces** : chips couleur dans l'en-tête, première trace par défaut.
- **Tests** : unitaires `lib/elevation.ts` + i18n fr/en, `just check` vert.
