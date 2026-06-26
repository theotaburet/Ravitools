import { describe, it, expect } from "vitest";
import { computeConfidence } from "../lib/enrichment/enricher";

// AUDIT C9: an authoritative (official-website) result should beat a pile of
// mediocre snippets, instead of raw snippet count dominating the score.
describe("computeConfidence weighting (AUDIT C9)", () => {
  const snippet = (engine: string, url: string, content = "") => ({ engine, url, content });

  const manySnippetsNoOfficial = {
    rawSnippets: Array.from({ length: 8 }, (_, i) => snippet("bing", "https://aggregator.example/x")),
    rating: null,
    reviewCount: null,
    hours: null,
    description: null,
    review: null,
    officialWebsite: null,
    structured: null,
  };

  const fewSnippetsWithOfficial = {
    rawSnippets: [snippet("bing", "https://a.example"), snippet("presearch", "https://b.example")],
    rating: 4.5,
    reviewCount: null,
    hours: "Mo-Fr 09:00-18:00",
    description: null,
    review: null,
    officialWebsite: { url: "https://official.example" },
    structured: null,
  };

  it("ranks an official, field-rich result above many no-official snippets", () => {
    expect(computeConfidence(fewSnippetsWithOfficial)).toBeGreaterThan(
      computeConfidence(manySnippetsNoOfficial),
    );
  });

  it("caps the raw snippet contribution at 0.25", () => {
    // 8 identical no-everything snippets: only sourceFactor(0.25) + diversity(0.05) + 1 domain quality(0.025)
    expect(computeConfidence(manySnippetsNoOfficial)).toBeLessThanOrEqual(0.33);
  });
});
