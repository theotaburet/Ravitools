// --- Official site: homepage, one hop to the useful pages, evidence snippets, slim preview ---

import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOfficialSite, readSearchPages } from "../lib/enrichment/websites";
import type { SearchSnippet, WebsitePreview } from "../types";
import { makePoi } from "./enrichment-helpers";

const REFUGE = makePoi({ name: "Refuge de la Valmasque", category: "Sleeping place" });

function page(partial: Partial<WebsitePreview> & { url: string }): WebsitePreview {
  return {
    finalUrl: partial.url,
    title: null,
    description: null,
    excerpt: null,
    structuredData: null,
    fetchedAt: "2026-10-11T00:00:00Z",
    ...partial,
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("fetchOfficialSite", () => {
  it("reads the homepage, follows the prices page, and keeps a slim preview", async () => {
    const pages: Record<string, WebsitePreview> = {
      "https://refuge.example/": page({
        url: "https://refuge.example/",
        title: "Accueil, Refuge Test",
        excerpt: "Menu Réserver Tarifs Accès",
        text: "Menu Réserver Tarifs Accès. Ouvert du 6 juin au 28 septembre 2026.",
        links: [
          { text: "Tarifs", href: "https://refuge.example/tarifs.html" },
          { text: "Mentions légales", href: "https://refuge.example/mentions.html" },
        ],
      }),
      "https://refuge.example/tarifs.html": page({
        url: "https://refuge.example/tarifs.html",
        title: "Tarifs, Refuge Test",
        text: "Tarifs 2026 : nuitée 21,00 €, demi-pension 55 €, repas 24 €.",
      }),
    };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const { url } = JSON.parse(String(init?.body)) as { url: string };
      const body = pages[url];
      return new Response(JSON.stringify(body ?? { error: "404" }), { status: body ? 200 : 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const { preview, snippets } = await fetchOfficialSite("https://refuge.example/");

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(preview?.title).toBe("Accueil, Refuge Test");
    expect(preview).not.toHaveProperty("text");
    expect(preview).not.toHaveProperty("links");
    expect(snippets.every((s) => s.engine === "official_website")).toBe(true);
    expect(snippets.map((s) => s.content).join(" ")).toMatch(/21,00 €/);
    expect(snippets.map((s) => s.content).join(" ")).toMatch(/6 juin au 28 septembre/);
    expect(snippets.find((s) => /21,00/.test(s.content))?.url).toBe(
      "https://refuge.example/tarifs.html",
    );
  });

  it("returns nothing when the homepage cannot be fetched", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 502 })),
    );
    expect(await fetchOfficialSite("https://down.example/")).toEqual({
      preview: null,
      snippets: [],
    });
  });
});

describe("readSearchPages", () => {
  const snip = (url: string, engine = "bing"): SearchSnippet => ({
    title: url,
    url,
    content: "x",
    engine,
  });

  it("reads two pages behind the best results, skipping the official site, rejected platforms, duplicates and files", async () => {
    const pages: Record<string, WebsitePreview> = {
      "https://visorando.example/a": page({
        url: "https://visorando.example/a",
        title: "Rando",
        text: "Refuge de la Valmasque ouvert du 6 juin au 28 septembre, nuitée 21,00 €.",
      }),
      "https://ffcam.example/refuge": page({
        url: "https://ffcam.example/refuge",
        title: "FFCAM",
        text:
          `Refuge Albert 1er, 140 places, tél +33 4 50 54 06 20. ${"Autre texte. ".repeat(80)}` +
          "Refuge de la Valmasque : demi-pension 55 €, réservation obligatoire, tél +33 4 93 04 87 71.",
      }),
    };
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const { url } = JSON.parse(String(init?.body)) as { url: string };
      const body = pages[url];
      return new Response(JSON.stringify(body ?? { error: "404" }), { status: body ? 200 : 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const snippets = await readSearchPages(
      REFUGE,
      [
        snip("https://refuge.example/tarifs.html", "official_website"),
        snip("https://www.tripadvisor.fr/Hotel_Review-x"),
        snip("https://visorando.example/a"),
        snip("https://visorando.example/b", "yandex"),
        snip("https://refuge.example/other"),
        snip("https://cdn.example/brochure.pdf"),
        snip("https://ffcam.example/refuge", "duckduckgo"),
        snip("https://third.example/c", "brave"),
      ],
      "https://refuge.example/",
    );

    expect(
      fetchMock.mock.calls.map((c) => JSON.parse(String((c[1] as RequestInit).body)).url),
    ).toEqual(["https://visorando.example/a", "https://ffcam.example/refuge"]);
    expect(snippets.length).toBeGreaterThan(0);
    expect(snippets.every((s) => s.engine === "page")).toBe(true);
    expect(snippets.map((s) => s.url)).toContain("https://ffcam.example/refuge");
    expect(snippets.map((s) => s.content).join(" ")).toMatch(/55 €/);
    // Facts about another refuge on the same page stay out
    expect(snippets.map((s) => s.content).join(" ")).not.toMatch(/\+33 4 50 54 06 20/);
  });

  it("ignores a page that never names the place", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify(
              page({
                url: "https://other.example/list",
                title: "List",
                text: "Refuge du Lac Vert, 30 places, nuitée 18 €.",
              }),
            ),
            { status: 200 },
          ),
      ),
    );
    expect(await readSearchPages(REFUGE, [snip("https://other.example/list")], null)).toEqual([]);
  });
});
