// ---------------------------------------------------------------------------
// Tests for parseLlmOutput – pure function, no mocks needed
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { parseLlmOutput } from "../lib/enrichment/llm";

describe("parseLlmOutput", () => {
  // -------------------------------------------------------------------------
  // Happy path – clean JSON
  // -------------------------------------------------------------------------

  it("parses a well-formed JSON object", () => {
    const input = JSON.stringify({
      rating: 4.2,
      reviewCount: 87,
      hours: "Mon-Fri 12:00-14:00",
      summary: "Excellent French bistro.",
      translatedSummary: "Excellent bistrot français.",
      specialty: "French bistro",
      priceLevel: 2,
    });
    const result = parseLlmOutput(input);
    expect(result).not.toBeNull();
    expect(result!.rating).toBe(4.2);
    expect(result!.reviewCount).toBe(87);
    expect(result!.hours).toBe("Mon-Fri 12:00-14:00");
    expect(result!.summary).toBe("Excellent French bistro.");
    expect(result!.translatedSummary).toBe("Excellent bistrot français.");
    expect(result!.specialty).toBe("French bistro");
    expect(result!.priceLevel).toBe(2);
  });

  it("returns all nulls when all fields are null", () => {
    const input = JSON.stringify({
      rating: null,
      reviewCount: null,
      hours: null,
      summary: null,
      translatedSummary: null,
      specialty: null,
      priceLevel: null,
    });
    const result = parseLlmOutput(input);
    expect(result).not.toBeNull();
    expect(result!.rating).toBeNull();
    expect(result!.reviewCount).toBeNull();
    expect(result!.hours).toBeNull();
    expect(result!.summary).toBeNull();
    expect(result!.translatedSummary).toBeNull();
    expect(result!.specialty).toBeNull();
    expect(result!.priceLevel).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Markdown code block stripping
  // -------------------------------------------------------------------------

  it("strips ```json wrapper", () => {
    const json = JSON.stringify({
      rating: 3.5,
      reviewCount: 10,
      hours: null,
      summary: "Nice.",
      translatedSummary: null,
      specialty: null,
      priceLevel: 1,
    });
    const input = "```json\n" + json + "\n```";
    const result = parseLlmOutput(input);
    expect(result).not.toBeNull();
    expect(result!.rating).toBe(3.5);
    expect(result!.priceLevel).toBe(1);
  });

  it("strips ``` wrapper without language tag", () => {
    const json = JSON.stringify({
      rating: 5,
      reviewCount: null,
      hours: null,
      summary: "Perfect.",
      translatedSummary: null,
      specialty: null,
      priceLevel: null,
    });
    const input = "```\n" + json + "\n```";
    const result = parseLlmOutput(input);
    expect(result).not.toBeNull();
    expect(result!.rating).toBe(5);
    expect(result!.summary).toBe("Perfect.");
  });

  // -------------------------------------------------------------------------
  // JSON extraction from mixed text
  // -------------------------------------------------------------------------

  it("extracts JSON from surrounding text", () => {
    const input = `Here is the information:
{"rating": 4.0, "reviewCount": 50, "hours": "9-17", "summary": "Good café.", "translatedSummary": null, "specialty": "Coffee", "priceLevel": 2}
I hope this helps!`;
    const result = parseLlmOutput(input);
    expect(result).not.toBeNull();
    expect(result!.rating).toBe(4);
    expect(result!.specialty).toBe("Coffee");
  });

  // -------------------------------------------------------------------------
  // Type validation and coercion
  // -------------------------------------------------------------------------

  it("rounds rating to 1 decimal place", () => {
    const input = JSON.stringify({ rating: 4.567, reviewCount: null, hours: null, summary: null, translatedSummary: null, specialty: null, priceLevel: null });
    const result = parseLlmOutput(input);
    expect(result!.rating).toBe(4.6);
  });

  it("rejects rating outside 1-5 range", () => {
    const tooLow = JSON.stringify({ rating: 0, reviewCount: null, hours: null, summary: null, translatedSummary: null, specialty: null, priceLevel: null });
    expect(parseLlmOutput(tooLow)!.rating).toBeNull();

    const tooHigh = JSON.stringify({ rating: 6, reviewCount: null, hours: null, summary: null, translatedSummary: null, specialty: null, priceLevel: null });
    expect(parseLlmOutput(tooHigh)!.rating).toBeNull();
  });

  it("rejects negative reviewCount", () => {
    const input = JSON.stringify({ rating: null, reviewCount: -5, hours: null, summary: null, translatedSummary: null, specialty: null, priceLevel: null });
    expect(parseLlmOutput(input)!.reviewCount).toBeNull();
  });

  it("rounds reviewCount to integer", () => {
    const input = JSON.stringify({ rating: null, reviewCount: 42.7, hours: null, summary: null, translatedSummary: null, specialty: null, priceLevel: null });
    expect(parseLlmOutput(input)!.reviewCount).toBe(43);
  });

  it("rejects priceLevel outside 1-4 range", () => {
    const tooLow = JSON.stringify({ rating: null, reviewCount: null, hours: null, summary: null, translatedSummary: null, specialty: null, priceLevel: 0 });
    expect(parseLlmOutput(tooLow)!.priceLevel).toBeNull();

    const tooHigh = JSON.stringify({ rating: null, reviewCount: null, hours: null, summary: null, translatedSummary: null, specialty: null, priceLevel: 5 });
    expect(parseLlmOutput(tooHigh)!.priceLevel).toBeNull();
  });

  it("rounds priceLevel to integer", () => {
    const input = JSON.stringify({ rating: null, reviewCount: null, hours: null, summary: null, translatedSummary: null, specialty: null, priceLevel: 2.6 });
    expect(parseLlmOutput(input)!.priceLevel).toBe(3);
  });

  it("truncates summary to 500 characters", () => {
    const longSummary = "A".repeat(600);
    const input = JSON.stringify({ rating: null, reviewCount: null, hours: null, summary: longSummary, translatedSummary: null, specialty: null, priceLevel: null });
    const result = parseLlmOutput(input);
    expect(result!.summary!.length).toBe(500);
  });

  it("truncates specialty to 100 characters", () => {
    const longSpecialty = "B".repeat(150);
    const input = JSON.stringify({ rating: null, reviewCount: null, hours: null, summary: null, translatedSummary: null, specialty: longSpecialty, priceLevel: null });
    const result = parseLlmOutput(input);
    expect(result!.specialty!.length).toBe(100);
  });

  it("truncates translatedSummary to 500 characters", () => {
    const longTranslated = "C".repeat(600);
    const input = JSON.stringify({ rating: null, reviewCount: null, hours: null, summary: "Short.", translatedSummary: longTranslated, specialty: null, priceLevel: null });
    const result = parseLlmOutput(input);
    expect(result!.translatedSummary!.length).toBe(500);
  });

  // -------------------------------------------------------------------------
  // Type coercion – wrong types become null
  // -------------------------------------------------------------------------

  it("treats string rating as null", () => {
    const input = JSON.stringify({ rating: "four", reviewCount: null, hours: null, summary: null, translatedSummary: null, specialty: null, priceLevel: null });
    expect(parseLlmOutput(input)!.rating).toBeNull();
  });

  it("treats boolean reviewCount as null", () => {
    const input = JSON.stringify({ rating: null, reviewCount: true, hours: null, summary: null, translatedSummary: null, specialty: null, priceLevel: null });
    expect(parseLlmOutput(input)!.reviewCount).toBeNull();
  });

  it("treats numeric hours as null", () => {
    const input = JSON.stringify({ rating: null, reviewCount: null, hours: 9, summary: null, translatedSummary: null, specialty: null, priceLevel: null });
    expect(parseLlmOutput(input)!.hours).toBeNull();
  });

  it("treats empty string hours as null", () => {
    const input = JSON.stringify({ rating: null, reviewCount: null, hours: "", summary: null, translatedSummary: null, specialty: null, priceLevel: null });
    expect(parseLlmOutput(input)!.hours).toBeNull();
  });

  it("treats empty string summary as null", () => {
    const input = JSON.stringify({ rating: null, reviewCount: null, hours: null, summary: "", translatedSummary: null, specialty: null, priceLevel: null });
    expect(parseLlmOutput(input)!.summary).toBeNull();
  });

  // -------------------------------------------------------------------------
  // Edge cases / error handling
  // -------------------------------------------------------------------------

  it("returns null for non-JSON text", () => {
    expect(parseLlmOutput("I don't know anything about this place.")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseLlmOutput("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(parseLlmOutput("{rating: 4, broken}")).toBeNull();
  });

  it("handles missing fields gracefully (treats as null)", () => {
    const input = JSON.stringify({ rating: 3.0 }); // only rating, rest missing
    const result = parseLlmOutput(input);
    expect(result).not.toBeNull();
    expect(result!.rating).toBe(3.0);
    expect(result!.reviewCount).toBeNull();
    expect(result!.hours).toBeNull();
    expect(result!.summary).toBeNull();
    expect(result!.translatedSummary).toBeNull();
    expect(result!.specialty).toBeNull();
    expect(result!.priceLevel).toBeNull();
  });

  it("handles extra unexpected fields without error", () => {
    const input = JSON.stringify({
      rating: 4.0,
      reviewCount: null,
      hours: null,
      summary: "Good.",
      translatedSummary: null,
      specialty: null,
      priceLevel: null,
      unexpectedField: "should be ignored",
      anotherOne: 42,
    });
    const result = parseLlmOutput(input);
    expect(result).not.toBeNull();
    expect(result!.rating).toBe(4.0);
    expect(result!.summary).toBe("Good.");
    // Extra fields should not appear in the result
    expect((result as unknown as Record<string, unknown>).unexpectedField).toBeUndefined();
  });
});
