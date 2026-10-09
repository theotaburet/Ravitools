import { describe, expect, it } from "vitest";
import { mentionsPoiName } from "../lib/enrichment/snippet-filters";
import type { POI } from "../types";

const poi = (name: string): POI => ({ name }) as unknown as POI;
const snippet = (title: string, content: string) => ({ title, content });

describe("mentionsPoiName", () => {
  it("drops portal homepages that never name the place", () => {
    const booking = snippet(
      "Booking.com | Site officiel | Hôtels, vols, voitures de location",
      "Avec Booking.com, économisez sur les hôtels, maisons, vols, voitures de location, taxis et attractions.",
    );
    expect(mentionsPoiName(booking, poi("Hôtel Restaurant La Rua"))).toBe(false);
  });

  it("keeps a snippet naming the place, accents and case ignored", () => {
    const yandex = snippet(
      "Hôtel La Rua, Albiez (2026)",
      "Le Bar – Hôtel – Restaurant La Rua à Albiez-Montrond",
    );
    expect(mentionsPoiName(yandex, poi("Hôtel Restaurant La Rua"))).toBe(true);
    expect(
      mentionsPoiName(snippet("ETCHEVERRY boulangerie", ""), poi("Boulangerie Etcheverry")),
    ).toBe(true);
  });

  it("cannot judge a name made only of generic words, so it keeps the snippet", () => {
    expect(mentionsPoiName(snippet("Booking.com", "hotels"), poi("Le Bar"))).toBe(true);
    expect(mentionsPoiName(snippet("Dictionnaire", "définition"), poi("Boulangerie"))).toBe(true);
  });
});
