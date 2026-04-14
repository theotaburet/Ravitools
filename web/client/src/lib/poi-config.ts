// ---------------------------------------------------------------------------
// POI category configuration
// Direct TypeScript port of config/config.yaml OSM_POI_configuration
// Extended with optional categories for bikepacking
// ---------------------------------------------------------------------------

import type { PoiCategory, PoiCategoryConfig, EnrichabilityPolicy, EnrichmentCategoryContract } from "../types";

export const POI_CATEGORIES: PoiCategoryConfig[] = [
  // -----------------------------------------------------------------------
  // Essential categories (enabled by default)
  // -----------------------------------------------------------------------
  {
    category: "Water",
    defaultEnabled: true,
    style: {
      iconShape: "circle",
      borderColor: "#FFFFFF",
      borderWidth: "2",
      textColor: "#FFFFFF",
      backgroundColor: "#0066CC",
    },
    tags: [
      { key: "amenity", value: "water_point", icon: "droplet" },
      { key: "amenity", value: "drinking_water", icon: "droplet" },
    ],
  },
  {
    category: "Sleeping place",
    defaultEnabled: true,
    style: {
      iconShape: "circle",
      borderColor: "#FFFFFF",
      borderWidth: "2",
      textColor: "#FFFFFF",
      backgroundColor: "#1A1A2E",
    },
    tags: [
      { key: "tourism", value: "camp_site", icon: "tent" },
      { key: "tourism", value: "hostel", icon: "bed" },
      { key: "tourism", value: "alpine_hut", icon: "house" },
      { key: "tourism", value: "chalet", icon: "house" },
      { key: "tourism", value: "guest_house", icon: "bed" },
      { key: "tourism", value: "motel", icon: "bed" },
      { key: "tourism", value: "hotel", icon: "bed" },
    ],
  },
  {
    category: "Restroom",
    defaultEnabled: true,
    style: {
      iconShape: "circle",
      borderColor: "#000000",
      borderWidth: "2",
      textColor: "#000000",
      backgroundColor: "#FFD700",
    },
    tags: [
      { key: "amenity", value: "toilets", icon: "restroom" },
      { key: "amenity", value: "shower", icon: "shower" },
    ],
  },
  {
    category: "Shelter",
    defaultEnabled: true,
    style: {
      iconShape: "circle",
      borderColor: "#FFFFFF",
      borderWidth: "2",
      textColor: "#FFFFFF",
      backgroundColor: "#444444",
    },
    tags: [
      { key: "amenity", value: "shelter", icon: "house" },
    ],
  },
  {
    category: "Food shop",
    defaultEnabled: true,
    style: {
      iconShape: "circle",
      borderColor: "#FFFFFF",
      borderWidth: "2",
      textColor: "#FFFFFF",
      backgroundColor: "#228B22",
    },
    tags: [
      { key: "shop", value: "supermarket", icon: "cart" },
      { key: "shop", value: "convenience", icon: "store" },
      { key: "shop", value: "bakery", icon: "bread" },
      { key: "shop", value: "butcher", icon: "meat" },
      { key: "shop", value: "greengrocer", icon: "carrot" },
      { key: "shop", value: "farm", icon: "tractor" },
      { key: "shop", value: "food", icon: "apple" },
      { key: "shop", value: "deli", icon: "store" },
      { key: "shop", value: "cheese", icon: "cheese" },
      { key: "shop", value: "pastry", icon: "cookie" },
      { key: "shop", value: "seafood", icon: "fish" },
      { key: "shop", value: "alcohol", icon: "wine" },
      { key: "shop", value: "beverages", icon: "cup" },
      { key: "shop", value: "frozen_food", icon: "snowflake" },
      { key: "shop", value: "health_food", icon: "leaf" },
      { key: "shop", value: "water", icon: "droplet" },
      { key: "shop", value: "wine", icon: "wine" },
      { key: "shop", value: "coffee", icon: "coffee" },
      { key: "shop", value: "tea", icon: "cup" },
      { key: "shop", value: "chocolate", icon: "candy" },
      { key: "shop", value: "confectionery", icon: "candy" },
      { key: "shop", value: "dairy", icon: "cheese" },
      { key: "shop", value: "ice_cream", icon: "icecream" },
      { key: "shop", value: "nuts", icon: "seed" },
      { key: "shop", value: "pasta", icon: "wheat" },
      { key: "shop", value: "spices", icon: "leaf" },
      { key: "shop", value: "brewing_supplies", icon: "beer" },
      { key: "shop", value: "tortilla", icon: "bread" },
    ],
  },
  {
    category: "Restaurant or Bar",
    defaultEnabled: true,
    style: {
      iconShape: "circle",
      borderColor: "#FFFFFF",
      borderWidth: "2",
      textColor: "#FFFFFF",
      backgroundColor: "#FF6B35",
    },
    tags: [
      { key: "amenity", value: "restaurant", icon: "utensils" },
      { key: "amenity", value: "cafe", icon: "coffee" },
      { key: "amenity", value: "fast_food", icon: "burger" },
      { key: "amenity", value: "bar", icon: "beer" },
      { key: "amenity", value: "pub", icon: "beer" },
      { key: "amenity", value: "biergarten", icon: "beer" },
      { key: "amenity", value: "food_court", icon: "utensils" },
      { key: "amenity", value: "ice_cream", icon: "icecream" },
    ],
  },
  {
    category: "Gears",
    defaultEnabled: true,
    style: {
      iconShape: "circle",
      borderColor: "#FFFFFF",
      borderWidth: "2",
      textColor: "#FFFFFF",
      backgroundColor: "#CC0000",
    },
    tags: [
      { key: "shop", value: "bicycle", icon: "bicycle" },
      { key: "shop", value: "outdoor", icon: "backpack" },
      { key: "shop", value: "sports", icon: "dumbbell" },
    ],
  },
  {
    category: "DIY",
    defaultEnabled: true,
    style: {
      iconShape: "circle",
      borderColor: "#FFFFFF",
      borderWidth: "2",
      textColor: "#FFFFFF",
      backgroundColor: "#E65100",
    },
    tags: [
      { key: "amenity", value: "bicycle_repair_station", icon: "wrench" },
    ],
  },
  {
    category: "Laundry",
    defaultEnabled: true,
    style: {
      iconShape: "circle",
      borderColor: "#FFFFFF",
      borderWidth: "2",
      textColor: "#FFFFFF",
      backgroundColor: "#FFB6C1",
    },
    tags: [
      { key: "shop", value: "laundry", icon: "shirt" },
    ],
  },

  // -----------------------------------------------------------------------
  // Optional categories (disabled by default, user opts in)
  // -----------------------------------------------------------------------
  {
    category: "Medical",
    defaultEnabled: false,
    style: {
      iconShape: "circle",
      borderColor: "#FFFFFF",
      borderWidth: "2",
      textColor: "#FFFFFF",
      backgroundColor: "#DC2626",
    },
    tags: [
      { key: "amenity", value: "hospital", icon: "hospital" },
      { key: "amenity", value: "clinic", icon: "hospital" },
      { key: "amenity", value: "doctors", icon: "stethoscope" },
      { key: "amenity", value: "dentist", icon: "tooth" },
      { key: "amenity", value: "veterinary", icon: "paw" },
    ],
  },
  {
    category: "Pharmacy",
    defaultEnabled: false,
    style: {
      iconShape: "circle",
      borderColor: "#FFFFFF",
      borderWidth: "2",
      textColor: "#FFFFFF",
      backgroundColor: "#16A34A",
    },
    tags: [
      { key: "amenity", value: "pharmacy", icon: "pills" },
    ],
  },
  {
    category: "Bank & ATM",
    defaultEnabled: false,
    style: {
      iconShape: "circle",
      borderColor: "#FFFFFF",
      borderWidth: "2",
      textColor: "#FFFFFF",
      backgroundColor: "#1D4ED8",
    },
    tags: [
      { key: "amenity", value: "atm", icon: "creditcard" },
      { key: "amenity", value: "bank", icon: "bank" },
      { key: "amenity", value: "bureau_de_change", icon: "exchange" },
    ],
  },
  {
    category: "Post office",
    defaultEnabled: false,
    style: {
      iconShape: "circle",
      borderColor: "#FFFFFF",
      borderWidth: "2",
      textColor: "#FFFFFF",
      backgroundColor: "#CA8A04",
    },
    tags: [
      { key: "amenity", value: "post_office", icon: "envelope" },
      { key: "amenity", value: "post_box", icon: "mailbox" },
    ],
  },
  {
    category: "Viewpoint",
    defaultEnabled: false,
    style: {
      iconShape: "circle",
      borderColor: "#FFFFFF",
      borderWidth: "2",
      textColor: "#FFFFFF",
      backgroundColor: "#7C3AED",
    },
    tags: [
      { key: "tourism", value: "viewpoint", icon: "eye" },
      { key: "tourism", value: "attraction", icon: "star" },
      { key: "tourism", value: "museum", icon: "landmark" },
      { key: "historic", value: "castle", icon: "castle" },
      { key: "historic", value: "monument", icon: "monument" },
      { key: "historic", value: "memorial", icon: "monument" },
      { key: "historic", value: "ruins", icon: "ruin" },
    ],
  },
  {
    category: "Tourist info",
    defaultEnabled: false,
    style: {
      iconShape: "circle",
      borderColor: "#000000",
      borderWidth: "2",
      textColor: "#000000",
      backgroundColor: "#38BDF8",
    },
    tags: [
      { key: "tourism", value: "information", icon: "info" },
      { key: "information", value: "office", icon: "info" },
    ],
  },
  {
    category: "Charging",
    defaultEnabled: false,
    style: {
      iconShape: "circle",
      borderColor: "#000000",
      borderWidth: "2",
      textColor: "#000000",
      backgroundColor: "#FACC15",
    },
    tags: [
      { key: "amenity", value: "charging_station", icon: "bolt" },
      { key: "amenity", value: "device_charging_station", icon: "battery" },
    ],
  },
  {
    category: "Picnic",
    defaultEnabled: false,
    style: {
      iconShape: "circle",
      borderColor: "#FFFFFF",
      borderWidth: "2",
      textColor: "#FFFFFF",
      backgroundColor: "#059669",
    },
    tags: [
      { key: "tourism", value: "picnic_site", icon: "tree" },
      { key: "leisure", value: "picnic_table", icon: "table" },
      { key: "amenity", value: "bbq", icon: "fire" },
    ],
  },
  {
    category: "Wifi",
    defaultEnabled: false,
    style: {
      iconShape: "circle",
      borderColor: "#FFFFFF",
      borderWidth: "2",
      textColor: "#FFFFFF",
      backgroundColor: "#6366F1",
    },
    tags: [
      { key: "amenity", value: "internet_cafe", icon: "wifi" },
      { key: "internet_access", value: "wlan", icon: "wifi" },
      { key: "amenity", value: "library", icon: "book" },
    ],
  },
];

/** Quick lookup: (key, value) -> category config */
export function findCategoryForTag(
  key: string,
  value: string,
): { category: PoiCategoryConfig; tag: PoiCategoryConfig["tags"][number] } | null {
  for (const cat of POI_CATEGORIES) {
    for (const tag of cat.tags) {
      if (tag.key === key && tag.value === value) {
        return { category: cat, tag };
      }
    }
  }
  return null;
}

/** Get config for a given category */
export function getCategoryConfig(
  category: PoiCategory,
): PoiCategoryConfig | undefined {
  return POI_CATEGORIES.find((c) => c.category === category);
}

/** All category names */
export const ALL_CATEGORIES: PoiCategory[] = POI_CATEGORIES.map(
  (c) => c.category,
);

/** Categories enabled by default */
export const DEFAULT_CATEGORIES: PoiCategory[] = POI_CATEGORIES
  .filter((c) => c.defaultEnabled !== false)
  .map((c) => c.category);

// ---------------------------------------------------------------------------
// OsmAnd extension mappings
// OsmAnd GPX supports custom extensions for icon, color, and background shape.
// Namespace: osmand:
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Map marker emoji per category
// Used as DivIcon content on the Leaflet map (no external icon font needed)
// ---------------------------------------------------------------------------

export const CATEGORY_EMOJI: Record<PoiCategory, string> = {
  Water: "💧",
  "Sleeping place": "🏕️",
  Restroom: "🚻",
  Shelter: "🏠",
  "Food shop": "🛒",
  "Restaurant or Bar": "🍽️",
  Gears: "🔧",
  DIY: "🛠️",
  Laundry: "👕",
  Medical: "🏥",
  Pharmacy: "💊",
  "Bank & ATM": "🏧",
  "Post office": "📮",
  Viewpoint: "👁️",
  "Tourist info": "ℹ️",
  Charging: "🔌",
  Picnic: "🌳",
  Wifi: "📶",
};

/** OsmAnd icon names follow the pattern "category_value" (underscores). */
export const OSMAND_CATEGORY_ICONS: Record<PoiCategory, string> = {
  Water: "amenity_drinking_water",
  "Sleeping place": "tourism_camp_site",
  Restroom: "amenity_toilets",
  Shelter: "amenity_shelter",
  "Food shop": "shop_supermarket",
  "Restaurant or Bar": "amenity_restaurant",
  Gears: "shop_bicycle",
  DIY: "amenity_bicycle_repair_station",
  Laundry: "shop_laundry",
  Medical: "amenity_hospital",
  Pharmacy: "amenity_pharmacy",
  "Bank & ATM": "amenity_atm",
  "Post office": "amenity_post_office",
  Viewpoint: "tourism_viewpoint",
  "Tourist info": "tourism_information",
  Charging: "amenity_charging_station",
  Picnic: "tourism_picnic_site",
  Wifi: "amenity_internet_cafe",
};

/**
 * OsmAnd colors – hex values.
 * These map directly to the category background colors.
 */
export const OSMAND_CATEGORY_COLORS: Record<PoiCategory, string> = {
  Water: "#0066CC",
  "Sleeping place": "#1A1A2E",
  Restroom: "#FFD700",
  Shelter: "#444444",
  "Food shop": "#228B22",
  "Restaurant or Bar": "#FF6B35",
  Gears: "#CC0000",
  DIY: "#E65100",
  Laundry: "#FFB6C1",
  Medical: "#DC2626",
  Pharmacy: "#16A34A",
  "Bank & ATM": "#1D4ED8",
  "Post office": "#CA8A04",
  Viewpoint: "#7C3AED",
  "Tourist info": "#38BDF8",
  Charging: "#FACC15",
  Picnic: "#059669",
  Wifi: "#6366F1",
};

/** OsmAnd background shape for POI markers */
export const OSMAND_CATEGORY_BACKGROUNDS: Record<PoiCategory, string> = {
  Water: "circle",
  "Sleeping place": "circle",
  Restroom: "circle",
  Shelter: "octagon",
  "Food shop": "circle",
  "Restaurant or Bar": "circle",
  Gears: "square",
  DIY: "square",
  Laundry: "circle",
  Medical: "square",
  Pharmacy: "circle",
  "Bank & ATM": "circle",
  "Post office": "circle",
  Viewpoint: "octagon",
  "Tourist info": "circle",
  Charging: "square",
  Picnic: "circle",
  Wifi: "circle",
};

/**
 * Per-tag OsmAnd icon overrides.
 * When a POI has specific OSM tags, we can pick a more precise OsmAnd icon.
 * Key format: "osmKey=osmValue"
 */
export const OSMAND_TAG_ICONS: Record<string, string> = {
  // Water
  "amenity=drinking_water": "amenity_drinking_water",
  "amenity=water_point": "amenity_drinking_water",
  // Sleeping
  "tourism=camp_site": "tourism_camp_site",
  "tourism=hostel": "tourism_hostel",
  "tourism=alpine_hut": "tourism_alpine_hut",
  "tourism=hotel": "tourism_hotel",
  "tourism=guest_house": "tourism_guest_house",
  "tourism=motel": "tourism_hotel",
  "tourism=chalet": "tourism_chalet",
  // Restroom
  "amenity=toilets": "amenity_toilets",
  "amenity=shower": "amenity_shower",
  // Shelter
  "amenity=shelter": "amenity_shelter",
  // Food shop
  "shop=supermarket": "shop_supermarket",
  "shop=convenience": "shop_convenience",
  "shop=bakery": "shop_bakery",
  "shop=butcher": "shop_butcher",
  // Restaurant
  "amenity=restaurant": "amenity_restaurant",
  "amenity=cafe": "amenity_cafe",
  "amenity=fast_food": "amenity_fast_food",
  "amenity=bar": "amenity_bar",
  "amenity=pub": "amenity_pub",
  "amenity=biergarten": "amenity_biergarten",
  "amenity=ice_cream": "amenity_ice_cream",
  // Gears
  "shop=bicycle": "shop_bicycle",
  "shop=outdoor": "shop_outdoor",
  "shop=sports": "shop_sports",
  // DIY
  "amenity=bicycle_repair_station": "amenity_bicycle_repair_station",
  // Laundry
  "shop=laundry": "shop_laundry",
  // Medical
  "amenity=hospital": "amenity_hospital",
  "amenity=clinic": "amenity_clinic",
  "amenity=doctors": "amenity_doctors",
  // Pharmacy
  "amenity=pharmacy": "amenity_pharmacy",
  // Bank
  "amenity=atm": "amenity_atm",
  "amenity=bank": "amenity_bank",
  // Post
  "amenity=post_office": "amenity_post_office",
  // Viewpoint
  "tourism=viewpoint": "tourism_viewpoint",
  "tourism=attraction": "tourism_attraction",
  "tourism=museum": "tourism_museum",
  // Tourist info
  "tourism=information": "tourism_information",
  // Charging
  "amenity=charging_station": "amenity_charging_station",
  // Picnic
  "tourism=picnic_site": "tourism_picnic_site",
  "leisure=picnic_table": "leisure_picnic_table",
  // Wifi
  "amenity=internet_cafe": "amenity_internet_cafe",
  "amenity=library": "amenity_library",
};

// ---------------------------------------------------------------------------
// Enrichability policy per category
// Determines how much enrichment effort each category deserves.
// - "full": geocode + search + LLM synthesis (high-value places)
// - "minimal": geocode only (locality), no web search, no LLM
// - "skip": no network calls at all, just Google Maps link
// ---------------------------------------------------------------------------

export const ENRICHABILITY_POLICY: Record<PoiCategory, EnrichabilityPolicy> = {
  "Restaurant or Bar": "full",
  "Food shop": "full",
  "Sleeping place": "full",
  Gears: "full",
  Laundry: "minimal",
  DIY: "minimal",
  Medical: "minimal",
  Pharmacy: "minimal",
  "Bank & ATM": "minimal",
  "Post office": "minimal",
  "Tourist info": "minimal",
  Viewpoint: "minimal",
  Charging: "minimal",
  Wifi: "minimal",
  Water: "skip",
  Restroom: "skip",
  Shelter: "skip",
  Picnic: "skip",
};

/** Get the enrichability policy for a category */
export function getEnrichabilityPolicy(category: PoiCategory): EnrichabilityPolicy {
  return ENRICHABILITY_POLICY[category] ?? "skip";
}

/** Count how many POIs in a list are enrichable (full or minimal, not skip) */
export function countEnrichable(pois: { category: PoiCategory }[]): number {
  return pois.filter((p) => getEnrichabilityPolicy(p.category) !== "skip").length;
}

/** Count how many POIs in a list get full enrichment */
export function countFullEnrichable(pois: { category: PoiCategory }[]): number {
  return pois.filter((p) => getEnrichabilityPolicy(p.category) === "full").length;
}

// ---------------------------------------------------------------------------
// Category-level enrichment contracts
// Defines what each "full" enrichment category must produce, what matters,
// what must NOT be said, and how to handle weak/contradictory sources.
// These contracts guide both the LLM prompt and the deterministic builder.
// ---------------------------------------------------------------------------

const RESTAURANT_CONTRACT: EnrichmentCategoryContract = {
  category: "Restaurant or Bar",
  priorities: [
    "Cuisine type and standout dish if mentioned",
    "Reputation signal (rating + volume, not just a number)",
    "Opening hours or known closure days",
    "Cyclist-practical info: terrace, large portions, water refill, bike parking",
    "Price bracket if inferable",
  ],
  valuableSignals: [
    "Explicit rating with review count from Google/TripAdvisor/Yelp",
    "Mentions of cyclist/hiker friendliness",
    "Specific closure days (e.g. 'fermé le lundi')",
    "Payment methods (cash only, CB)",
    "Terrace / outdoor seating",
    "Take-away option",
  ],
  bannedPatterns: [
    "Invented menu items not in sources",
    "Generic praise ('excellent restaurant', 'great food') without source backing",
    "Star ratings without source attribution",
    "Assumed hours from similar places",
    "Marketing language ('don't miss', 'must try', 'hidden gem')",
  ],
  weakSourceFormulations: [
    "Limited online presence; verify hours on arrival.",
    "Few reviews available; reliability cannot be assessed from web sources alone.",
    "Listed on Google Maps but no review platform coverage found.",
  ],
  contradictionFormulations: [
    "Sources disagree on opening hours — verify locally.",
    "Rating varies between platforms ({platform_a}: {rating_a}, {platform_b}: {rating_b}).",
  ],
  silenceConditions: [
    "Only a Google Maps pin exists with zero reviews and no website",
    "All snippets are from aggregator sites with no original content",
  ],
};

const FOOD_SHOP_CONTRACT: EnrichmentCategoryContract = {
  category: "Food shop",
  priorities: [
    "Shop type (supermarket, bakery, convenience, farm shop, etc.)",
    "Opening hours — critical for resupply timing",
    "Whether it is a chain or independent (resupply reliability signal)",
    "Size/range: small village shop vs full supermarket",
    "Sunday/holiday opening if detectable",
  ],
  valuableSignals: [
    "Chain name (Carrefour, Spar, Intermarche, Lidl, etc.)",
    "Explicit opening hours, especially Sunday and lunch break",
    "ATM on-site or nearby",
    "Water refill possible",
    "Local products / farm-direct mention",
    "Bread baked on-site",
  ],
  bannedPatterns: [
    "Assumed product range from shop type",
    "Generic statements ('well-stocked', 'nice selection') without source",
    "Invented hours from chain typical schedules",
    "Price comparisons not in sources",
  ],
  weakSourceFormulations: [
    "Listed on maps but no online reviews; verify hours and stock on-site.",
    "Appears to be a small independent shop — hours and availability may vary.",
  ],
  contradictionFormulations: [
    "Hours vary between sources — listed as {hours_a} on Google, {hours_b} on the official site.",
  ],
  silenceConditions: [
    "Only an OSM node with a shop tag and no web footprint at all",
    "All snippets are duplicates from a single directory listing",
  ],
};

const SLEEPING_PLACE_CONTRACT: EnrichmentCategoryContract = {
  category: "Sleeping place",
  priorities: [
    "Accommodation type (campsite, hostel, hotel, gite, bivouac, alpine hut)",
    "Booking requirement vs walk-in possibility",
    "Price range or explicit tariff if mentioned",
    "Check-in / reception hours if known",
    "Cyclist-specific amenities (bike storage, drying room, tools, laundry)",
    "Seasonal availability (summer-only, closed in winter)",
  ],
  valuableSignals: [
    "Explicit price or price range from booking platforms",
    "Booking.com / Airbnb / Hostelworld / camping platform listing",
    "Mentions of bike-friendly labels (Accueil Velo, Cyclists Welcome)",
    "Kitchen / cooking facilities for self-caterers",
    "Wild camping tolerance notes",
    "Proximity to water/food resupply",
    "Altitude or exposed location (alpine hut context)",
    "Shower and hot water availability",
  ],
  bannedPatterns: [
    "Assumed prices from similar establishments",
    "Invented amenity lists",
    "Marketing copy ('paradise for cyclists', 'stunning views')",
    "Star classification not in sources",
    "Assumed booking requirements",
  ],
  weakSourceFormulations: [
    "Limited info online — contact directly to confirm availability and price.",
    "Listed on OSM but not found on major booking platforms.",
    "Few reviews; condition and reliability unclear from web sources.",
  ],
  contradictionFormulations: [
    "Price varies between sources ({source_a}: {price_a}, {source_b}: {price_b}).",
    "Some sources list this as seasonal; verify opening period.",
  ],
  silenceConditions: [
    "Only an OSM node with tourism=camp_site and no web presence",
    "All snippets are from real-estate or unrelated sites",
  ],
};

const GEARS_CONTRACT: EnrichmentCategoryContract = {
  category: "Gears",
  priorities: [
    "Shop type: bike shop, outdoor gear, sports general",
    "Whether bike repair service is offered",
    "Opening hours — critical for a rider in need",
    "Brands or specialty (road, MTB, touring, e-bike)",
    "Walk-in repair vs appointment only",
  ],
  valuableSignals: [
    "Explicit repair service mention",
    "Spare parts availability (tubes, tires, chains, brake pads)",
    "E-bike charging or battery service",
    "Rental availability",
    "Workshop wait time or 'while you wait' service",
    "Known closure days",
    "Mentions on cycling forums or community recommendations",
  ],
  bannedPatterns: [
    "Assumed repair capability from shop type",
    "Generic gear lists not in sources",
    "Assumed brand availability",
    "Marketing language ('best bike shop', 'expert mechanics')",
  ],
  weakSourceFormulations: [
    "Listed as a bike/sports shop but limited online info — call ahead for repair availability.",
    "Google listing exists but no reviews; capability unclear.",
  ],
  contradictionFormulations: [
    "Sources disagree on repair service availability — verify in person.",
    "Hours listed on Google ({hours_google}) differ from the website ({hours_site}).",
  ],
  silenceConditions: [
    "Only an OSM node with shop=bicycle and zero web footprint",
    "All snippets are from generic business directories with no original detail",
  ],
};

/** All category contracts for full-enrichment categories, indexed by PoiCategory */
export const ENRICHMENT_CONTRACTS: Partial<Record<PoiCategory, EnrichmentCategoryContract>> = {
  "Restaurant or Bar": RESTAURANT_CONTRACT,
  "Food shop": FOOD_SHOP_CONTRACT,
  "Sleeping place": SLEEPING_PLACE_CONTRACT,
  Gears: GEARS_CONTRACT,
};

/** Get the enrichment contract for a category (null if not a full-enrichment category) */
export function getEnrichmentContract(category: PoiCategory): EnrichmentCategoryContract | null {
  return ENRICHMENT_CONTRACTS[category] ?? null;
}

/** Resolve the best OsmAnd icon for a POI based on its tags, with category fallback */
export function getOsmAndIcon(poi: { category: PoiCategory; tags: Record<string, string> }): string {
  // Try specific tag match first
  for (const [key, value] of Object.entries(poi.tags)) {
    const tagKey = `${key}=${value}`;
    if (OSMAND_TAG_ICONS[tagKey]) {
      return OSMAND_TAG_ICONS[tagKey];
    }
  }
  // Fallback to category-level icon
  return OSMAND_CATEGORY_ICONS[poi.category] ?? "special_star";
}
