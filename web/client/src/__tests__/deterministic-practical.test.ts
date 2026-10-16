// --- Deterministic season, prices and booking from snippets: the no-LLM path ---

import { describe, expect, it } from "vitest";
import {
  extractDeterministicBooking,
  extractDeterministicPriceNote,
  extractDeterministicSeason,
} from "../lib/enrichment/deterministic";
import type { SearchSnippet } from "../types";

function snippet(content: string, engine = "page"): SearchSnippet {
  return { title: "t", url: "https://example.com/p", content, engine };
}

describe("extractDeterministicSeason", () => {
  it("finds a date range in any supported language", () => {
    expect(
      extractDeterministicSeason([
        snippet("Le refuge sera ouvert et gardé du 6 juin au 28 septembre 2026."),
      ]),
    ).toBe("6 juin au 28 septembre");
    expect(extractDeterministicSeason([snippet("Open from June 6 to September 28.")])).toBe(
      "June 6 to September 28",
    );
    expect(extractDeterministicSeason([snippet("Geöffnet vom 1. Juni bis 30. September.")])).toBe(
      "1. Juni bis 30. September",
    );
  });

  it("returns null without a date range", () => {
    expect(extractDeterministicSeason([snippet("Open daily 09:00-18:00.")])).toBeNull();
  });
});

describe("extractDeterministicPriceNote", () => {
  it("keeps up to three amounts with their few words of context", () => {
    const note = extractDeterministicPriceNote([
      snippet("Tarifs 2026 : nuitée 21,00 € (adhérent 10,50 €), demi-pension 55 €, repas 24 €."),
    ]);
    expect(note).toBe("nuitée 21,00 €, adhérent 10,50 €, demi-pension 55 €");
  });

  it("handles currency-first amounts and returns null without any", () => {
    expect(extractDeterministicPriceNote([snippet("Bunk beds from $35 per night.")])).toBe(
      "Bunk beds from $35",
    );
    expect(extractDeterministicPriceNote([snippet("A quiet place by the lake.")])).toBeNull();
  });
});

describe("extractDeterministicBooking", () => {
  it("reads explicit booking statements in several languages", () => {
    expect(extractDeterministicBooking([snippet("Réservation obligatoire en ligne.")])).toBe(
      "required",
    );
    expect(extractDeterministicBooking([snippet("Booking is recommended in summer.")])).toBe(
      "recommended",
    );
    expect(extractDeterministicBooking([snippet("Nur mit Reservierung.")])).toBe("required");
    expect(extractDeterministicBooking([snippet("Walk-ins welcome, no booking needed.")])).toBe(
      "not_needed",
    );
  });

  it("stays silent otherwise", () => {
    expect(extractDeterministicBooking([snippet("Great views and a warm welcome.")])).toBeNull();
  });
});
