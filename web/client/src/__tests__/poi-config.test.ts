// ---------------------------------------------------------------------------
// Tests for POI config lookups
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import {
  findCategoryForTag,
  getCategoryConfig,
  ALL_CATEGORIES,
  DEFAULT_CATEGORIES,
  POI_CATEGORIES,
  OSMAND_CATEGORY_ICONS,
  OSMAND_CATEGORY_COLORS,
  OSMAND_CATEGORY_BACKGROUNDS,
  getOsmAndIcon,
} from "../lib/poi-config";

// ---------------------------------------------------------------------------
// Category completeness
// ---------------------------------------------------------------------------

describe("POI_CATEGORIES", () => {
  it("should have 18 categories total (9 essential + 9 optional)", () => {
    expect(POI_CATEGORIES.length).toBe(18);
  });

  it("should have all essential categories", () => {
    const names = POI_CATEGORIES.map((c) => c.category);
    expect(names).toContain("Water");
    expect(names).toContain("Sleeping place");
    expect(names).toContain("Restroom");
    expect(names).toContain("Shelter");
    expect(names).toContain("Food shop");
    expect(names).toContain("Restaurant or Bar");
    expect(names).toContain("Gears");
    expect(names).toContain("DIY");
    expect(names).toContain("Laundry");
  });

  it("should have all optional categories", () => {
    const names = POI_CATEGORIES.map((c) => c.category);
    expect(names).toContain("Medical");
    expect(names).toContain("Pharmacy");
    expect(names).toContain("Bank & ATM");
    expect(names).toContain("Post office");
    expect(names).toContain("Viewpoint");
    expect(names).toContain("Tourist info");
    expect(names).toContain("Charging");
    expect(names).toContain("Picnic");
    expect(names).toContain("Wifi");
  });

  it("should have unique category names", () => {
    const names = POI_CATEGORIES.map((c) => c.category);
    expect(new Set(names).size).toBe(names.length);
  });

  it("should all have at least one tag", () => {
    for (const cat of POI_CATEGORIES) {
      expect(cat.tags.length).toBeGreaterThan(0);
    }
  });

  it("should have unique colors per category", () => {
    const colors = POI_CATEGORIES.map((c) => c.style.backgroundColor);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("should mark essential categories as defaultEnabled true", () => {
    const essential = POI_CATEGORIES.filter((c) => c.defaultEnabled === true);
    expect(essential.length).toBe(9);
    const names = essential.map((c) => c.category);
    expect(names).toContain("Water");
    expect(names).toContain("Sleeping place");
    expect(names).toContain("Laundry");
  });

  it("should mark optional categories as defaultEnabled false", () => {
    const optional = POI_CATEGORIES.filter((c) => c.defaultEnabled === false);
    expect(optional.length).toBe(9);
    const names = optional.map((c) => c.category);
    expect(names).toContain("Medical");
    expect(names).toContain("Pharmacy");
    expect(names).toContain("Wifi");
  });
});

// ---------------------------------------------------------------------------
// DEFAULT_CATEGORIES
// ---------------------------------------------------------------------------

describe("DEFAULT_CATEGORIES", () => {
  it("should contain exactly the 9 essential categories", () => {
    expect(DEFAULT_CATEGORIES.length).toBe(9);
  });

  it("should not contain any optional categories", () => {
    expect(DEFAULT_CATEGORIES).not.toContain("Medical");
    expect(DEFAULT_CATEGORIES).not.toContain("Pharmacy");
    expect(DEFAULT_CATEGORIES).not.toContain("Bank & ATM");
    expect(DEFAULT_CATEGORIES).not.toContain("Post office");
    expect(DEFAULT_CATEGORIES).not.toContain("Viewpoint");
    expect(DEFAULT_CATEGORIES).not.toContain("Tourist info");
    expect(DEFAULT_CATEGORIES).not.toContain("Charging");
    expect(DEFAULT_CATEGORIES).not.toContain("Picnic");
    expect(DEFAULT_CATEGORIES).not.toContain("Wifi");
  });

  it("should contain all essential categories", () => {
    expect(DEFAULT_CATEGORIES).toContain("Water");
    expect(DEFAULT_CATEGORIES).toContain("Sleeping place");
    expect(DEFAULT_CATEGORIES).toContain("Restroom");
    expect(DEFAULT_CATEGORIES).toContain("Shelter");
    expect(DEFAULT_CATEGORIES).toContain("Food shop");
    expect(DEFAULT_CATEGORIES).toContain("Restaurant or Bar");
    expect(DEFAULT_CATEGORIES).toContain("Gears");
    expect(DEFAULT_CATEGORIES).toContain("DIY");
    expect(DEFAULT_CATEGORIES).toContain("Laundry");
  });
});

// ---------------------------------------------------------------------------
// ALL_CATEGORIES
// ---------------------------------------------------------------------------

describe("ALL_CATEGORIES", () => {
  it("should match POI_CATEGORIES length", () => {
    expect(ALL_CATEGORIES.length).toBe(POI_CATEGORIES.length);
  });

  it("should contain all 18 category names", () => {
    expect(ALL_CATEGORIES.length).toBe(18);
  });
});

// ---------------------------------------------------------------------------
// findCategoryForTag
// ---------------------------------------------------------------------------

describe("findCategoryForTag", () => {
  it("should find Water for amenity=drinking_water", () => {
    const result = findCategoryForTag("amenity", "drinking_water");
    expect(result).not.toBeNull();
    expect(result!.category.category).toBe("Water");
    expect(result!.tag.icon).toBe("droplet");
  });

  it("should find Sleeping place for tourism=camp_site", () => {
    const result = findCategoryForTag("tourism", "camp_site");
    expect(result).not.toBeNull();
    expect(result!.category.category).toBe("Sleeping place");
  });

  it("should find Medical for amenity=hospital", () => {
    const result = findCategoryForTag("amenity", "hospital");
    expect(result).not.toBeNull();
    expect(result!.category.category).toBe("Medical");
  });

  it("should find Pharmacy for amenity=pharmacy", () => {
    const result = findCategoryForTag("amenity", "pharmacy");
    expect(result).not.toBeNull();
    expect(result!.category.category).toBe("Pharmacy");
  });

  it("should find Bank & ATM for amenity=atm", () => {
    const result = findCategoryForTag("amenity", "atm");
    expect(result).not.toBeNull();
    expect(result!.category.category).toBe("Bank & ATM");
  });

  it("should find Viewpoint for tourism=viewpoint", () => {
    const result = findCategoryForTag("tourism", "viewpoint");
    expect(result).not.toBeNull();
    expect(result!.category.category).toBe("Viewpoint");
  });

  it("should find Charging for amenity=charging_station", () => {
    const result = findCategoryForTag("amenity", "charging_station");
    expect(result).not.toBeNull();
    expect(result!.category.category).toBe("Charging");
  });

  it("should find Picnic for tourism=picnic_site", () => {
    const result = findCategoryForTag("tourism", "picnic_site");
    expect(result).not.toBeNull();
    expect(result!.category.category).toBe("Picnic");
  });

  it("should find Wifi for amenity=internet_cafe", () => {
    const result = findCategoryForTag("amenity", "internet_cafe");
    expect(result).not.toBeNull();
    expect(result!.category.category).toBe("Wifi");
  });

  it("should return null for unknown tags", () => {
    expect(findCategoryForTag("building", "yes")).toBeNull();
    expect(findCategoryForTag("highway", "residential")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// getCategoryConfig
// ---------------------------------------------------------------------------

describe("getCategoryConfig", () => {
  it("should return config for known essential category", () => {
    const config = getCategoryConfig("Water");
    expect(config).toBeDefined();
    expect(config!.style.backgroundColor).toBe("#0066CC");
    expect(config!.defaultEnabled).toBe(true);
  });

  it("should return config for known optional category", () => {
    const config = getCategoryConfig("Medical");
    expect(config).toBeDefined();
    expect(config!.style.backgroundColor).toBe("#DC2626");
    expect(config!.defaultEnabled).toBe(false);
  });

  it("should return undefined for unknown category", () => {
    // @ts-expect-error testing invalid input
    const config = getCategoryConfig("NonexistentCategory");
    expect(config).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// OsmAnd mappings
// ---------------------------------------------------------------------------

describe("OsmAnd mappings", () => {
  it("should have icons for all 18 categories", () => {
    for (const cat of ALL_CATEGORIES) {
      expect(OSMAND_CATEGORY_ICONS[cat]).toBeDefined();
      expect(OSMAND_CATEGORY_ICONS[cat].length).toBeGreaterThan(0);
    }
  });

  it("should have colors for all 18 categories", () => {
    for (const cat of ALL_CATEGORIES) {
      expect(OSMAND_CATEGORY_COLORS[cat]).toBeDefined();
      expect(OSMAND_CATEGORY_COLORS[cat]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("should have backgrounds for all 18 categories", () => {
    for (const cat of ALL_CATEGORIES) {
      expect(OSMAND_CATEGORY_BACKGROUNDS[cat]).toBeDefined();
      expect(["circle", "octagon", "square"]).toContain(
        OSMAND_CATEGORY_BACKGROUNDS[cat],
      );
    }
  });

  it("getOsmAndIcon should use tag-specific icon when available", () => {
    const icon = getOsmAndIcon({
      category: "Water",
      tags: { amenity: "drinking_water" },
    });
    expect(icon).toBe("amenity_drinking_water");
  });

  it("getOsmAndIcon should fallback to category icon for unknown tags", () => {
    const icon = getOsmAndIcon({
      category: "Water",
      tags: { unknown: "tag" },
    });
    expect(icon).toBe("amenity_drinking_water"); // category default
  });

  it("getOsmAndIcon should work for optional categories", () => {
    const icon = getOsmAndIcon({
      category: "Medical",
      tags: { amenity: "hospital" },
    });
    expect(icon).toBe("amenity_hospital");
  });
});
