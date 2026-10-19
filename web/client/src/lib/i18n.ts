// i18n: lightweight translation layer for category labels and generic POI names
// No external dependency; just lookup tables keyed by TargetLanguage.

import type { PoiCategory, TargetLanguage } from "../types";

// Category label translations
// English is the canonical key (PoiCategory type), so "en" returns as-is.

const CATEGORY_LABELS_FR: Record<PoiCategory, string> = {
  Water: "Eau",
  "Sleeping place": "Hébergement",
  Restroom: "Toilettes",
  Shelter: "Abri",
  "Food shop": "Alimentation",
  "Restaurant or Bar": "Restaurant / Bar",
  Gears: "Vélo & Sport",
  DIY: "Réparation vélo",
  Laundry: "Laverie",
  Medical: "Médical",
  Pharmacy: "Pharmacie",
  "Bank & ATM": "Banque & DAB",
  "Post office": "Poste",
  Viewpoint: "Point de vue",
  "Tourist info": "Info tourisme",
  Charging: "Recharge",
  Picnic: "Pique-nique",
  Wifi: "Wifi",
};

const CATEGORY_LABELS: Record<TargetLanguage, Record<PoiCategory, string>> = {
  en: {
    Water: "Water",
    "Sleeping place": "Sleeping place",
    Restroom: "Restroom",
    Shelter: "Shelter",
    "Food shop": "Food shop",
    "Restaurant or Bar": "Restaurant or Bar",
    Gears: "Bike & Sport",
    DIY: "Bike repair",
    Laundry: "Laundry",
    Medical: "Medical",
    Pharmacy: "Pharmacy",
    "Bank & ATM": "Bank & ATM",
    "Post office": "Post office",
    Viewpoint: "Viewpoint",
    "Tourist info": "Tourist info",
    Charging: "Charging",
    Picnic: "Picnic",
    Wifi: "Wifi",
  },
  fr: CATEGORY_LABELS_FR,
};

/**
 * Get the translated label for a POI category.
 * Falls back to the English canonical name if no translation exists.
 */
export function translateCategory(category: PoiCategory, lang: TargetLanguage): string {
  return CATEGORY_LABELS[lang]?.[category] ?? category;
}

// --- UI chrome strings: keyed table, FR + EN. English is the fallback. ---

const UI: Record<string, Record<TargetLanguage, string>> = {
  "session.prompt": {
    en: "You have a saved session. Resume where you left off?",
    fr: "Une session est enregistrée. Reprendre où vous en étiez ?",
  },
  "session.resume": { en: "Resume", fr: "Reprendre" },
  "tabs.label": { en: "Route preparation", fr: "Préparation de l'itinéraire" },
  "tabs.trace": { en: "Trace", fr: "Trace" },
  "tabs.poi": { en: "POI", fr: "POI" },
  "tabs.enrich": { en: "Enrich", fr: "Enrichir" },
  "tabs.export": { en: "Export", fr: "Export" },
  "sheet.low": { en: "Panel lowered: raise it", fr: "Panneau abaissé : le monter" },
  "sheet.mid": {
    en: "Panel half open: open it fully",
    fr: "Panneau à mi-hauteur : l'ouvrir en grand",
  },
  "sheet.full": { en: "Panel open: lower it", fr: "Panneau ouvert : l'abaisser" },
  "sheet.toMid": {
    en: "Lower the panel to see the map",
    fr: "Abaisser le panneau pour voir la carte",
  },
  "settings.title": { en: "Settings", fr: "Réglages" },
  "settings.language": { en: "Language", fr: "Langue" },
  "settings.theme": { en: "Theme", fr: "Thème" },
  "settings.light": { en: "Light", fr: "Clair" },
  "settings.dark": { en: "Dark", fr: "Sombre" },
  "settings.palette": { en: "Colour-blind palette", fr: "Palette pour daltoniens" },
  "settings.debug": { en: "Debug log", fr: "Journal de débogage" },
  "map.fit": { en: "Fit the map to the route", fr: "Recadrer la carte sur l'itinéraire" },
  "summary.gapsWater": { en: "{n} × > {km} km without water", fr: "{n} × > {km} km sans eau" },
  "summary.gapsFood": { en: "{n} × > {km} km without food", fr: "{n} × > {km} km sans ravito" },
  "map.start": { en: "Start", fr: "Départ" },
  "map.finish": { en: "Finish", fr: "Arrivée" },
  "profile.title": { en: "Elevation profile", fr: "Profil altimétrique" },
  "profile.gapThreshold": {
    en: "Ravito gap alert threshold (km)",
    fr: "Seuil d'alerte désert de ravito (km)",
  },
  "profile.centre": {
    en: "Centre the map on a kilometre of the route",
    fr: "Centrer la carte sur un kilomètre du parcours",
  },
  "session.fresh": { en: "Start fresh", fr: "Recommencer" },
  "status.warning": { en: "Warning:", fr: "Attention :" },
  "status.error": { en: "Error:", fr: "Erreur :" },
  "action.retryQuery": { en: "Retry query", fr: "Relancer la requête" },
  "action.startOver": { en: "Start over", fr: "Tout recommencer" },
  "action.tryAgain": { en: "Try again", fr: "Réessayer" },
  "upload.drop": { en: "Load a GPX", fr: "Charger un GPX" },
  "upload.input": { en: "Upload GPX files", fr: "Importer des fichiers GPX" },
  "upload.add": { en: "Add a GPX", fr: "Ajouter un GPX" },
  "upload.browse": {
    en: "Drop or choose one or more .gpx files",
    fr: "Déposez ou choisissez un ou plusieurs fichiers .gpx",
  },
  "filter.all": { en: "All", fr: "Tout" },
  "filter.none": { en: "None", fr: "Aucun" },
  "filter.maxDistance": { en: "Max distance to route", fr: "Distance max. à l'itinéraire" },
  "filter.distanceHint": {
    en: "Narrow for fewer urban POIs, wider for sparse rural routes.",
    fr: "Réduisez pour moins de POI urbains, élargissez pour les routes rurales.",
  },
  "filter.more": {
    en: "Distance {m} m · categories {on}/{all}",
    fr: "Distance {m} m · catégories {on}/{all}",
  },
  "family.Water": { en: "Water", fr: "Eau" },
  "family.Food": { en: "Food", fr: "Alimentation" },
  "family.Sleep": { en: "Sleep", fr: "Hébergement" },
  "family.Mechanics": { en: "Mechanics", fr: "Mécanique" },
  "family.Health": { en: "Health", fr: "Santé" },
  "family.Services": { en: "Services", fr: "Services" },
  "family.Discovery": { en: "Discovery", fr: "Découverte" },
  "poi.alongRoute": { en: "POIs along route", fr: "POI le long de l'itinéraire" },
  "poi.enriched": { en: "Enriched", fr: "Enrichi" },
  "poi.empty": {
    en: "No POIs match the active filters.",
    fr: "Aucun POI ne correspond aux filtres actifs.",
  },
  "poi.backToList": { en: "List", fr: "Liste" },
  "poi.prev": { en: "Previous POI", fr: "POI précédent" },
  "poi.next": { en: "Next POI", fr: "POI suivant" },
  "poi.fromRoute": { en: "from route", fr: "de l'itinéraire" },
  "poi.more": { en: "Hours, sources, details", fr: "Horaires, sources, détails" },
  "poi.searching": { en: "Searching...", fr: "Recherche..." },
  // POI list enrichment details
  "poi.reviews": { en: "reviews", fr: "avis" },
  "poi.closed": { en: "Closed", fr: "Fermé" },
  "poi.season": { en: "Season", fr: "Saison" },
  "poi.prices": { en: "Prices", fr: "Tarifs" },
  "poi.bookingRequired": { en: "Booking required", fr: "Réservation obligatoire" },
  "poi.bookingRecommended": { en: "Booking recommended", fr: "Réservation conseillée" },
  "poi.bookingNotNeeded": { en: "No booking needed", fr: "Sans réservation" },
  "fact.beds": { en: "beds", fr: "lits" },
  "fact.places": { en: "places", fr: "places" },
  "fact.rooms": { en: "rooms", fr: "chambres" },
  "fact.stars": { en: "stars", fr: "étoiles" },
  "fact.winterRoom": { en: "Winter room", fr: "Salle d'hiver" },
  "fact.operator": { en: "Operator", fr: "Gestionnaire" },
  "fact.fee": { en: "Fee", fr: "Payant" },
  "fact.free": { en: "Free", fr: "Gratuit" },
  "fact.wifi": { en: "Wi-Fi", fr: "Wi-Fi" },
  "fact.wheelchair": { en: "Wheelchair access", fr: "Accès fauteuil" },
  "fact.drinkingWater": { en: "Drinking water", fr: "Eau potable" },
  "fact.noDrinkingWater": { en: "No drinking water", fr: "Pas d'eau potable" },
  "poi.sourceWord": { en: "source", fr: "source" },
  "poi.confidence.high": { en: "high", fr: "élevée" },
  "poi.confidence.medium": { en: "medium", fr: "moyenne" },
  "poi.confidence.low": { en: "low", fr: "faible" },
  "poi.confidence.none": { en: "none", fr: "aucune" },
  "poi.confirm.official": { en: "Official site", fr: "Site officiel" },
  "poi.confirm.both": { en: "Official + reviews", fr: "Officiel + avis" },
  "poi.confirm.reviewsOnly": { en: "Reviews only", fr: "Avis uniquement" },
  "poi.skipRetryable": {
    en: " · retryable after cooldown/IP change",
    fr: " · réessayable après pause/changement d'IP",
  },
  "poi.skip.unnamed": { en: "Unnamed POI", fr: "POI sans nom" },
  "poi.skip.generic-name": { en: "Generic name", fr: "Nom générique" },
  "poi.skip.low-value-category": { en: "Low-value category", fr: "Catégorie à faible valeur" },
  "poi.skip.no-results": { en: "No search results found", fr: "Aucun résultat de recherche" },
  "poi.skip.rate-limited": { en: "Rate limited", fr: "Limite de requêtes atteinte" },
  "poi.skip.cancelled": { en: "Cancelled", fr: "Annulé" },
  // Export panel
  "action.loadNew": { en: "Load new GPX files", fr: "Charger de nouveaux fichiers GPX" },
  "export.poisReady": { en: "POIs ready", fr: "POI prêts" },
  "export.enriched": { en: "enriched", fr: "enrichis" },
  "export.format": { en: "Format", fr: "Format" },
  "export.download": { en: "Download {format}", fr: "Télécharger le {format}" },
  "export.fitBody": {
    en: "course with typed points (water, food, camp…): Garmin Up Ahead, Wahoo and Karoo alerts. Copy to Garmin/NewFiles over USB or import in the app; older Edge units stop alerting after 200 points.",
    fr: "parcours avec points typés (eau, nourriture, camping…) : Up Ahead Garmin, alertes Wahoo et Karoo. Copie USB dans Garmin/NewFiles ou import dans l'app ; les anciens Edge n'alertent plus au-delà de 200 points.",
  },
  "export.osmandBody": {
    en: "includes custom icons and colors per category. Other apps import it as standard GPX.",
    fr: "inclut des icônes et couleurs par catégorie. Les autres apps l'importent comme GPX standard.",
  },
  "export.kmzBody": {
    en: "groups POIs by category in folders: best for Organic Maps and Guru Maps.",
    fr: "regroupe les POI par catégorie en dossiers : idéal pour Organic Maps et Guru Maps.",
  },
  "export.enrichedLabel": { en: "Enriched data", fr: "Données enrichies" },
  "export.enrichedBody": {
    en: "(ratings, hours, reviews) is included in export descriptions.",
    fr: "(notes, horaires, avis) sont incluses dans les descriptions d'export.",
  },
  "export.plan": { en: "Plan file", fr: "Fichier de plan" },
  "export.planBody": {
    en: "Reload it later or share it: traces, POIs and enrichments included.",
    fr: "Rechargez-le plus tard ou partagez-le : traces, POI et enrichissements inclus.",
  },
  "upload.plan": {
    en: "…or a .ravitools.json plan to reload",
    fr: "…ou un plan .ravitools.json à recharger",
  },
  "upload.badPlan": {
    en: "Invalid or incompatible plan file (.ravitools.json)",
    fr: "Fichier de plan invalide ou incompatible (.ravitools.json)",
  },
  "roadbook.title": { en: "Roadbook", fr: "Roadbook" },
  "roadbook.body": {
    en: "Printable route sheet: profile + POI table per trace.",
    fr: "Feuille de route imprimable : profil + tableau des POI par trace.",
  },
  "roadbook.print": { en: "Print", fr: "Imprimer" },
  "roadbook.close": { en: "Close", fr: "Fermer" },
  "roadbook.km": { en: "km", fr: "km" },
  "roadbook.category": { en: "Category", fr: "Catégorie" },
  "roadbook.name": { en: "Name", fr: "Nom" },
  "roadbook.hours": { en: "Hours", fr: "Horaires" },
  // Upload extras
  "upload.example": {
    en: "Try an example (Col du Galibier)",
    fr: "Essayer un exemple (col du Galibier)",
  },
  "upload.unsupported": {
    en: "Only .gpx routes and .ravitools.json plans can be loaded.",
    fr: "Seuls les parcours .gpx et les plans .ravitools.json peuvent être chargés.",
  },
  "upload.exampleFailed": {
    en: "The example route could not be loaded.",
    fr: "Le parcours exemple n'a pas pu être chargé.",
  },
  // Export cards
  "export.which": { en: "Which format?", fr: "Quel format ?" },
  "export.fitTarget": {
    en: "Garmin, Wahoo, Karoo: typed alerts",
    fr: "Garmin, Wahoo, Karoo : alertes typées",
  },
  "export.gpxTarget": { en: "COROS and any GPS, standard", fr: "COROS et tout GPS, standard" },
  "export.kmlTarget": { en: "Google Earth", fr: "Google Earth" },
  "export.geojsonTarget": { en: "Web maps, QGIS", fr: "Cartes web, QGIS" },
  "export.osmandTarget": {
    en: "OsmAnd: icons and colors per category",
    fr: "OsmAnd : icônes et couleurs par catégorie",
  },
  "export.kmzTarget": { en: "Organic Maps, Guru Maps", fr: "Organic Maps, Guru Maps" },
  // Elevation strip
  "profile.gapPrefix": { en: "Alert above", fr: "Alerte au-delà de" },
  // Local model capability check
  "llm.title": { en: "Local AI synthesis", fr: "Synthèse IA locale" },
  "llm.more": { en: "See more", fr: "Voir plus" },
  "llm.checking": { en: "checking this machine…", fr: "vérification de la machine…" },
  "llm.ready": { en: "ready", fr: "prête" },
  "llm.limited": { en: "limited", fr: "limitée" },
  "llm.unsupported": { en: "unavailable", fr: "indisponible" },
  "llm.modelNote": {
    en: "downloaded once, then kept in the browser cache",
    fr: "téléchargé une fois, puis gardé en cache par le navigateur",
  },
  "llm.fallback": {
    en: "Search snippets are still collected and summarised without AI.",
    fr: "Les extraits de recherche sont quand même collectés et résumés sans IA.",
  },
  "llm.tryAnyway": {
    en: "Try anyway (the tab may run out of memory)",
    fr: "Essayer quand même (l'onglet peut manquer de mémoire)",
  },
  "llm.reason.no-webgpu": {
    en: "no WebGPU in this browser (Chrome, Edge or Safari 26 have it)",
    fr: "pas de WebGPU dans ce navigateur (Chrome, Edge ou Safari 26 l'ont)",
  },
  "llm.reason.no-adapter": {
    en: "the browser found no usable GPU",
    fr: "le navigateur n'a trouvé aucun GPU utilisable",
  },
  "llm.reason.software-adapter": {
    en: "software rendering only",
    fr: "rendu logiciel uniquement",
  },
  "llm.reason.small-buffers": {
    en: "GPU buffers too small for the model",
    fr: "tampons GPU trop petits pour le modèle",
  },
  "llm.reason.low-memory": { en: "less than 8 GB of memory", fr: "moins de 8 Go de mémoire" },
  "llm.reason.mobile": { en: "mobile device", fr: "appareil mobile" },
  // Enrichment panel
  "enrich.title": { en: "Enrich POIs", fr: "Enrichir les POI" },
  "enrich.subtitle": {
    en: "Add ratings, hours, reviews via web search",
    fr: "Ajoute notes, horaires, avis via recherche web",
  },
  "enrich.searxngUnavailable": {
    en: "Web search is unavailable right now, so enrichment is paused. POIs, map and exports still work.",
    fr: "La recherche web est indisponible pour le moment, l'enrichissement est donc en pause. POI, carte et exports restent utilisables.",
  },
  "enrich.scraperBlocked": {
    en: "Map scraper blocked (CAPTCHA / anti-bot). Some POIs may stay un-enriched: wait a few minutes or change your IP, then retry.",
    fr: "Scraper de cartes bloqué (CAPTCHA / anti-bot). Certains POI peuvent rester non enrichis : attendez quelques minutes ou changez d'IP, puis réessayez.",
  },
  "enrich.sourceLayout": {
    en: "Google Maps changed its page layout: some opening hours could not be read. Check the server logs.",
    fr: "Google Maps a changé la mise en page de ses fiches : certains horaires n'ont pas pu être lus. Voir les logs du serveur.",
  },
  "enrich.googleQueue": { en: "Google queue:", fr: "File Google :" },
  "enrich.queued": { en: "queued", fr: "en file" },
  "enrich.running": { en: "running", fr: "en cours" },
  "enrich.summaryLanguage": { en: "Summary language:", fr: "Langue du résumé :" },
  "enrich.enrichEverything": { en: "Enrich everything (slower)", fr: "Tout enrichir (plus lent)" },
  "enrich.poisTotalHint": {
    en: "POIs total: enrichment targets high-value categories",
    fr: "POI au total : l'enrichissement cible les catégories à forte valeur",
  },
  "enrich.enrichButton": { en: "Enrich", fr: "Enrichir" },
  "enrich.all": { en: "all", fr: "tous les" },
  "enrich.poisWord": { en: "POIs", fr: "POI" },
  "enrich.startSearxngTitle": {
    en: "Web search is unavailable",
    fr: "Recherche web indisponible",
  },
  "enrich.poisEnriched": { en: "POIs enriched", fr: "POI enrichis" },
  "enrich.continue": { en: "Continue enrichment", fr: "Continuer l'enrichissement" },
  "enrich.continueShort": { en: "Continue", fr: "Continuer" },
  "enrich.retryable": { en: "retryable", fr: "réessayables" },
  "enrich.reEnrichAll": { en: "Re-enrich all", fr: "Tout ré-enrichir" },
  "enrich.loadingModel": { en: "Loading AI model...", fr: "Chargement du modèle IA..." },
  "enrich.preparing": { en: "Preparing enrichment...", fr: "Préparation de l'enrichissement..." },
  "enrich.cancel": { en: "Cancel", fr: "Annuler" },
  "enrich.phase.geocode-search": { en: "Searching...", fr: "Recherche..." },
  "enrich.phase.google-fallback": {
    en: "Google fallback queue...",
    fr: "File de secours Google...",
  },
  "enrich.phase.synthesize": { en: "AI synthesis...", fr: "Synthèse IA..." },
  "enrich.phase.retry": { en: "Retrying failed...", fr: "Réessai des échecs..." },
  "enrich.phase.idle": { en: "Enriching...", fr: "Enrichissement..." },
  "enrich.googleWait": {
    en: "Google Maps can take 30-90s per place. Still running: please wait.",
    fr: "Google Maps peut prendre 30-90s par lieu. Toujours en cours : patientez.",
  },
  "enrich.processing": { en: "Processing", fr: "Traitement de" },
  "enrich.current": { en: "Current:", fr: "Actuel :" },
  "enrich.errorWord": { en: "error", fr: "erreur" },
  "enrich.skipped": { en: "skipped", fr: "ignorés" },
  "enrich.eta": { en: "ETA:", fr: "ETA :" },
  "enrich.stop": { en: "Stop", fr: "Arrêter" },
  "enrich.captchaBlocked": {
    en: "All search engines blocked (CAPTCHA / access denied).",
    fr: "Tous les moteurs de recherche sont bloqués (CAPTCHA / accès refusé).",
  },
  "enrich.captchaInstructions": {
    en: "Open SearXNG in a new tab, complete the CAPTCHA, then come back and resume.",
    fr: "Ouvrez SearXNG dans un nouvel onglet, complétez le CAPTCHA, puis revenez et reprenez.",
  },
  "enrich.openSearxng": {
    en: "Open SearXNG: solve CAPTCHA",
    fr: "Ouvrir SearXNG : résoudre le CAPTCHA",
  },
  "enrich.resume": { en: "Resume enrichment", fr: "Reprendre l'enrichissement" },
  "enrich.remaining": { en: "remaining", fr: "restants" },
  "enrich.enginesDegradedSingular": {
    en: "search engine degraded",
    fr: "moteur de recherche dégradé",
  },
  "enrich.enginesDegradedPlural": {
    en: "search engines degraded",
    fr: "moteurs de recherche dégradés",
  },
  "enrich.aiDisclaimer": {
    en: "AI-generated summaries can be wrong: check hours/prices before relying on them.",
    fr: "Les résumés générés par IA peuvent être faux : vérifiez horaires/prix avant de vous y fier.",
  },
  "enrich.error": { en: "Error:", fr: "Erreur :" },
  "caution.noPlatform": {
    en: "No identifiable review or discovery platform found.",
    fr: "Aucune plateforme d'avis ou de découverte identifiée.",
  },
  "caution.weakSource.Restaurant or Bar": {
    en: "Limited online presence; verify hours on arrival.",
    fr: "Peu présent en ligne : vérifiez les horaires sur place.",
  },
  "caution.weakSource.Food shop": {
    en: "Listed on maps but no online reviews; verify hours and stock on-site.",
    fr: "Sur les cartes mais sans avis en ligne : vérifiez horaires et stock sur place.",
  },
  "caution.weakSource.Sleeping place": {
    en: "Limited info online: contact directly to confirm availability and price.",
    fr: "Peu d'informations en ligne : contactez directement pour confirmer disponibilité et prix.",
  },
  "caution.weakSource.Gears": {
    en: "Listed as a bike/sports shop but limited online info: call ahead for repair availability.",
    fr: "Magasin de vélo ou de sport peu présent en ligne : appelez avant pour une réparation.",
  },
  "caution.noRating": {
    en: "No explicit rating found in the collected sources.",
    fr: "Aucune note explicite dans les sources collectées.",
  },
  "caution.noHours": {
    en: "Opening hours were not confirmed from the collected sources.",
    fr: "Horaires non confirmés par les sources collectées.",
  },
  "caution.noReviewCount": {
    en: "Rating found, but review volume was not confirmed.",
    fr: "Note trouvée, mais nombre d'avis non confirmé.",
  },
  "caution.socialOnly": {
    en: "Sources are limited to social profiles or generic directories: reliability uncertain.",
    fr: "Sources limitées aux réseaux sociaux ou à des annuaires génériques : fiabilité incertaine.",
  },
  "divergence.hours": {
    en: "Sources report different opening hours: verify locally.",
    fr: "Les sources donnent des horaires différents : vérifiez sur place.",
  },
  "divergence.rating": {
    en: "Rating varies across sources ({min} to {max}/5).",
    fr: "La note varie selon les sources ({min} à {max}/5).",
  },
  "divergence.closedMixed": {
    en: "Some sources suggest this place may be closed: verify before counting on it.",
    fr: "Certaines sources disent ce lieu peut-être fermé : vérifiez avant de compter dessus.",
  },
  "divergence.closed": {
    en: "Closure signals detected in sources: may be permanently or temporarily closed.",
    fr: "Signes de fermeture dans les sources : peut-être fermé définitivement ou temporairement.",
  },
  "deterministic.description": {
    en: "{name}, {type}, useful stop near the route.",
    fr: "{name}, {type}, arrêt utile près de l'itinéraire.",
  },
  "deterministic.ratingCount": {
    en: "Web reviews: {rating}/5 from {count} reviews.",
    fr: "Avis web : {rating}/5 sur {count} avis.",
  },
  "deterministic.rating": { en: "Web reviews: {rating}/5.", fr: "Avis web : {rating}/5." },
  "deterministic.count": {
    en: "Review volume confirmed: {count}.",
    fr: "Volume d'avis confirmé : {count}.",
  },
  "avail.sunday": { en: "Open Sunday", fr: "Ouvert le dimanche" },
  "avail.evening": { en: "Open evenings", fr: "Ouvert le soir" },
  "google.queueFailed": {
    en: "Google Maps fallback failed to queue for {name}",
    fr: "Impossible de lancer la recherche Google Maps pour {name}",
  },
  "google.timedOut": {
    en: "Google Maps fallback timed out for {name}: moving on",
    fr: "Recherche Google Maps trop longue pour {name} : on passe à la suite",
  },
  "google.failed": {
    en: "Google Maps fallback failed for {name}",
    fr: "La recherche Google Maps a échoué pour {name}",
  },
  "route.reading": { en: "Reading {n} GPX file(s)…", fr: "Lecture de {n} fichier(s) GPX…" },
  "route.parsed": {
    en: "{points} points read, simplified to {simplified} ({km} km)",
    fr: "{points} points lus, simplifiés en {simplified} ({km} km)",
  },
  "route.querying": {
    en: "Querying OpenStreetMap for {n} categories…",
    fr: "Interrogation d'OpenStreetMap pour {n} catégories…",
  },
  "route.chunks": {
    en: "Querying OpenStreetMap… ({done}/{total} chunks)",
    fr: "Interrogation d'OpenStreetMap… ({done}/{total} tronçons)",
  },
  "route.chunksRetry": {
    en: "Querying OpenStreetMap… ({done}/{total} chunks, retry {round})",
    fr: "Interrogation d'OpenStreetMap… ({done}/{total} tronçons, nouvel essai {round})",
  },
  "route.processing": {
    en: "Processing {n} OpenStreetMap elements…",
    fr: "Traitement de {n} éléments OpenStreetMap…",
  },
  "route.found": {
    en: "{n} POIs within {m} m of the route",
    fr: "{n} POI à moins de {m} m de l'itinéraire",
  },
  "route.restored": {
    en: "{n} POIs restored from the previous session",
    fr: "{n} POI repris de la session précédente",
  },
  "route.chunksFailed": {
    en: "{failed}/{total} OpenStreetMap chunks failed: results may be incomplete for parts of the route.",
    fr: "{failed}/{total} tronçons OpenStreetMap en échec : résultats peut-être incomplets sur une partie de l'itinéraire.",
  },
  "route.allChunksFailed": {
    en: "OpenStreetMap did not answer for any part of the route. Retry in a few minutes.",
    fr: "OpenStreetMap n'a répondu pour aucune partie de l'itinéraire. Relancez dans quelques minutes.",
  },
  "enrich.retry": { en: "Retry", fr: "Réessayer" },
};

/** Translate a UI chrome string; falls back to English, then the key itself. `{name}` takes `vars.name`. */
export function t(
  key: string,
  lang: TargetLanguage,
  vars?: Record<string, string | number>,
): string {
  const text = UI[key]?.[lang] ?? UI[key]?.en ?? key;
  return vars ? text.replace(/\{(\w+)\}/g, (m, name: string) => String(vars[name] ?? m)) : text;
}

/** "Label: value", with the French space before the colon. */
export function tLabel(key: string, value: string, lang: TargetLanguage): string {
  return `${t(key, lang)}${lang === "fr" ? " : " : ": "}${value}`;
}

// Generic POI name translations
// These are OSM tag-derived names that appear as POI names when no
// real business name is set. We translate them for display purposes.
// Matching is case-insensitive on the English/source name.

const GENERIC_NAME_FR: Record<string, string> = {
  // Water & sanitation
  "drinking water": "Eau potable",
  "water point": "Point d'eau",
  water: "Eau",
  toilets: "Toilettes",
  toilet: "Toilettes",
  "public toilet": "Toilettes publiques",
  "public toilets": "Toilettes publiques",
  restroom: "Toilettes",
  restrooms: "Toilettes",
  wc: "WC",
  shower: "Douche",
  // Shelter & picnic
  shelter: "Abri",
  picnic: "Pique-nique",
  "picnic site": "Aire de pique-nique",
  "picnic table": "Table de pique-nique",
  "picnic area": "Aire de pique-nique",
  // Generic amenities
  bench: "Banc",
  "waste basket": "Poubelle",
  recycling: "Recyclage",
  parking: "Parking",
  "bicycle parking": "Parking vélo",
  "bicycle repair station": "Station de réparation vélo",
  // Accommodation
  "camp site": "Camping",
  hostel: "Auberge",
  "alpine hut": "Refuge",
  chalet: "Chalet",
  "guest house": "Chambre d'hôtes",
  motel: "Motel",
  hotel: "Hôtel",
  // Food
  supermarket: "Supermarché",
  convenience: "Épicerie",
  bakery: "Boulangerie",
  butcher: "Boucherie",
  restaurant: "Restaurant",
  cafe: "Café",
  "fast food": "Restauration rapide",
  bar: "Bar",
  pub: "Pub",
  // Services
  pharmacy: "Pharmacie",
  hospital: "Hôpital",
  clinic: "Clinique",
  atm: "Distributeur",
  bank: "Banque",
  "post office": "Bureau de poste",
  "post box": "Boîte aux lettres",
  // Tourism
  viewpoint: "Point de vue",
  attraction: "Attraction",
  museum: "Musée",
  castle: "Château",
  monument: "Monument",
  memorial: "Mémorial",
  ruins: "Ruines",
  information: "Information",
  // Charging
  "charging station": "Borne de recharge",
  "device charging station": "Station de recharge",
  // Other
  library: "Bibliothèque",
  "internet cafe": "Cybercafé",
  laundry: "Laverie",
};

const GENERIC_NAMES: Record<TargetLanguage, Record<string, string>> = {
  en: {}, // English names stay as-is
  fr: GENERIC_NAME_FR,
};

/**
 * Translate a generic OSM-derived POI name if a translation exists.
 * Returns the original name if no translation is found (i.e. it's a real business name).
 */
export function translatePoiName(name: string, lang: TargetLanguage): string {
  if (!name || lang === "en") return name;
  const lookup = GENERIC_NAMES[lang];
  if (!lookup) return name;
  const translated = lookup[name.toLowerCase().trim()];
  return translated ?? name;
}
