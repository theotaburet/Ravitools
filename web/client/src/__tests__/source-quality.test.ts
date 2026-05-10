// ---------------------------------------------------------------------------
// Tests for rankSnippetsByQuality and extractStructuredHoursFromSnippets
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { rankSnippetsByQuality, extractStructuredHoursFromSnippets } from "../lib/enrichment";
import type { SearchSnippet } from "../types";

function snippet(url: string, content = "some content about the place"): SearchSnippet {
  return { url, title: "Title", content, engine: "test" };
}

// ---------------------------------------------------------------------------
// rankSnippetsByQuality
// ---------------------------------------------------------------------------

describe("rankSnippetsByQuality", () => {
  it("returns empty array for empty input", () => {
    expect(rankSnippetsByQuality([])).toEqual([]);
  });

  it("removes noise snippets (Twitter, LinkedIn)", () => {
    const snippets = [
      snippet("https://twitter.com/place"),
      snippet("https://linkedin.com/company/place"),
      snippet("https://tripadvisor.com/Restaurant-place"),
    ];
    const result = rankSnippetsByQuality(snippets);
    expect(result).toHaveLength(1);
    expect(result[0].url).toContain("tripadvisor");
  });

  it("places tripadvisor before generic web", () => {
    const snippets = [
      snippet("https://example-blog.com/place-review"),
      snippet("https://tripadvisor.com/Restaurant-place"),
    ];
    const result = rankSnippetsByQuality(snippets);
    expect(result[0].url).toContain("tripadvisor");
  });

  it("places booking.com before facebook", () => {
    const snippets = [
      snippet("https://facebook.com/theplace"),
      snippet("https://booking.com/hotel/place.html"),
    ];
    const result = rankSnippetsByQuality(snippets);
    expect(result[0].url).toContain("booking.com");
  });

  it("within same score, longer content ranks first", () => {
    const snippets = [
      snippet("https://yelp.com/place-a", "short"),
      snippet("https://yelp.com/place-b", "much longer content with lots of details about the place"),
    ];
    const result = rankSnippetsByQuality(snippets);
    expect(result[0].url).toContain("place-b");
  });

  it("keeps all valid snippets when none are noise", () => {
    const snippets = [
      snippet("https://tripadvisor.com/a"),
      snippet("https://booking.com/a"),
      snippet("https://example.com/a"),
    ];
    expect(rankSnippetsByQuality(snippets)).toHaveLength(3);
  });

  it("removes banking/spam noise snippets", () => {
    const snippets = [
      snippet("https://myunicredit-banking.com/login"),
      snippet("https://tripadvisor.com/place"),
    ];
    const result = rankSnippetsByQuality(snippets);
    expect(result).toHaveLength(1);
    expect(result[0].url).toContain("tripadvisor");
  });
});

// ---------------------------------------------------------------------------
// extractStructuredHoursFromSnippets
// ---------------------------------------------------------------------------

describe("extractStructuredHoursFromSnippets", () => {
  it("returns null for empty snippets", () => {
    expect(extractStructuredHoursFromSnippets([])).toBeNull();
  });

  it("returns null when fewer than 2 days found", () => {
    const snippets = [snippet("https://x.com", "Open Monday 08:00-18:00")];
    expect(extractStructuredHoursFromSnippets(snippets)).toBeNull();
  });

  it("extracts Mon-Fri hours in English", () => {
    const content = "Monday 09:00-17:00, Tuesday 09:00-17:00, Wednesday 09:00-17:00";
    const result = extractStructuredHoursFromSnippets([snippet("https://x.com", content)]);
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThanOrEqual(3);
    const mon = result!.find((e) => e.day === "Mon");
    expect(mon?.open).toBe("09:00");
    expect(mon?.close).toBe("17:00");
  });

  it("extracts French day names", () => {
    const content = "Lundi 08h30-19h00, Mardi 08h30-19h00, Mercredi 08h30-19h00";
    const result = extractStructuredHoursFromSnippets([snippet("https://x.com", content)]);
    expect(result).not.toBeNull();
    const mon = result!.find((e) => e.day === "Mon");
    expect(mon?.open).toBe("08:30");
    expect(mon?.close).toBe("19:00");
  });

  it("handles abbreviated day names (mon, tue, wed)", () => {
    const content = "Mon 10:00-20:00, Tue 10:00-20:00, Wed 10:00-20:00";
    const result = extractStructuredHoursFromSnippets([snippet("https://x.com", content)]);
    expect(result).not.toBeNull();
    expect(result!.length).toBeGreaterThanOrEqual(3);
  });

  it("marks closed days", () => {
    const content = "Lundi 08:00-18:00, Mardi 08:00-18:00, fermé le dimanche";
    const result = extractStructuredHoursFromSnippets([snippet("https://x.com", content)]);
    expect(result).not.toBeNull();
    const sun = result!.find((e) => e.day === "Sun");
    expect(sun?.open).toBe("closed");
  });

  it("sorts days Mon→Sun", () => {
    const content = "Sunday 09:00-17:00, Friday 08:00-20:00, Monday 08:00-18:00";
    const result = extractStructuredHoursFromSnippets([snippet("https://x.com", content)]);
    expect(result).not.toBeNull();
    const days = result!.map((e) => e.day);
    expect(days.indexOf("Mon")).toBeLessThan(days.indexOf("Fri"));
    expect(days.indexOf("Fri")).toBeLessThan(days.indexOf("Sun"));
  });

  it("deduplicates the same day from multiple snippets", () => {
    const s1 = snippet("https://a.com", "Monday 08:00-18:00, Tuesday 09:00-17:00");
    const s2 = snippet("https://b.com", "Monday 10:00-20:00, Wednesday 07:00-15:00");
    const result = extractStructuredHoursFromSnippets([s1, s2]);
    expect(result).not.toBeNull();
    // Monday should appear only once (first occurrence wins)
    const monEntries = result!.filter((e) => e.day === "Mon");
    expect(monEntries).toHaveLength(1);
    expect(monEntries[0].open).toBe("08:00"); // first occurrence
  });
});
