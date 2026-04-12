// ---------------------------------------------------------------------------
// POI category configuration
// Direct TypeScript port of config/config.yaml OSM_POI_configuration
// Extended with optional categories for bikepacking
// ---------------------------------------------------------------------------

import type { PoiCategory, PoiCategoryConfig } from "../types";

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
