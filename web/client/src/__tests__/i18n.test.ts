// ---------------------------------------------------------------------------
// Tests for i18n – translateCategory and translatePoiName
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { translateCategory, translatePoiName } from "../lib/i18n";
import type { PoiCategory } from "../types";

// ---------------------------------------------------------------------------
// translateCategory
// ---------------------------------------------------------------------------

describe("translateCategory", () => {
  const ALL_CATEGORIES: PoiCategory[] = [
    "Water", "Sleeping place", "Restroom", "Shelter", "Food shop",
    "Restaurant or Bar", "Gears", "DIY", "Laundry", "Medical",
    "Pharmacy", "Bank & ATM", "Post office", "Viewpoint",
    "Tourist info", "Charging", "Picnic", "Wifi",
  ];

  it("returns English labels for lang=en", () => {
    expect(translateCategory("Water", "en")).toBe("Water");
    expect(translateCategory("Gears", "en")).toBe("Bike & Sport");
    expect(translateCategory("DIY", "en")).toBe("Bike repair");
  });

  it("returns French labels for lang=fr", () => {
    expect(translateCategory("Water", "fr")).toBe("Eau");
    expect(translateCategory("Sleeping place", "fr")).toBe("Hébergement");
    expect(translateCategory("Gears", "fr")).toBe("Vélo & Sport");
    expect(translateCategory("Restaurant or Bar", "fr")).toBe("Restaurant / Bar");
    expect(translateCategory("Pharmacy", "fr")).toBe("Pharmacie");
  });

  it("has a translation for every category in both languages", () => {
    for (const cat of ALL_CATEGORIES) {
      const en = translateCategory(cat, "en");
      const fr = translateCategory(cat, "fr");
      expect(en).toBeTruthy();
      expect(fr).toBeTruthy();
      // French should differ from English key for at least some
      // (but we just verify they're non-empty)
    }
  });

  it("falls back to category key for unknown language", () => {
    // @ts-expect-error – testing runtime fallback
    expect(translateCategory("Water", "de")).toBe("Water");
  });
});

// ---------------------------------------------------------------------------
// translatePoiName
// ---------------------------------------------------------------------------

describe("translatePoiName", () => {
  it("returns original name for lang=en", () => {
    expect(translatePoiName("drinking water", "en")).toBe("drinking water");
    expect(translatePoiName("Le Petit Zinc", "en")).toBe("Le Petit Zinc");
  });

  it("translates known generic names in French", () => {
    expect(translatePoiName("drinking water", "fr")).toBe("Eau potable");
    expect(translatePoiName("toilets", "fr")).toBe("Toilettes");
    expect(translatePoiName("supermarket", "fr")).toBe("Supermarché");
    expect(translatePoiName("bakery", "fr")).toBe("Boulangerie");
    expect(translatePoiName("pharmacy", "fr")).toBe("Pharmacie");
    expect(translatePoiName("camp site", "fr")).toBe("Camping");
    expect(translatePoiName("viewpoint", "fr")).toBe("Point de vue");
  });

  it("is case-insensitive", () => {
    expect(translatePoiName("Drinking Water", "fr")).toBe("Eau potable");
    expect(translatePoiName("TOILETS", "fr")).toBe("Toilettes");
    expect(translatePoiName("Bakery", "fr")).toBe("Boulangerie");
  });

  it("trims whitespace before lookup", () => {
    expect(translatePoiName("  shelter  ", "fr")).toBe("Abri");
  });

  it("returns original name for real business names (no translation)", () => {
    expect(translatePoiName("Le Petit Zinc", "fr")).toBe("Le Petit Zinc");
    expect(translatePoiName("Boulangerie Dupont", "fr")).toBe("Boulangerie Dupont");
    expect(translatePoiName("Hotel Mercure", "fr")).toBe("Hotel Mercure");
  });

  it("returns original name for empty string", () => {
    expect(translatePoiName("", "fr")).toBe("");
  });

  it("returns original name for unknown language", () => {
    // @ts-expect-error – testing runtime fallback
    expect(translatePoiName("bakery", "de")).toBe("bakery");
  });
});
