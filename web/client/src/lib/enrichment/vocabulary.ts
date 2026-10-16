// --- The few words the pipeline needs in the country's language ---
// The reverse geocode gives a country code; everything else here derives from it.
// English is the default anywhere not listed, so a place in Japan or Norway
// still gets a sensible query instead of a French one.

export type SearchLanguage = "en" | "fr" | "de" | "it" | "es" | "nl" | "pt";

const COUNTRY_LANGUAGE: Record<string, SearchLanguage> = {
  fr: "fr",
  be: "fr",
  lu: "fr",
  mc: "fr",
  de: "de",
  at: "de",
  ch: "de",
  li: "de",
  it: "it",
  sm: "it",
  es: "es",
  ar: "es",
  mx: "es",
  cl: "es",
  co: "es",
  pe: "es",
  uy: "es",
  nl: "nl",
  pt: "pt",
  br: "pt",
};

export function languageForCountry(countryCode: string | null | undefined): SearchLanguage {
  return COUNTRY_LANGUAGE[countryCode?.toLowerCase() ?? ""] ?? "en";
}

interface Words {
  reviews: string;
  hours: string;
  prices: string;
  restaurant: string;
  shop: string;
  lodging: string;
  bikeShop: string;
}

/** Query words per language. The category word doubles as a type hint: "refuge" is also an animal shelter. */
export const WORDS: Record<SearchLanguage, Words> = {
  en: {
    reviews: "reviews",
    hours: "opening hours",
    prices: "prices",
    restaurant: "restaurant",
    shop: "shop",
    lodging: "accommodation",
    bikeShop: "bike shop repair",
  },
  fr: {
    reviews: "avis",
    hours: "horaires",
    prices: "tarif",
    restaurant: "restaurant",
    shop: "magasin",
    lodging: "hébergement",
    bikeShop: "atelier vélo réparation",
  },
  de: {
    reviews: "Bewertungen",
    hours: "Öffnungszeiten",
    prices: "Preise",
    restaurant: "Restaurant",
    shop: "Geschäft",
    lodging: "Unterkunft",
    bikeShop: "Fahrradwerkstatt Reparatur",
  },
  it: {
    reviews: "recensioni",
    hours: "orari",
    prices: "prezzi",
    restaurant: "ristorante",
    shop: "negozio",
    lodging: "alloggio",
    bikeShop: "negozio bici riparazione",
  },
  es: {
    reviews: "opiniones",
    hours: "horario",
    prices: "precios",
    restaurant: "restaurante",
    shop: "tienda",
    lodging: "alojamiento",
    bikeShop: "taller bicicletas reparación",
  },
  nl: {
    reviews: "beoordelingen",
    hours: "openingstijden",
    prices: "prijzen",
    restaurant: "restaurant",
    shop: "winkel",
    lodging: "accommodatie",
    bikeShop: "fietsenmaker reparatie",
  },
  pt: {
    reviews: "avaliações",
    hours: "horário",
    prices: "preços",
    restaurant: "restaurante",
    shop: "loja",
    lodging: "alojamento",
    bikeShop: "oficina bicicletas reparação",
  },
};

/** Explicit booking statements, checked in this order: required beats recommended beats not needed. */
export const BOOKING_PATTERNS: readonly {
  status: "required" | "recommended" | "not_needed";
  pattern: RegExp;
}[] = [
  {
    status: "required",
    pattern:
      /r[ée]servation (?:obligatoire|requise|indispensable)|(?:booking|reservation)s? (?:is |are )?(?:required|mandatory|essential)|by reservation only|reservierung (?:erforderlich|notwendig|pflicht)|nur mit reservierung|prenotazione obbligatoria|solo su prenotazione|reserva obligatoria|solo con reserva|reserveren (?:is )?verplicht|reserva obrigat[óo]ria|uniquement sur r[ée]servation|sur r[ée]servation uniquement/i,
  },
  {
    status: "recommended",
    pattern:
      /r[ée]servation (?:fortement )?(?:conseill[ée]e|recommand[ée]e)|(?:booking|reservation)s? (?:is |are )?(?:recommended|advised|advisable)|reservierung empfohlen|prenotazione consigliata|reserva recomendada|reserveren aanbevolen/i,
  },
  {
    status: "not_needed",
    pattern:
      /sans r[ée]servation|no (?:booking|reservation) (?:needed|required|necessary)|walk-ins welcome|ohne reservierung|senza prenotazione|sin reserva|zonder reservering|sem reserva/i,
  },
];

/**
 * Stems of link text or URL-path tokens that lead to the pages answering the
 * practical questions, by priority. Matched as token prefixes ("tarifs",
 * "preise", "opening-hours"), so "coffee" never looks like a fee.
 */
export const HOP_LINK_STEMS: readonly { kind: string; stems: readonly string[] }[] = [
  {
    kind: "prices",
    stems: ["tarif", "prix", "price", "pricing", "preis", "prezz", "precio", "preç", "rates"],
  },
  {
    kind: "hours",
    stems: [
      "horaire",
      "hour",
      "opening",
      "ouverture",
      "öffnung",
      "oeffnung",
      "zeiten",
      "orari",
      "horario",
      "horário",
      "openingstijd",
      "apertura",
    ],
  },
  {
    kind: "booking",
    stems: ["réserv", "reserv", "booking", "book", "buchen", "buchung", "prenot", "boek"],
  },
  { kind: "menu", stems: ["menu", "menü", "speisekarte", "carta"] },
  { kind: "contact", stems: ["contact", "kontakt", "contatt", "contacto", "contato"] },
];
