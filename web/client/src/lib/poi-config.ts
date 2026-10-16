// POI category configuration
// Categories and their OSM tag matchers

import type {
  EnrichabilityPolicy,
  EnrichmentCategoryContract,
  POI,
  PoiCategory,
  PoiCategoryConfig,
} from "../types";

export const POI_CATEGORIES: PoiCategoryConfig[] = [
  // --- Essential categories (enabled by default) ---
  {
    category: "Water",
    defaultEnabled: true,
    color: "#0066CC",
    emoji: "💧",
    policy: "skip",
    mergeable: true,
    gpxSymbol: "Drinking Water",
    fitType: 3, // water
    osmand: { icon: "amenity_drinking_water", background: "circle" },
    tags: [
      { key: "amenity", value: "water_point", icon: "droplet" },
      { key: "amenity", value: "drinking_water", icon: "droplet" },
    ],
  },
  {
    category: "Sleeping place",
    defaultEnabled: true,
    color: "#1A1A2E",
    emoji: "🛏️",
    policy: "full",
    mergeable: false,
    gpxSymbol: "Campground",
    fitType: 27, // campsite
    osmand: { icon: "tourism_camp_site", background: "circle" },
    tags: [
      { key: "tourism", value: "camp_site", icon: "tent" },
      { key: "tourism", value: "hostel", icon: "bed" },
      { key: "tourism", value: "alpine_hut", icon: "hut" },
      { key: "tourism", value: "chalet", icon: "hut" },
      { key: "tourism", value: "guest_house", icon: "bed" },
      { key: "tourism", value: "motel", icon: "bed" },
      { key: "tourism", value: "hotel", icon: "bed" },
    ],
  },
  {
    category: "Restroom",
    defaultEnabled: true,
    color: "#FFD700",
    emoji: "🚻",
    policy: "skip",
    mergeable: true,
    gpxSymbol: "Restroom",
    fitType: 39, // toilet
    osmand: { icon: "amenity_toilets", background: "circle" },
    tags: [
      { key: "amenity", value: "toilets", icon: "restroom" },
      { key: "amenity", value: "shower", icon: "shower" },
    ],
  },
  {
    category: "Shelter",
    defaultEnabled: true,
    color: "#444444",
    emoji: "🏠",
    policy: "skip",
    mergeable: true,
    gpxSymbol: "Shelter",
    fitType: 36, // shelter
    osmand: { icon: "amenity_shelter", background: "octagon" },
    tags: [
      {
        key: "amenity",
        value: "shelter",
        icon: "house",
        unless: { shelter_type: ["public_transport", "changing_rooms", "field_shelter"] },
      },
    ],
  },
  {
    category: "Food shop",
    defaultEnabled: true,
    color: "#228B22",
    emoji: "🛒",
    policy: "full",
    mergeable: false,
    gpxSymbol: "Shopping Center",
    fitType: 48, // store
    osmand: { icon: "shop_supermarket", background: "circle" },
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
    color: "#FF6B35",
    emoji: "🍽️",
    policy: "full",
    mergeable: false,
    gpxSymbol: "Restaurant",
    fitType: 4, // food
    osmand: { icon: "amenity_restaurant", background: "circle" },
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
    color: "#CC0000",
    emoji: "🔧",
    policy: "full",
    mergeable: false,
    gpxSymbol: "Bike Trail",
    fitType: 41, // gear
    osmand: { icon: "shop_bicycle", background: "square" },
    tags: [
      { key: "shop", value: "bicycle", icon: "bicycle" },
      { key: "shop", value: "outdoor", icon: "backpack" },
      { key: "shop", value: "sports", icon: "dumbbell" },
    ],
  },
  {
    category: "DIY",
    defaultEnabled: true,
    color: "#E65100",
    emoji: "🛠️",
    policy: "minimal",
    mergeable: true,
    gpxSymbol: "Wrecker",
    fitType: 31, // service
    osmand: { icon: "amenity_bicycle_repair_station", background: "square" },
    tags: [{ key: "amenity", value: "bicycle_repair_station", icon: "wrench" }],
  },
  {
    category: "Laundry",
    defaultEnabled: true,
    color: "#FFB6C1",
    emoji: "👕",
    policy: "minimal",
    mergeable: true,
    gpxSymbol: "Building",
    fitType: 31, // service
    osmand: { icon: "shop_laundry", background: "circle" },
    tags: [{ key: "shop", value: "laundry", icon: "shirt" }],
  },

  // --- Optional categories (disabled by default, user opts in) ---
  {
    category: "Medical",
    defaultEnabled: false,
    color: "#DC2626",
    emoji: "🏥",
    policy: "minimal",
    mergeable: false,
    gpxSymbol: "Medical Facility",
    fitType: 9, // first_aid
    osmand: { icon: "amenity_hospital", background: "square" },
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
    color: "#16A34A",
    emoji: "💊",
    policy: "minimal",
    mergeable: false,
    gpxSymbol: "Pharmacy",
    fitType: 9, // first_aid
    osmand: { icon: "amenity_pharmacy", background: "circle" },
    tags: [{ key: "amenity", value: "pharmacy", icon: "pills" }],
  },
  {
    category: "Bank & ATM",
    defaultEnabled: false,
    color: "#1D4ED8",
    emoji: "🏧",
    policy: "minimal",
    mergeable: false,
    gpxSymbol: "Bank",
    fitType: 0, // generic
    osmand: { icon: "amenity_atm", background: "circle" },
    tags: [
      { key: "amenity", value: "atm", icon: "creditcard" },
      { key: "amenity", value: "bank", icon: "bank" },
      { key: "amenity", value: "bureau_de_change", icon: "exchange" },
    ],
  },
  {
    category: "Post office",
    defaultEnabled: false,
    color: "#CA8A04",
    emoji: "📮",
    policy: "minimal",
    mergeable: false,
    gpxSymbol: "Post Office",
    fitType: 0, // generic
    osmand: { icon: "amenity_post_office", background: "circle" },
    tags: [
      { key: "amenity", value: "post_office", icon: "envelope" },
      { key: "amenity", value: "post_box", icon: "mailbox" },
    ],
  },
  {
    category: "Viewpoint",
    defaultEnabled: false,
    color: "#7C3AED",
    emoji: "👁️",
    policy: "minimal",
    mergeable: true,
    gpxSymbol: "Scenic Area",
    fitType: 38, // overlook
    osmand: { icon: "tourism_viewpoint", background: "octagon" },
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
    color: "#38BDF8",
    emoji: "ℹ️",
    policy: "minimal",
    mergeable: false,
    gpxSymbol: "Information",
    fitType: 53, // info
    osmand: { icon: "tourism_information", background: "circle" },
    tags: [
      { key: "tourism", value: "information", icon: "info" },
      { key: "information", value: "office", icon: "info" },
    ],
  },
  {
    category: "Charging",
    defaultEnabled: false,
    color: "#FACC15",
    emoji: "🔌",
    policy: "minimal",
    mergeable: true,
    gpxSymbol: "Charging Station",
    fitType: 31, // service
    osmand: { icon: "amenity_charging_station", background: "square" },
    tags: [
      { key: "amenity", value: "charging_station", icon: "bolt" },
      { key: "amenity", value: "device_charging_station", icon: "battery" },
    ],
  },
  {
    category: "Picnic",
    defaultEnabled: false,
    color: "#059669",
    emoji: "🌳",
    policy: "skip",
    mergeable: true,
    gpxSymbol: "Picnic Area",
    fitType: 29, // rest_area
    osmand: { icon: "tourism_picnic_site", background: "circle" },
    tags: [
      { key: "tourism", value: "picnic_site", icon: "tree" },
      { key: "leisure", value: "picnic_table", icon: "table" },
      { key: "amenity", value: "bbq", icon: "fire" },
    ],
  },
  {
    category: "Wifi",
    defaultEnabled: false,
    color: "#6366F1",
    emoji: "📶",
    policy: "minimal",
    mergeable: true,
    gpxSymbol: "Library",
    fitType: 53, // info
    osmand: { icon: "amenity_internet_cafe", background: "circle" },
    tags: [
      { key: "amenity", value: "internet_cafe", icon: "wifi" },
      { key: "internet_access", value: "wlan", icon: "wifi" },
      { key: "amenity", value: "library", icon: "book" },
    ],
  },
];

/** Quick lookup: (key, value) -> category config */
function isExcluded(tag: PoiCategoryConfig["tags"][number], tags: Record<string, string>) {
  return Object.entries(tag.unless ?? {}).some(([key, values]) => values.includes(tags[key]));
}

export function findCategoryForTag(
  key: string,
  value: string,
  tags: Record<string, string> = {},
): { category: PoiCategoryConfig; tag: PoiCategoryConfig["tags"][number] } | null {
  for (const cat of POI_CATEGORIES) {
    for (const tag of cat.tags) {
      if (tag.key === key && tag.value === value && !isExcluded(tag, tags)) {
        return { category: cat, tag };
      }
    }
  }
  return null;
}

/** All category names */
export const ALL_CATEGORIES: PoiCategory[] = POI_CATEGORIES.map((c) => c.category);

/** Categories enabled by default */
export const DEFAULT_CATEGORIES: PoiCategory[] = POI_CATEGORIES.filter(
  (c) => c.defaultEnabled !== false,
).map((c) => c.category);

/** Default corridor: POIs farther than this from every trace are dropped (meters) */
export const DEFAULT_MAX_DISTANCE_M = 1500;

function byCategory<T>(pick: (c: PoiCategoryConfig) => T): Record<PoiCategory, T> {
  return Object.fromEntries(POI_CATEGORIES.map((c) => [c.category, pick(c)])) as Record<
    PoiCategory,
    T
  >;
}

// Lookups by category, all read from the POI_CATEGORIES rows above
export const CATEGORY_COLORS = byCategory((c) => c.color);
export const OSMAND_CATEGORY_ICONS = byCategory((c) => c.osmand.icon);
export const OSMAND_CATEGORY_BACKGROUNDS = byCategory((c) => c.osmand.background);
export const GPX_SYMBOLS = byCategory((c) => c.gpxSymbol);
export const FIT_COURSE_POINT_TYPES = byCategory((c) => c.fitType);
export const MERGEABLE_CATEGORIES = byCategory((c) => c.mergeable);
const CATEGORY_EMOJI = byCategory((c) => c.emoji);
const ENRICHABILITY_POLICY = byCategory((c) => c.policy);

/** Per-tag emoji where one category mixes very different places (a campsite is
 *  not a hotel); the category emoji is the fallback for every other tag. */
const ICON_EMOJI: Record<string, string> = { tent: "🏕️", hut: "🛖" };

export function poiEmoji(poi: Pick<POI, "icon" | "category">): string {
  return ICON_EMOJI[poi.icon] ?? CATEGORY_EMOJI[poi.category] ?? "📍";
}

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

/** Get the enrichability policy for a category */
export function getEnrichabilityPolicy(category: PoiCategory): EnrichabilityPolicy {
  return ENRICHABILITY_POLICY[category] ?? "skip";
}

// Category-level enrichment contracts
// What the LLM must never say for a "full" category (injected in the prompt), and
// the caution shown when no review or discovery platform covers the place.

const RESTAURANT_CONTRACT: EnrichmentCategoryContract = {
  category: "Restaurant or Bar",
  bannedPatterns: [
    "Invented menu items not in sources",
    "Generic praise ('excellent restaurant', 'great food') without source backing",
    "Star ratings without source attribution",
    "Assumed hours from similar places",
    "Marketing language ('don't miss', 'must try', 'hidden gem')",
  ],
};

const FOOD_SHOP_CONTRACT: EnrichmentCategoryContract = {
  category: "Food shop",
  bannedPatterns: [
    "Assumed product range from shop type",
    "Generic statements ('well-stocked', 'nice selection') without source",
    "Invented hours from chain typical schedules",
    "Price comparisons not in sources",
  ],
};

const SLEEPING_PLACE_CONTRACT: EnrichmentCategoryContract = {
  category: "Sleeping place",
  bannedPatterns: [
    "Assumed prices from similar establishments",
    "Invented amenity lists",
    "Marketing copy ('paradise for cyclists', 'stunning views')",
    "Star classification not in sources",
    "Assumed booking requirements",
  ],
};

const GEARS_CONTRACT: EnrichmentCategoryContract = {
  category: "Gears",
  bannedPatterns: [
    "Assumed repair capability from shop type",
    "Generic gear lists not in sources",
    "Assumed brand availability",
    "Marketing language ('best bike shop', 'expert mechanics')",
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
export function getOsmAndIcon(poi: {
  category: PoiCategory;
  tags: Record<string, string>;
}): string {
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
