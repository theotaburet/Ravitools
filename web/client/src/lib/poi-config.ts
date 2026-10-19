// POI category configuration
// Categories and their OSM tag matchers

import {
  Bed,
  Beer,
  Bike,
  Binoculars,
  Castle,
  Coffee,
  CreditCard,
  Croissant,
  Droplet,
  Flame,
  Fuel,
  Hospital,
  House,
  IceCreamCone,
  type IconNode,
  Info,
  Landmark,
  Mail,
  Pill,
  ShoppingCart,
  ShowerHead,
  Stethoscope,
  Tent,
  Toilet,
  TreeDeciduous,
  Utensils,
  WashingMachine,
  Wifi,
  Wrench,
  Zap,
} from "lucide";
import type {
  EnrichabilityPolicy,
  EnrichmentCategoryContract,
  Palette,
  POI,
  PoiCategory,
  PoiCategoryConfig,
  PoiFamily,
} from "../types";

export const POI_CATEGORIES: PoiCategoryConfig[] = [
  // --- Essential categories (enabled by default) ---
  {
    category: "Water",
    family: "Water",
    glyph: Droplet,
    defaultEnabled: true,
    emoji: "💧",
    policy: "skip",
    mergeable: true,
    gpxSymbol: "Drinking Water",
    fitType: 3, // water
    osmand: { icon: "amenity_drinking_water", background: "circle" },
    tags: [
      { key: "amenity", value: "water_point", icon: "droplet" },
      { key: "amenity", value: "drinking_water", icon: "droplet" },
      { key: "man_made", value: "water_tap", icon: "droplet", unless: { drinking_water: ["no"] } },
      { key: "natural", value: "spring", icon: "droplet", unless: { drinking_water: ["no"] } },
      { key: "amenity", value: "fountain", icon: "droplet", only: { drinking_water: ["yes"] } },
    ],
  },
  {
    category: "Sleeping place",
    family: "Sleep",
    glyph: Bed,
    defaultEnabled: true,
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
      { key: "tourism", value: "wilderness_hut", icon: "hut" },
    ],
  },
  {
    category: "Restroom",
    family: "Water",
    glyph: Toilet,
    defaultEnabled: true,
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
    family: "Sleep",
    glyph: House,
    defaultEnabled: true,
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
    family: "Food",
    glyph: ShoppingCart,
    defaultEnabled: true,
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
      { key: "shop", value: "kiosk", icon: "store" },
      { key: "amenity", value: "marketplace", icon: "store" },
      // Fuel stations sell water and food, often late
      { key: "amenity", value: "fuel", icon: "fuel" },
      {
        key: "amenity",
        value: "vending_machine",
        icon: "store",
        only: { vending: ["drinks", "water", "food", "sweets", "bread", "milk", "coffee"] },
      },
    ],
  },
  {
    category: "Restaurant or Bar",
    family: "Food",
    glyph: Utensils,
    defaultEnabled: true,
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
    family: "Mechanics",
    glyph: Bike,
    defaultEnabled: true,
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
    family: "Mechanics",
    glyph: Wrench,
    defaultEnabled: true,
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
    family: "Services",
    glyph: WashingMachine,
    defaultEnabled: true,
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
    family: "Health",
    glyph: Stethoscope,
    defaultEnabled: false,
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
    family: "Health",
    glyph: Pill,
    defaultEnabled: false,
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
    family: "Services",
    glyph: Landmark,
    defaultEnabled: false,
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
    family: "Services",
    glyph: Mail,
    defaultEnabled: false,
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
    family: "Discovery",
    glyph: Binoculars,
    defaultEnabled: false,
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
    family: "Discovery",
    glyph: Info,
    defaultEnabled: false,
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
    family: "Mechanics",
    glyph: Zap,
    defaultEnabled: false,
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
    family: "Food",
    glyph: TreeDeciduous,
    defaultEnabled: false,
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
    family: "Services",
    glyph: Wifi,
    defaultEnabled: false,
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
  const has = (key: string, values: string[]) =>
    (tags[key] ?? "").split(";").some((v) => values.includes(v.trim()));
  return (
    Object.entries(tag.unless ?? {}).some(([key, values]) => has(key, values)) ||
    Object.entries(tag.only ?? {}).some(([key, values]) => !has(key, values))
  );
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

/** Corridor (meters): Overpass is queried this far around the route, and the distance
 *  slider starts and ends here; POIs farther from every trace are dropped */
export const CORRIDOR_M = 1500;

function byCategory<T>(pick: (c: PoiCategoryConfig) => T): Record<PoiCategory, T> {
  return Object.fromEntries(POI_CATEGORIES.map((c) => [c.category, pick(c)])) as Record<
    PoiCategory,
    T
  >;
}

// Lookups by category, all read from the POI_CATEGORIES rows above
export const OSMAND_CATEGORY_ICONS = byCategory((c) => c.osmand.icon);
export const OSMAND_CATEGORY_BACKGROUNDS = byCategory((c) => c.osmand.background);
export const GPX_SYMBOLS = byCategory((c) => c.gpxSymbol);
export const FIT_COURSE_POINT_TYPES = byCategory((c) => c.fitType);
const CATEGORY_GLYPHS = byCategory((c) => c.glyph);
export const CATEGORY_FAMILIES = byCategory((c) => c.family);
export const MERGEABLE_CATEGORIES = byCategory((c) => c.mergeable);
const CATEGORY_EMOJI = byCategory((c) => c.emoji);
const ENRICHABILITY_POLICY = byCategory((c) => c.policy);

/** Per-tag emoji where one category mixes very different places (a campsite is
 *  not a hotel); the category emoji is the fallback for every other tag. */
const ICON_EMOJI: Record<string, string> = { tent: "🏕️", hut: "🛖" };

export function poiEmoji(poi: Pick<POI, "icon" | "category">): string {
  return ICON_EMOJI[poi.icon] ?? CATEGORY_EMOJI[poi.category] ?? "📍";
}

/** Per-tag glyph where one category mixes different places, keyed like ICON_EMOJI by the tag's icon */
const ICON_GLYPHS: Record<string, IconNode> = {
  tent: Tent,
  shower: ShowerHead,
  bread: Croissant,
  coffee: Coffee,
  beer: Beer,
  icecream: IceCreamCone,
  hospital: Hospital,
  creditcard: CreditCard,
  castle: Castle,
  fire: Flame,
  fuel: Fuel,
};

/** A category's family fill in a palette: the map's colour, which the exports write too */
export function categoryColor(category: PoiCategory, palette: Palette): string {
  return FAMILY_COLORS[palette][CATEGORY_FAMILIES[category]].fill;
}

export function poiGlyph(poi: Pick<POI, "icon" | "category">): IconNode {
  return ICON_GLYPHS[poi.icon] ?? CATEGORY_GLYPHS[poi.category];
}

const WHITE = "#FFFFFF";
const INK = "#16181C";

/** Family fill and glyph per palette (design.md 3.4): the glyph is white or ink,
 *  whichever contrasts more. The same ink as --color-ink in light, in both themes. */
export const FAMILY_COLORS: Record<Palette, Record<PoiFamily, { fill: string; glyph: string }>> = {
  default: {
    Water: { fill: "#1F5FBF", glyph: WHITE },
    Food: { fill: "#E8711A", glyph: INK },
    Sleep: { fill: "#6E44C2", glyph: WHITE },
    Mechanics: { fill: "#4B5563", glyph: WHITE },
    Health: { fill: "#D32F2F", glyph: WHITE },
    Services: { fill: "#2E7D32", glyph: WHITE },
    Discovery: { fill: "#C9A227", glyph: INK },
  },
  cvd: {
    Water: { fill: "#0072B2", glyph: WHITE },
    Food: { fill: "#E69F00", glyph: INK },
    Sleep: { fill: "#CC79A7", glyph: INK },
    Mechanics: { fill: "#3D434B", glyph: WHITE },
    Health: { fill: "#D55E00", glyph: INK },
    Services: { fill: "#009E73", glyph: INK },
    Discovery: { fill: "#F0E442", glyph: INK },
  },
};

/** Families in display order (design.md 3.4), each with its categories in config order */
export const POI_FAMILIES = (Object.keys(FAMILY_COLORS.default) as PoiFamily[]).map((family) => ({
  family,
  categories: POI_CATEGORIES.filter((c) => c.family === family),
}));

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
