// --- Country language, query words and evidence windows: generic, not French-first ---

import { describe, expect, it } from "vitest";
import {
  buildEvidenceSnippets,
  extractEvidence,
  focusOnName,
  pickHopLinks,
} from "../lib/enrichment/evidence";
import { buildSearchQuery } from "../lib/enrichment/query-builder";
import { languageForCountry } from "../lib/enrichment/vocabulary";
import { makePoi } from "./enrichment-helpers";

describe("languageForCountry", () => {
  it("maps the geocoded country to a search language, English elsewhere", () => {
    expect(languageForCountry("fr")).toBe("fr");
    expect(languageForCountry("be")).toBe("fr");
    expect(languageForCountry("ch")).toBe("de");
    expect(languageForCountry("AT")).toBe("de");
    expect(languageForCountry("it")).toBe("it");
    expect(languageForCountry("mx")).toBe("es");
    expect(languageForCountry("br")).toBe("pt");
    expect(languageForCountry("nl")).toBe("nl");
    expect(languageForCountry("jp")).toBe("en");
    expect(languageForCountry(null)).toBe("en");
  });
});

describe("buildSearchQuery by language", () => {
  it("uses English words by default", () => {
    const query = buildSearchQuery(makePoi(), "Kyoto");
    expect(query).toContain("reviews");
    expect(query).toContain("restaurant");
    expect(query).toContain("opening hours");
    expect(query).not.toContain("avis");
  });

  it("uses the country's words: German restaurant, Italian lodging, English shop", () => {
    expect(buildSearchQuery(makePoi(), "Wien", "de")).toContain(
      "Bewertungen Restaurant Öffnungszeiten",
    );
    expect(
      buildSearchQuery(makePoi({ category: "Sleeping place", name: "Rifugio" }), "Trento", "it"),
    ).toContain("recensioni alloggio prezzi");
    expect(
      buildSearchQuery(makePoi({ category: "Food shop", name: "Tesco" }), "Leeds", "en"),
    ).toContain("opening hours shop reviews");
  });

  it("keeps the historical French words for France", () => {
    expect(buildSearchQuery(makePoi(), "Lyon", "fr")).toContain("avis restaurant horaires");
    expect(
      buildSearchQuery(makePoi({ category: "Gears", name: "Cycles Dupont" }), null, "fr"),
    ).toContain("avis atelier vélo réparation");
  });
});

describe("pickHopLinks", () => {
  const base = "https://refuge.example/home.html";
  const links = [
    { text: "Accueil", href: "https://refuge.example/home.html" },
    { text: "Réserver", href: "https://refuge.example/reservation.html" },
    { text: "Tarifs", href: "https://refuge.example/tarifs.html" },
    { text: "Accès", href: "https://refuge.example/acces.html" },
    { text: "Mentions légales", href: "https://refuge.example/mentions_legales.html" },
    { text: "Prices", href: "https://booking.example/prices" },
    { text: "Contact", href: "https://refuge.example/contact.html" },
  ];

  it("follows prices, then booking, on the same host only, two pages at most", () => {
    expect(pickHopLinks(links, base)).toEqual([
      "https://refuge.example/tarifs.html",
      "https://refuge.example/reservation.html",
    ]);
  });

  it("understands other languages and URL slugs, and skips legal pages", () => {
    const picked = pickHopLinks(
      [
        { text: "Impressum", href: "https://hut.example/impressum" },
        { text: "Öffnungszeiten", href: "https://hut.example/zeiten" },
        { text: "", href: "https://hut.example/en/opening-hours" },
        { text: "Coffee", href: "https://hut.example/coffee" },
      ],
      "https://hut.example/",
    );
    expect(picked).toEqual(["https://hut.example/zeiten", "https://hut.example/en/opening-hours"]);
  });
});

describe("extractEvidence", () => {
  const text =
    "Refuge de la Valmasque FFCAM Menu Accueil Réserver. Le refuge sera ouvert et gardé du 6 juin au 28 septembre 2026. " +
    "Une longue description du paysage sans aucun chiffre, des lacs, des roches et du gazon ras, rien de pratique ici. ".repeat(
      6,
    ) +
    "Tarifs 2026 : nuitée 21,00 € (adhérent 10,50 €), demi-pension 55 €. " +
    "Autre texte sans intérêt sur l'histoire du club alpin et de la vallée. ".repeat(6) +
    "Accueil du gardien de 08:30 à 18:30, tél. +33 4 93 04 87 71.";

  it("returns windows around money, hours, phones and date ranges, best first", () => {
    const windows = extractEvidence(text, 3);
    expect(windows).toHaveLength(3);
    expect(windows.join(" ")).toMatch(/21,00 €/);
    expect(windows.join(" ")).toMatch(/08:30 à 18:30/);
    expect(windows.join(" ")).toMatch(/6 juin au 28 septembre/);
    for (const w of windows) expect(w.length).toBeLessThanOrEqual(320);
  });

  it("reads opening ranges but not hiking durations", () => {
    expect(extractEvidence("Ouvert tous les jours de 9h à 18h en été.")).toHaveLength(1);
    expect(extractEvidence("Open 9 AM to 6:30 PM, Monday to Saturday.")).toHaveLength(1);
    expect(
      extractEvidence("À la balise 374 (1h10), la piste devient sentier. La descente a duré 1h45."),
    ).toEqual([]);
  });

  it("returns nothing for prose without practical facts", () => {
    expect(extractEvidence("A lovely place with a view of the lake and the peaks.")).toEqual([]);
  });

  it("turns pages into official-site snippets with provenance", () => {
    const snippets = buildEvidenceSnippets([
      { title: "Tarifs", url: "https://refuge.example/tarifs.html", text },
    ]);
    expect(snippets).toHaveLength(3);
    for (const snippet of snippets) {
      expect(snippet).toMatchObject({
        engine: "official_website",
        url: "https://refuge.example/tarifs.html",
        title: "Tarifs",
      });
    }
    // Richest window first: hours plus phone beats a lone price
    expect(snippets[0].content).toMatch(/08:30 à 18:30/);
    expect(snippets.map((s) => s.content).join(" ")).toMatch(/€/);
  });
});

describe("focusOnName", () => {
  const filler = "Texte sans rapport sur la randonnée et le paysage. ".repeat(20);
  const text =
    `REFUGE ALBERT 1ER (FFCAM) Mont-Blanc 140 places Tel : +33 4 50 54 06 20. ${filler}` +
    `REFUGE DE LA VALMASQUE (FFCAM) Mercantour 52 places Tel : +33 4 93 04 87 71. ${filler}` +
    "Refuge du Lac Vert, 30 places.";

  it("keeps only the text around mentions of the place, accents and case aside", () => {
    const focused = focusOnName(text, "Refuge de la Valmasque", 120);
    expect(focused).toMatch(/\+33 4 93 04 87 71/);
    expect(focused).not.toMatch(/\+33 4 50 54 06 20/);
  });

  it("tolerates singular and plural, and gives up when the place is never named", () => {
    expect(focusOnName("Chez Pierrot Sport, ouvert 08:30 à 18:30.", "Pierrot Sports")).toMatch(
      /08:30/,
    );
    expect(focusOnName(text, "Gîte des Mélèzes")).toBeNull();
  });

  it("keeps the whole text for a generic name that cannot anchor anything", () => {
    expect(focusOnName("Fontaine, eau potable.", "Camping")).toBe("Fontaine, eau potable.");
  });
});
