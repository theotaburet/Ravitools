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
