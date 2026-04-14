// ---------------------------------------------------------------------------
// Tests for session persistence (WS7)
// ---------------------------------------------------------------------------

// @vitest-environment jsdom

import { describe, it, expect, beforeEach, vi } from "vitest";
import type { POI, EnrichedData, PoiCategory } from "../types";
import { saveSession, loadSession, clearSession, hasSession } from "../lib/session";

// ---------------------------------------------------------------------------
// localStorage polyfill – Node v25 ships a broken globalThis.localStorage
// (getItem exists but setItem is undefined). We replace it with a proper
// in-memory implementation so the session helpers work correctly.
// ---------------------------------------------------------------------------

function createStorage(): Storage {
  let store: Record<string, string> = {};
  return {
    get length() {
      return Object.keys(store).length;
    },
    key(index: number) {
      return Object.keys(store)[index] ?? null;
    },
    getItem(key: string) {
      return key in store ? store[key] : null;
    },
    setItem(key: string, value: string) {
      store[key] = String(value);
    },
    removeItem(key: string) {
      delete store[key];
    },
    clear() {
      store = {};
    },
  };
}

// Install before any test runs
const fakeStorage = createStorage();
Object.defineProperty(globalThis, "localStorage", {
  value: fakeStorage,
  writable: true,
  configurable: true,
});

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makePoi(id: string, category: PoiCategory = "Restaurant or Bar"): POI {
  return {
    id,
    lat: 47.3941,
    lon: 0.6848,
    category,
    name: `POI ${id}`,
    icon: "utensils",
    distanceToTrace: 120,
    alongTraceDistance: 5000,
    tags: { amenity: "restaurant" },
    style: {
      iconShape: "circle",
      borderColor: "#FFFFFF",
      borderWidth: "2",
      textColor: "#FFFFFF",
      backgroundColor: "#FF6B35",
    },
  };
}

function makeEnrichment(): EnrichedData {
  return {
    rating: 4.2,
    reviewCount: 87,
    hours: "Mon-Fri 12:00-14:00",
    openingHours: null,
    description: "Good place.",
    review: "Bon endroit.",
    summary: "Good place.",
    translatedSummary: "Bon endroit.",
    specialty: "French",
    priceLevel: 2,
    googleMapsUrl: "https://maps.google.com",
    sourceUrls: ["https://example.com"],
    rawSnippets: [{ title: "R", url: "https://example.com", content: "Good", engine: "google" }],
    enrichedAt: "2026-04-13T00:00:00Z",
    status: "done",
    locality: "Tours",
    sourceCount: 1,
    sourceEngines: ["google"],
    confidence: 0.42,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("session persistence", () => {
  beforeEach(() => {
    fakeStorage.clear();
  });

  it("hasSession returns false when no session saved", () => {
    expect(hasSession()).toBe(false);
  });

  it("hasSession returns true after saving a session", () => {
    saveSession({
      activeCategories: new Set(["Restaurant or Bar"] as PoiCategory[]),
      traces: [],
      pois: [],
      enrichments: new Map(),
      targetLanguage: "en",
      enrichAll: false,
      routeSettings: { maxDistanceM: 1500 },
    });
    expect(hasSession()).toBe(true);
  });

  it("saves and loads a session with POIs and enrichments", () => {
    const pois = [makePoi("a"), makePoi("b")];
    const enrichments = new Map<string, EnrichedData>([
      ["a", makeEnrichment()],
    ]);

    saveSession({
      activeCategories: new Set(["Restaurant or Bar", "Water"] as PoiCategory[]),
      traces: [],
      pois,
      enrichments,
      targetLanguage: "fr",
      enrichAll: true,
      routeSettings: { maxDistanceM: 900 },
    });

    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded!.pois).toHaveLength(2);
    expect(loaded!.pois[0].id).toBe("a");
    expect(loaded!.enrichments.size).toBe(1);
    expect(loaded!.enrichments.get("a")!.rating).toBe(4.2);
    expect(loaded!.activeCategories.has("Restaurant or Bar")).toBe(true);
    expect(loaded!.activeCategories.has("Water")).toBe(true);
    expect(loaded!.targetLanguage).toBe("fr");
    expect(loaded!.enrichAll).toBe(true);
    expect(loaded!.routeSettings.maxDistanceM).toBe(900);
    expect(loaded!.savedAt).toBeTruthy();
  });

  it("preserves Set semantics for activeCategories", () => {
    saveSession({
      activeCategories: new Set(["Water", "DIY", "Water"] as PoiCategory[]),
      traces: [],
      pois: [],
      enrichments: new Map(),
      targetLanguage: "en",
      enrichAll: false,
      routeSettings: { maxDistanceM: 1500 },
    });

    const loaded = loadSession();
    expect(loaded!.activeCategories).toBeInstanceOf(Set);
    expect(loaded!.activeCategories.size).toBe(2);
  });

  it("preserves Map semantics for enrichments", () => {
    const enrichments = new Map<string, EnrichedData>([
      ["x", makeEnrichment()],
      ["y", makeEnrichment()],
    ]);

    saveSession({
      activeCategories: new Set<PoiCategory>(),
      traces: [],
      pois: [],
      enrichments,
      targetLanguage: "en",
      enrichAll: false,
      routeSettings: { maxDistanceM: 1500 },
    });

    const loaded = loadSession();
    expect(loaded!.enrichments).toBeInstanceOf(Map);
    expect(loaded!.enrichments.size).toBe(2);
  });

  it("clearSession removes saved data", () => {
    saveSession({
      activeCategories: new Set<PoiCategory>(),
      traces: [],
      pois: [makePoi("z")],
      enrichments: new Map(),
      targetLanguage: "en",
      enrichAll: false,
      routeSettings: { maxDistanceM: 1500 },
    });

    expect(hasSession()).toBe(true);
    clearSession();
    expect(hasSession()).toBe(false);
    expect(loadSession()).toBeNull();
  });

  it("returns null for corrupt data", () => {
    localStorage.setItem("ravitools_session", "not-valid-json{{{");
    expect(loadSession()).toBeNull();
    // Should have been cleared
    expect(hasSession()).toBe(false);
  });

  it("returns null and clears for wrong schema version", () => {
    const fakeData = {
      version: 999,
      savedAt: new Date().toISOString(),
      activeCategories: [],
      trace: null,
      pois: [],
      enrichments: [],
      targetLanguage: "en",
      enrichAll: false,
      routeSettings: { maxDistanceM: 1500 },
    };
    localStorage.setItem("ravitools_session", JSON.stringify(fakeData));
    expect(loadSession()).toBeNull();
    expect(hasSession()).toBe(false);
  });

  it("returns null for missing required fields", () => {
    const fakeData = {
      version: 3,
      savedAt: new Date().toISOString(),
      activeCategories: [],
      traces: [],
      // pois missing
      enrichments: [],
    };
    localStorage.setItem("ravitools_session", JSON.stringify(fakeData));
    expect(loadSession()).toBeNull();
  });

  it("saves with trace metadata", () => {
    const trace = {
      id: "trace_1",
      original: [{ lat: 47.0, lon: 0.6 }, { lat: 47.1, lon: 0.7 }],
      simplified: [{ lat: 47.0, lon: 0.6 }],
      totalDistanceM: 12345,
      elevationGainM: 500,
      elevationLossM: 300,
      name: "Test Route",
      color: "#1a1a1a",
    };

    saveSession({
      activeCategories: new Set<PoiCategory>(),
      traces: [trace],
      pois: [],
      enrichments: new Map(),
      targetLanguage: "en",
      enrichAll: false,
      routeSettings: { maxDistanceM: 1500 },
    });

    const loaded = loadSession();
    expect(loaded!.traces).toHaveLength(1);
    expect(loaded!.traces[0].name).toBe("Test Route");
    expect(loaded!.traces[0].totalDistanceM).toBe(12345);
    expect(loaded!.traces[0].original).toHaveLength(2);
    expect(loaded!.traces[0].id).toBe("trace_1");
    expect(loaded!.traces[0].color).toBe("#1a1a1a");
  });
});
