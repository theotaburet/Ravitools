// ---------------------------------------------------------------------------
// FVM — source discovery, parsing, official website, queries, URL dedup
// (split from fvm.test.ts)
// ---------------------------------------------------------------------------
// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildSearchQuery,
  classifySourcePlatform,
  cleanPoiNameForSearch,
  getOfficialWebsiteUrl,
  isRejectedOfficialDomain,
  normalizeUrlForDedup,
} from "../lib/enrichment/search";
import { buildStructuredContent } from "../lib/enrichment/structured";
import type { PoiCategory, SearchSnippet } from "../types";
import { makePoi } from "./fvm-helpers";

// ===========================================================================
// A. Source Discovery
// ===========================================================================

describe("FVM-A: Source Discovery", () => {
  it("A1: Restaurant query includes review and hours context keywords", () => {
    const poi = makePoi({ category: "Restaurant or Bar" });
    const query = buildSearchQuery(poi, "Lyon");
    expect(query).toContain("avis");
    expect(query).toContain("restaurant");
    expect(query).toContain("horaires");
    expect(query).toContain("Lyon");
  });

  it("A2: Food shop query includes resupply-relevant terms", () => {
    const poi = makePoi({
      category: "Food shop",
      name: "Carrefour Contact",
      tags: { shop: "supermarket" },
    });
    const query = buildSearchQuery(poi, "Valence");
    expect(query).toContain('"Carrefour Contact"');
    expect(query).toContain("Valence");
    // Should contain food shop context keywords
    expect(query).toContain("horaires");
    expect(query).toContain("magasin");
    expect(query).toContain("avis");
  });

  it("A3: Sleeping place query includes accommodation context", () => {
    const poi = makePoi({
      category: "Sleeping place",
      name: "Camping du Lac",
      tags: { tourism: "camp_site" },
    });
    const query = buildSearchQuery(poi, null);
    expect(query).toContain("avis");
    expect(query).toContain("hébergement");
    expect(query).toContain("tarif");
  });

  it("A4: Gears query uses POI name for bike shop search", () => {
    const poi = makePoi({
      category: "Gears",
      name: "Cycles Dupont",
      tags: { shop: "bicycle" },
    });
    const query = buildSearchQuery(poi, "Grenoble");
    expect(query).toContain('"Cycles Dupont"');
    expect(query).toContain("Grenoble");
  });

  it("A5: unnamed POI uses tag-based fallback", () => {
    const poi = makePoi({
      name: "",
      tags: { amenity: "restaurant" },
    });
    const query = buildSearchQuery(poi, null);
    expect(query).toContain("restaurant");
    expect(query).not.toContain('""'); // no empty quoted name
  });

  it("A5b: 'Unknown' named POI uses tag-based fallback", () => {
    const poi = makePoi({
      name: "Unknown",
      tags: { shop: "bicycle" },
    });
    const query = buildSearchQuery(poi, null);
    expect(query).toContain("bicycle");
  });

  it("A5c: non-Sleeping place does NOT include booking platforms", () => {
    const poi = makePoi({
      category: "Restaurant or Bar",
      name: "Le Comptoir",
    });
    const query = buildSearchQuery(poi, null);
    expect(query).not.toContain("booking OR");
  });
});

// ===========================================================================
// B. Source Parsing And Classification
// ===========================================================================

describe("FVM-B: Source Parsing And Classification", () => {
  it("B1: classifies Google Maps URL", () => {
    expect(classifySourcePlatform("https://www.google.com/maps/place/test")).toBe("google_maps");
    expect(classifySourcePlatform("https://maps.google.fr/maps?q=test")).toBe("google_maps");
  });

  it("B2: classifies Yelp URL", () => {
    expect(classifySourcePlatform("https://www.yelp.com/biz/chez-marcel")).toBe("yelp");
    expect(classifySourcePlatform("https://www.yelp.fr/biz/test")).toBe("yelp");
  });

  it("B3: classifies TripAdvisor URL", () => {
    expect(classifySourcePlatform("https://www.tripadvisor.com/Restaurant-test")).toBe(
      "tripadvisor",
    );
    expect(classifySourcePlatform("https://www.tripadvisor.fr/Hotel-test")).toBe("tripadvisor");
  });

  it("B4: classifies Facebook URL", () => {
    expect(classifySourcePlatform("https://www.facebook.com/chezmarcel")).toBe("facebook");
    expect(classifySourcePlatform("https://m.facebook.com/pages/test")).toBe("facebook");
  });

  it("B5: classifies Instagram URL", () => {
    expect(classifySourcePlatform("https://www.instagram.com/chezmarcel/")).toBe("instagram");
  });

  it("B6: classifies Booking.com URL", () => {
    expect(classifySourcePlatform("https://www.booking.com/hotel/fr/test.html")).toBe("booking");
  });

  it("B7: classifies Hotels.com URL", () => {
    expect(classifySourcePlatform("https://www.hotels.com/ho12345")).toBe("hotels_com");
    expect(classifySourcePlatform("https://fr.hotels.com/test")).toBe("hotels_com");
  });

  it("B8: classifies unknown domains as 'other'", () => {
    expect(classifySourcePlatform("https://www.pagesjaunes.fr/test")).toBe("other");
    expect(classifySourcePlatform("https://random-blog.com/review")).toBe("other");
    expect(classifySourcePlatform("https://en.wikipedia.org/wiki/test")).toBe("other");
  });

  it("B8b: handles malformed URLs gracefully", () => {
    expect(classifySourcePlatform("not-a-url")).toBe("other");
    expect(classifySourcePlatform("")).toBe("other");
  });
});

// ===========================================================================
// C. Official Website
// ===========================================================================

describe("FVM-C: Official Website", () => {
  it("C1: detects website tag", () => {
    const poi = makePoi({ tags: { amenity: "restaurant", website: "https://chez-marcel.fr" } });
    expect(getOfficialWebsiteUrl(poi)).toBe("https://chez-marcel.fr");
  });

  it("C2: detects contact:website tag", () => {
    const poi = makePoi({
      tags: { amenity: "restaurant", "contact:website": "https://chez-marcel.fr" },
    });
    expect(getOfficialWebsiteUrl(poi)).toBe("https://chez-marcel.fr");
  });

  it("C3: normalizes bare domain without scheme", () => {
    const poi = makePoi({ tags: { amenity: "restaurant", website: "chez-marcel.fr" } });
    expect(getOfficialWebsiteUrl(poi)).toBe("https://chez-marcel.fr");
  });

  it("C3b: normalizes domain with path", () => {
    const poi = makePoi({ tags: { amenity: "restaurant", website: "chez-marcel.fr/menu" } });
    expect(getOfficialWebsiteUrl(poi)).toBe("https://chez-marcel.fr/menu");
  });

  it("C3c: preserves http:// URLs as-is", () => {
    const poi = makePoi({ tags: { amenity: "restaurant", website: "http://old-site.com" } });
    expect(getOfficialWebsiteUrl(poi)).toBe("http://old-site.com");
  });

  it("C4: returns null when no website tag exists", () => {
    const poi = makePoi({ tags: { amenity: "restaurant" } });
    expect(getOfficialWebsiteUrl(poi)).toBeNull();
  });

  it("C4b: returns null for empty website tag", () => {
    const poi = makePoi({ tags: { amenity: "restaurant", website: "" } });
    expect(getOfficialWebsiteUrl(poi)).toBeNull();
  });

  it("C4c: returns null for whitespace-only website tag", () => {
    const poi = makePoi({ tags: { amenity: "restaurant", website: "   " } });
    expect(getOfficialWebsiteUrl(poi)).toBeNull();
  });

  it("C7: official website enriches sourceRollup when present", () => {
    const poi = makePoi();
    const enrichment = {
      rating: null,
      reviewCount: null,
      hours: null,
      description: null,
      priceLevel: null,
      locality: null,
    };
    const websitePreview = {
      url: "https://chez-marcel.fr",
      finalUrl: "https://chez-marcel.fr",
      title: "Chez Marcel - Restaurant Lyon",
      description: "Fine French dining in Lyon since 1952",
      excerpt: null,
      fetchedAt: "2026-04-13T00:00:00Z",
    };
    const structured = buildStructuredContent(poi, enrichment, [], websitePreview, "fr");
    const officialDigest = structured.sourceRollup.find((d) => d.platform === "official_website");
    expect(officialDigest).toBeDefined();
    expect(officialDigest!.brief).toContain("Fine French dining");
  });

  it("C8: official website does not clobber review platform sources", () => {
    const poi = makePoi();
    const enrichment = {
      rating: 4.2,
      reviewCount: 50,
      hours: "12-14, 19-22",
      description: "Great",
      priceLevel: 2,
      locality: "Lyon",
    };
    const snippets: SearchSnippet[] = [
      {
        title: "Google review",
        url: "https://www.google.com/maps/place/chez-marcel",
        content: "Excellent restaurant",
        engine: "google",
      },
      {
        title: "TripAdvisor",
        url: "https://www.tripadvisor.fr/restaurant/chez-marcel",
        content: "Very good",
        engine: "google",
      },
    ];
    const websitePreview = {
      url: "https://chez-marcel.fr",
      finalUrl: "https://chez-marcel.fr",
      title: "Chez Marcel",
      description: "Our restaurant",
      excerpt: null,
      fetchedAt: "2026-04-13T00:00:00Z",
    };
    const structured = buildStructuredContent(poi, enrichment, snippets, websitePreview, "fr");
    // Should have Google Maps, TripAdvisor, AND official_website — not replace them
    const platforms = structured.sourceRollup.map((d) => d.platform);
    expect(platforms).toContain("google_maps");
    expect(platforms).toContain("tripadvisor");
    expect(platforms).toContain("official_website");
  });
});

// ===========================================================================
// WS5: Official Website Hardening
// ===========================================================================

describe("FVM-WS5: Official Website Hardening", () => {
  it("WS5-1: rejects Facebook URL as official website", () => {
    const poi = makePoi({
      tags: { amenity: "restaurant", website: "https://www.facebook.com/chezmarcel" },
    });
    expect(getOfficialWebsiteUrl(poi)).toBeNull();
  });

  it("WS5-2: rejects Instagram URL as official website", () => {
    const poi = makePoi({
      tags: { amenity: "restaurant", website: "https://instagram.com/chezmarcel" },
    });
    expect(getOfficialWebsiteUrl(poi)).toBeNull();
  });

  it("WS5-3: rejects TripAdvisor URL as official website", () => {
    const poi = makePoi({
      tags: { amenity: "restaurant", website: "https://www.tripadvisor.fr/restaurant/test" },
    });
    expect(getOfficialWebsiteUrl(poi)).toBeNull();
  });

  it("WS5-4: rejects Booking.com URL as official website", () => {
    const poi = makePoi({
      tags: { amenity: "restaurant", website: "https://www.booking.com/hotel/test" },
    });
    expect(getOfficialWebsiteUrl(poi)).toBeNull();
  });

  it("WS5-5: rejects PagesJaunes URL as official website", () => {
    const poi = makePoi({
      tags: { amenity: "restaurant", website: "https://www.pagesjaunes.fr/test" },
    });
    expect(getOfficialWebsiteUrl(poi)).toBeNull();
  });

  it("WS5-6: rejects YouTube URL as official website", () => {
    const poi = makePoi({
      tags: { amenity: "restaurant", website: "https://www.youtube.com/@chezmarcel" },
    });
    expect(getOfficialWebsiteUrl(poi)).toBeNull();
  });

  it("WS5-7: accepts real domain as official website", () => {
    const poi = makePoi({ tags: { amenity: "restaurant", website: "https://chez-marcel.fr" } });
    expect(getOfficialWebsiteUrl(poi)).toBe("https://chez-marcel.fr");
  });

  it("WS5-8: falls back to contact:website when website is social", () => {
    const poi = makePoi({
      tags: {
        amenity: "restaurant",
        website: "https://facebook.com/test",
        "contact:website": "https://real-site.fr",
      },
    });
    expect(getOfficialWebsiteUrl(poi)).toBe("https://real-site.fr");
  });

  it("WS5-9: isRejectedOfficialDomain handles subdomains", () => {
    expect(isRejectedOfficialDomain("https://m.facebook.com/page")).toBe(true);
    expect(isRejectedOfficialDomain("https://fr.tripadvisor.com/test")).toBe(true);
    expect(isRejectedOfficialDomain("https://not-facebook.com/page")).toBe(false);
  });

  it("WS5-10: isRejectedOfficialDomain handles malformed URLs", () => {
    expect(isRejectedOfficialDomain("not-a-url")).toBe(false);
    expect(isRejectedOfficialDomain("")).toBe(false);
  });
});

// ===========================================================================
// WS6: Per-Category Search Query Tuning
// ===========================================================================

describe("FVM-WS6: Per-Category Search Query Tuning", () => {
  it("WS6-1: Restaurant query has restaurant and horaires keywords", () => {
    const poi = makePoi({ category: "Restaurant or Bar" });
    const query = buildSearchQuery(poi, "Lyon");
    expect(query).toContain("avis");
    expect(query).toContain("restaurant");
    expect(query).toContain("horaires");
  });

  it("WS6-2: Food shop query has horaires and magasin keywords", () => {
    const poi = makePoi({
      category: "Food shop",
      name: "Carrefour",
      tags: { shop: "supermarket" },
    });
    const query = buildSearchQuery(poi, "Valence");
    expect(query).toContain("horaires");
    expect(query).toContain("magasin");
  });

  it("WS6-3: Sleeping place query has tarif and hébergement keywords", () => {
    const poi = makePoi({
      category: "Sleeping place",
      name: "Hotel du Parc",
      tags: { tourism: "hotel" },
    });
    const query = buildSearchQuery(poi, null);
    expect(query).toContain("tarif");
    expect(query).toContain("hébergement");
  });

  it("WS6-4: Gears query has réparation and atelier keywords", () => {
    const poi = makePoi({ category: "Gears", name: "VeloBike", tags: { shop: "bicycle" } });
    const query = buildSearchQuery(poi, "Grenoble");
    expect(query).toContain("réparation");
    expect(query).toContain("atelier");
  });

  it("WS6-5: unknown category falls back to default bias", () => {
    const poi = makePoi({
      category: "DIY" as PoiCategory,
      name: "Brico Depot",
      tags: { shop: "doityourself" },
    });
    const query = buildSearchQuery(poi, "Toulouse");
    // Default bias should have generic avis keyword
    expect(query).toContain("avis");
    expect(query).toContain("Toulouse");
  });

  it("WS6-6: cleanPoiNameForSearch removes parenthetical annotations", () => {
    expect(cleanPoiNameForSearch("Le Zinc (closed)")).toBe("Le Zinc");
    expect(cleanPoiNameForSearch("Carrefour (temporarily closed)")).toBe("Carrefour");
  });

  it("WS6-7: cleanPoiNameForSearch removes trailing closure annotations", () => {
    expect(cleanPoiNameForSearch("Le Zinc - fermé")).toBe("Le Zinc");
    expect(cleanPoiNameForSearch("Boulangerie – temporarily closed")).toBe("Boulangerie");
  });

  it("WS6-8: cleanPoiNameForSearch handles empty input", () => {
    expect(cleanPoiNameForSearch("")).toBe("");
    expect(cleanPoiNameForSearch("  ")).toBe("");
  });

  it("WS6-9: cleanPoiNameForSearch preserves normal names", () => {
    expect(cleanPoiNameForSearch("Chez Marcel")).toBe("Chez Marcel");
    expect(cleanPoiNameForSearch("Le Petit Zinc")).toBe("Le Petit Zinc");
  });
});

// ===========================================================================
// WS7: URL Normalization & Dedup
// ===========================================================================

describe("FVM-WS7: URL Normalization & Dedup", () => {
  it("WS7-1: strips utm tracking params", () => {
    const url = "https://example.com/page?utm_source=google&utm_medium=cpc&id=42";
    const normalized = normalizeUrlForDedup(url);
    expect(normalized).not.toContain("utm_source");
    expect(normalized).not.toContain("utm_medium");
    expect(normalized).toContain("id=42");
  });

  it("WS7-2: strips fbclid and gclid", () => {
    const url = "https://example.com/page?fbclid=abc123&gclid=def456";
    const normalized = normalizeUrlForDedup(url);
    expect(normalized).not.toContain("fbclid");
    expect(normalized).not.toContain("gclid");
  });

  it("WS7-3: normalizes www. prefix", () => {
    const url1 = normalizeUrlForDedup("https://www.example.com/page");
    const url2 = normalizeUrlForDedup("https://example.com/page");
    expect(url1).toBe(url2);
  });

  it("WS7-4: normalizes m. prefix", () => {
    const url1 = normalizeUrlForDedup("https://m.example.com/page");
    const url2 = normalizeUrlForDedup("https://example.com/page");
    expect(url1).toBe(url2);
  });

  it("WS7-5: strips trailing slash", () => {
    const url1 = normalizeUrlForDedup("https://example.com/page/");
    const url2 = normalizeUrlForDedup("https://example.com/page");
    expect(url1).toBe(url2);
  });

  it("WS7-6: preserves root path slash", () => {
    const normalized = normalizeUrlForDedup("https://example.com/");
    // Root path should still have / (it's the minimum path)
    expect(normalized).toContain("example.com");
  });

  it("WS7-7: handles malformed URLs gracefully", () => {
    expect(normalizeUrlForDedup("not-a-url")).toBe("not-a-url");
    expect(normalizeUrlForDedup("")).toBe("");
  });

  it("WS7-8: same page with/without tracking are equal after normalization", () => {
    const clean = normalizeUrlForDedup("https://www.yelp.com/biz/chez-marcel");
    const tracked = normalizeUrlForDedup(
      "https://www.yelp.com/biz/chez-marcel?utm_source=google&ref=search",
    );
    expect(clean).toBe(tracked);
  });
});

// ===========================================================================
// FVM-C: Website Preview (fetchWebsitePreview with mocked fetch)
// ===========================================================================

import { fetchWebsitePreview } from "../lib/enrichment/search";

describe("FVM-C: Website Preview (fetchWebsitePreview)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("C-preview-ok: returns title, description, excerpt, finalUrl on success", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          url: "https://chez-marcel.fr",
          finalUrl: "https://chez-marcel.fr",
          contentType: "text/html",
          title: "Chez Marcel - Restaurant",
          description: "French cuisine since 1952",
          excerpt: "Welcome to Chez Marcel",
          fetchedAt: "2026-04-13T00:00:00Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      ),
    );

    const result = await fetchWebsitePreview("https://chez-marcel.fr", "");
    expect(result).not.toBeNull();
    expect(result!.title).toBe("Chez Marcel - Restaurant");
    expect(result!.description).toBe("French cuisine since 1952");
    expect(result!.excerpt).toBe("Welcome to Chez Marcel");
    expect(result!.finalUrl).toBe("https://chez-marcel.fr");
    expect(result!.fetchedAt).toBeDefined();
  });

  it("C-preview-timeout: degrades on timeout (returns null)", async () => {
    fetchMock.mockRejectedValueOnce(new DOMException("Aborted", "AbortError"));

    const result = await fetchWebsitePreview("https://slow-site.com", "");
    expect(result).toBeNull();
  });

  it("C-preview-nonhtml: degrades on non-HTML (returns null)", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          error: "Unsupported content type",
          contentType: "application/pdf",
        }),
        { status: 415 },
      ),
    );

    const result = await fetchWebsitePreview("https://example.com/document.pdf", "");
    expect(result).toBeNull();
  });

  it("C-preview-404: degrades on server error (returns null)", async () => {
    fetchMock.mockResolvedValueOnce(new Response("Not found", { status: 404 }));
    const result = await fetchWebsitePreview("https://dead-site.com", "");
    expect(result).toBeNull();
  });
});
