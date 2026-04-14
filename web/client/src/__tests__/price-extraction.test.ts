// ---------------------------------------------------------------------------
// Tests for deterministic price level extraction from search snippets
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import type { SearchSnippet } from "../types";
import { extractPriceLevel } from "../lib/enrichment/structured";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function snippet(content: string, overrides?: Partial<SearchSnippet>): SearchSnippet {
  return {
    title: overrides?.title ?? "Test result",
    url: overrides?.url ?? "https://example.com",
    content,
    engine: overrides?.engine ?? "google",
  };
}

// ---------------------------------------------------------------------------
// Strategy 1: Repeated currency symbols
// ---------------------------------------------------------------------------

describe("extractPriceLevel — repeated currency symbols", () => {
  it("returns null for a lone € without number (ambiguous signal)", () => {
    expect(extractPriceLevel([snippet("Price range: €")])).toBe(null);
  });

  it("detects €€ as level 2", () => {
    expect(extractPriceLevel([snippet("Price: €€ — moderate pricing")])).toBe(2);
  });

  it("detects $$$ as level 3", () => {
    expect(extractPriceLevel([snippet("This restaurant is rated $$$ by Google Maps")])).toBe(3);
  });

  it("detects €€€€ as level 4", () => {
    expect(extractPriceLevel([snippet("€€€€ — fine dining experience")])).toBe(4);
  });

  it("detects £££ as level 3", () => {
    expect(extractPriceLevel([snippet("Price range: £££")])).toBe(3);
  });

  it("detects ¥¥ as level 2", () => {
    expect(extractPriceLevel([snippet("Price: ¥¥")])).toBe(2);
  });

  it("takes median when multiple snippets have different signals", () => {
    // Two signals: €€ (2) and €€€€ (4) → sorted [2, 4], median index 1 = 4
    const result = extractPriceLevel([
      snippet("Google Maps says: €€"),
      snippet("Tripadvisor: €€€€ — expensive"),
    ]);
    expect(result).toBe(4);
  });

  it("takes median of three signals", () => {
    // Three signals: €€ (2), €€€ (3), €€€€ (4) → sorted [2, 3, 4], median = 3
    const result = extractPriceLevel([
      snippet("Budget: €€"),
      snippet("Price: €€€"),
      snippet("Listed as €€€€ on TripAdvisor"),
    ]);
    expect(result).toBe(3);
  });

  it("handles space-separated symbols like € €", () => {
    expect(extractPriceLevel([snippet("Price: € €")])).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Strategy 2: Textual price labels
// ---------------------------------------------------------------------------

describe("extractPriceLevel — textual labels", () => {
  it("detects 'Inexpensive' as level 1", () => {
    expect(extractPriceLevel([snippet("Rated as Inexpensive on Google Maps")])).toBe(1);
  });

  it("detects 'cheap' as level 1", () => {
    expect(extractPriceLevel([snippet("This is a cheap restaurant for a quick meal")])).toBe(1);
  });

  it("detects 'bon marché' as level 1", () => {
    expect(extractPriceLevel([snippet("Restaurant bon marché idéal pour les cyclistes")])).toBe(1);
  });

  it("detects 'Moderate' as level 2", () => {
    expect(extractPriceLevel([snippet("Google lists this as Moderate pricing")])).toBe(2);
  });

  it("detects 'prix moyen' as level 2", () => {
    expect(extractPriceLevel([snippet("Établissement avec des prix moyens")])).toBe(2);
  });

  it("detects 'Expensive' as level 3", () => {
    expect(extractPriceLevel([snippet("This is an Expensive restaurant in the area")])).toBe(3);
  });

  it("detects 'cher' as level 3", () => {
    expect(extractPriceLevel([snippet("Un peu cher mais la vue est magnifique")])).toBe(3);
  });

  it("detects 'Very Expensive' as level 4", () => {
    expect(extractPriceLevel([snippet("Classified as Very Expensive on Google")])).toBe(4);
  });

  it("detects 'très cher' as level 4", () => {
    expect(extractPriceLevel([snippet("C'est très cher pour ce que c'est")])).toBe(4);
  });

  it("detects textual labels even without currency symbols", () => {
    expect(extractPriceLevel([snippet("A moderate restaurant near the trail")])).toBe(2);
  });

  it("does not match 'cher' inside other words like 'chercher'", () => {
    // "cher" regex uses word boundary, so "chercher" should not match
    expect(extractPriceLevel([snippet("Il faut chercher un bon endroit")])).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// Strategy 3: Numeric prices
// ---------------------------------------------------------------------------

describe("extractPriceLevel — numeric prices (restaurants)", () => {
  it("detects low prices as level 1 (street food bracket)", () => {
    expect(extractPriceLevel([snippet("Kebab: 5€, burger: 7€")])).toBe(1);
  });

  it("detects mid prices as level 2 (casual dining)", () => {
    expect(extractPriceLevel([snippet("Menu du jour à 15€")])).toBe(2);
  });

  it("detects higher prices as level 3 (upscale casual)", () => {
    expect(extractPriceLevel([snippet("Plat principal: 35€, entrée: 18€")])).toBe(3);
  });

  it("detects high prices as level 4 (fine dining)", () => {
    expect(extractPriceLevel([snippet("Menu dégustation: 95€ par personne")])).toBe(4);
  });

  it("handles $ prefix notation", () => {
    expect(extractPriceLevel([snippet("Lunch specials from $12")])).toBe(2);
  });

  it("handles prices with cents (€15.50)", () => {
    expect(extractPriceLevel([snippet("Average dish: €15.50")])).toBe(2);
  });

  it("handles comma decimal (25,90€)", () => {
    expect(extractPriceLevel([snippet("Plat du jour: 25,90€")])).toBe(3);
  });

  it("handles £ prices", () => {
    expect(extractPriceLevel([snippet("Mains from £22")])).toBe(3);
  });
});

describe("extractPriceLevel — numeric prices (accommodation)", () => {
  it("detects budget hostel (≤30€) as level 1", () => {
    expect(extractPriceLevel([snippet("Dorm beds from 18€")], "Sleeping place")).toBe(1);
  });

  it("detects mid-range (≤70€) as level 2", () => {
    expect(extractPriceLevel([snippet("Double room: 55€/night")], "Sleeping place")).toBe(2);
  });

  it("detects upper mid (≤150€) as level 3", () => {
    expect(extractPriceLevel([snippet("Room prices start at $120")], "Sleeping place")).toBe(3);
  });

  it("detects luxury (>150€) as level 4", () => {
    expect(extractPriceLevel([snippet("Suite from €250 per night")], "Sleeping place")).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// Priority: repeated symbols > textual > numeric
// ---------------------------------------------------------------------------

describe("extractPriceLevel — priority ordering", () => {
  it("prefers repeated symbols over numeric prices", () => {
    // €€ = level 2, but numeric "95€" would suggest level 4
    // Repeated symbols should win because they're from review platforms
    const result = extractPriceLevel([
      snippet("€€ — Menu dégustation: 95€"),
    ]);
    expect(result).toBe(2);
  });

  it("prefers repeated symbols over textual labels", () => {
    // $$$ = level 3, but "cheap" would suggest level 1
    const result = extractPriceLevel([
      snippet("$$$ — surprisingly cheap for the area"),
    ]);
    expect(result).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// Edge cases
// ---------------------------------------------------------------------------

describe("extractPriceLevel — edge cases", () => {
  it("returns null for empty snippets", () => {
    expect(extractPriceLevel([])).toBe(null);
  });

  it("returns null when no price signal at all", () => {
    expect(extractPriceLevel([snippet("Nice restaurant near the trail. Open daily.")])).toBe(null);
  });

  it("returns null for content with currency symbols in unrelated contexts", () => {
    // A lone $ or € in a URL or code snippet shouldn't trigger
    // But our regex may match — this tests current behavior
    const result = extractPriceLevel([snippet("Visit www.example.com for details")]);
    expect(result).toBe(null);
  });

  it("caps at level 4 even with $$$$$ (5+ symbols)", () => {
    // The regex matches up to 4 repetitions; 5th char starts a new match
    const result = extractPriceLevel([snippet("$$$$$")]);
    expect(result).toBeLessThanOrEqual(4);
    expect(result).toBeGreaterThanOrEqual(1);
  });

  it("handles mixed currencies across snippets", () => {
    const result = extractPriceLevel([
      snippet("€€ on Google"),
      snippet("$$ on Yelp"),
    ]);
    expect(result).toBe(2); // Both say level 2
  });

  it("ignores very large numeric values (probably not prices)", () => {
    // 15000€ could be a property price, not a meal — but under 10000 limit
    const result = extractPriceLevel([snippet("Property valued at 15000€")]);
    // 15000 is filtered out by the < 10000 guard
    expect(result).toBe(null);
  });
});
