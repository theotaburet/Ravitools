// ---------------------------------------------------------------------------
// i18n – lightweight translation layer for category labels and generic POI names
// No external dependency; just lookup tables keyed by TargetLanguage.
// ---------------------------------------------------------------------------

import type { PoiCategory, TargetLanguage } from "../types";

// ---------------------------------------------------------------------------
// Category label translations
// English is the canonical key (PoiCategory type), so "en" returns as-is.
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// UI chrome strings (AUDIT U2) — keyed table, FR + EN. English is the fallback.
// ---------------------------------------------------------------------------

const UI: Record<string, Record<TargetLanguage, string>> = {
  "app.subtitle": { en: "Find useful POIs along your cycling route", fr: "Trouvez les POI utiles le long de votre itinéraire vélo" },
  "session.prompt": { en: "You have a saved session. Resume where you left off?", fr: "Une session est enregistrée. Reprendre où vous en étiez ?" },
  "session.resume": { en: "Resume", fr: "Reprendre" },
  "session.fresh": { en: "Start fresh", fr: "Recommencer" },
  "status.warning": { en: "Warning:", fr: "Attention :" },
  "status.error": { en: "Error:", fr: "Erreur :" },
  "action.retryChunks": { en: "Retry failed chunks", fr: "Réessayer les blocs échoués" },
  "action.retryQuery": { en: "Retry query", fr: "Relancer la requête" },
  "action.startOver": { en: "Start over", fr: "Tout recommencer" },
  "action.tryAgain": { en: "Try again", fr: "Réessayer" },
  "upload.drop": { en: "Drop your .GPX files here", fr: "Déposez vos fichiers .GPX ici" },
  "upload.browse": { en: "or click to browse (multiple files OK)", fr: "ou cliquez pour parcourir (plusieurs fichiers possibles)" },
  "filter.titleFilter": { en: "Filter POIs", fr: "Filtrer les POI" },
  "filter.titleSearch": { en: "Categories to search", fr: "Catégories à rechercher" },
  "filter.all": { en: "All", fr: "Tout" },
  "filter.none": { en: "None", fr: "Aucun" },
  "filter.maxDistance": { en: "Max distance to route", fr: "Distance max. à l'itinéraire" },
  "filter.distanceHint": { en: "Narrow for fewer urban POIs, wider for sparse rural routes.", fr: "Réduisez pour moins de POI urbains, élargissez pour les routes rurales." },
  "filter.essential": { en: "Essential", fr: "Essentiels" },
  "filter.optional": { en: "Optional", fr: "Optionnels" },
  "poi.alongRoute": { en: "POIs along route", fr: "POI le long de l'itinéraire" },
  "poi.changeSort": { en: "Change sort order", fr: "Changer le tri" },
  "poi.sort.distance": { en: "Distance to route", fr: "Distance à l'itinéraire" },
  "poi.sort.category": { en: "Category", fr: "Catégorie" },
  "poi.sort.name": { en: "Name (A-Z)", fr: "Nom (A-Z)" },
  "poi.empty": { en: "No POIs match the active filters.", fr: "Aucun POI ne correspond aux filtres actifs." },
  "poi.searching": { en: "Searching...", fr: "Recherche..." },
  // POI list enrichment details
  "poi.reviews": { en: "reviews", fr: "avis" },
  "poi.closed": { en: "Closed", fr: "Fermé" },
  "poi.sourceWord": { en: "source", fr: "source" },
  "poi.skipRetryable": { en: " · retryable after cooldown/IP change", fr: " · réessayable après pause/changement d'IP" },
  "poi.skip.unnamed": { en: "Unnamed POI", fr: "POI sans nom" },
  "poi.skip.generic-name": { en: "Generic name", fr: "Nom générique" },
  "poi.skip.low-value-category": { en: "Low-value category", fr: "Catégorie à faible valeur" },
  "poi.skip.no-results": { en: "No search results found", fr: "Aucun résultat de recherche" },
  "poi.skip.rate-limited": { en: "Rate limited", fr: "Limite de requêtes atteinte" },
  "poi.skip.cancelled": { en: "Cancelled", fr: "Annulé" },
  // Export panel
  "action.loadNew": { en: "Load new GPX files", fr: "Charger de nouveaux fichiers GPX" },
  "export.gps": { en: "Export for GPS", fr: "Export GPS" },
  "export.poisReady": { en: "POIs ready", fr: "POI prêts" },
  "export.enriched": { en: "enriched", fr: "enrichis" },
  "export.smartphone": { en: "Export for Smartphone", fr: "Export smartphone" },
  "export.offlineApps": { en: "Offline maps apps (OsmAnd, Organic Maps, Guru Maps)", fr: "Apps de cartes hors-ligne (OsmAnd, Organic Maps, Guru Maps)" },
  "export.osmandBody": { en: "includes custom icons and colors per category. Other apps import it as standard GPX.", fr: "inclut des icônes et couleurs par catégorie. Les autres apps l'importent comme GPX standard." },
  "export.kmzBody": { en: "groups POIs by category in folders — best for Organic Maps and Guru Maps.", fr: "regroupe les POI par catégorie en dossiers — idéal pour Organic Maps et Guru Maps." },
  "export.enrichedLabel": { en: "Enriched data", fr: "Données enrichies" },
  "export.enrichedBody": { en: "(ratings, hours, reviews) is included in export descriptions.", fr: "(notes, horaires, avis) sont incluses dans les descriptions d'export." },
  // Enrichment panel
  "enrich.title": { en: "Enrich POIs", fr: "Enrichir les POI" },
  "enrich.subtitle": { en: "Add ratings, hours, reviews via web search", fr: "Ajoute notes, horaires, avis via recherche web" },
  "enrich.aiSynthesis": { en: " + AI synthesis", fr: " + synthèse IA" },
  "enrich.noWebgpu": { en: "No WebGPU — raw search snippets only (no AI synthesis). Use Chrome/Edge for full experience.", fr: "Pas de WebGPU — extraits de recherche bruts uniquement (pas de synthèse IA). Utilisez Chrome/Edge pour l'expérience complète." },
  "enrich.searxngUnavailable": { en: "SearXNG unavailable — search enrichment disabled. Start SearXNG:", fr: "SearXNG indisponible — enrichissement par recherche désactivé. Démarrez SearXNG :" },
  "enrich.googleQueue": { en: "Google queue:", fr: "File Google :" },
  "enrich.queued": { en: "queued", fr: "en file" },
  "enrich.running": { en: "running", fr: "en cours" },
  "enrich.summaryLanguage": { en: "Summary language:", fr: "Langue du résumé :" },
  "enrich.enrichEverything": { en: "Enrich everything (slower)", fr: "Tout enrichir (plus lent)" },
  "enrich.poisTotalHint": { en: "POIs total — enrichment targets high-value categories", fr: "POI au total — l'enrichissement cible les catégories à forte valeur" },
  "enrich.enrichButton": { en: "Enrich", fr: "Enrichir" },
  "enrich.all": { en: "all", fr: "tous les" },
  "enrich.poisWord": { en: "POIs", fr: "POI" },
  "enrich.startSearxngTitle": { en: "Start SearXNG to enable enrichment", fr: "Démarrez SearXNG pour activer l'enrichissement" },
  "enrich.poisEnriched": { en: "POIs enriched", fr: "POI enrichis" },
  "enrich.retryableRemaining": { en: "retryable remaining", fr: "réessayables restants" },
  "enrich.continue": { en: "Continue enrichment", fr: "Continuer l'enrichissement" },
  "enrich.continueShort": { en: "Continue", fr: "Continuer" },
  "enrich.retryable": { en: "retryable", fr: "réessayables" },
  "enrich.reEnrichAll": { en: "Re-enrich all", fr: "Tout ré-enrichir" },
  "enrich.loadingModel": { en: "Loading AI model...", fr: "Chargement du modèle IA..." },
  "enrich.preparing": { en: "Preparing enrichment...", fr: "Préparation de l'enrichissement..." },
  "enrich.cancel": { en: "Cancel", fr: "Annuler" },
  "enrich.phaseSearching": { en: "Searching...", fr: "Recherche..." },
  "enrich.phaseGoogle": { en: "Google fallback queue...", fr: "File de secours Google..." },
  "enrich.phaseSynth": { en: "AI synthesis...", fr: "Synthèse IA..." },
  "enrich.phaseRetry": { en: "Retrying failed...", fr: "Réessai des échecs..." },
  "enrich.phaseEnriching": { en: "Enriching...", fr: "Enrichissement..." },
  "enrich.googleWait": { en: "Google Maps can take 30-90s per place. Still running — please wait.", fr: "Google Maps peut prendre 30-90s par lieu. Toujours en cours — patientez." },
  "enrich.processing": { en: "Processing", fr: "Traitement de" },
  "enrich.current": { en: "Current:", fr: "Actuel :" },
  "enrich.errorWord": { en: "error", fr: "erreur" },
  "enrich.skipped": { en: "skipped", fr: "ignorés" },
  "enrich.eta": { en: "ETA:", fr: "ETA :" },
  "enrich.stop": { en: "Stop", fr: "Arrêter" },
  "enrich.captchaBlocked": { en: "All search engines blocked (CAPTCHA / access denied).", fr: "Tous les moteurs de recherche sont bloqués (CAPTCHA / accès refusé)." },
  "enrich.captchaInstructions": { en: "Open SearXNG in a new tab, complete the CAPTCHA, then come back and resume.", fr: "Ouvrez SearXNG dans un nouvel onglet, complétez le CAPTCHA, puis revenez et reprenez." },
  "enrich.openSearxng": { en: "Open SearXNG — solve CAPTCHA", fr: "Ouvrir SearXNG — résoudre le CAPTCHA" },
  "enrich.resume": { en: "Resume enrichment", fr: "Reprendre l'enrichissement" },
  "enrich.remaining": { en: "remaining", fr: "restants" },
  "enrich.enginesDegradedSingular": { en: "search engine degraded", fr: "moteur de recherche dégradé" },
  "enrich.enginesDegradedPlural": { en: "search engines degraded", fr: "moteurs de recherche dégradés" },
  "enrich.error": { en: "Error:", fr: "Erreur :" },
  "enrich.enrichedBeforeError": { en: "enriched before error", fr: "enrichis avant l'erreur" },
  "enrich.retry": { en: "Retry", fr: "Réessayer" },
};

/** Translate a UI chrome string; falls back to English, then the key itself. */
export function t(key: string, lang: TargetLanguage): string {
  return UI[key]?.[lang] ?? UI[key]?.en ?? key;
}

// ---------------------------------------------------------------------------
// Generic POI name translations
// These are OSM tag-derived names that appear as POI names when no
// real business name is set. We translate them for display purposes.
// Matching is case-insensitive on the English/source name.
// ---------------------------------------------------------------------------

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
