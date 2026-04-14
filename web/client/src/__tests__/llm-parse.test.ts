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
      description: "Excellent French bistro.",
      review: "Great food and cozy atmosphere.",
      priceLevel: 2,
    });
    const result = parseLlmOutput(input);
    expect(result).not.toBeNull();
    expect(result!.rating).toBe(4.2);
    expect(result!.reviewCount).toBe(87);
    expect(result!.hours).toEqual([{ day: "All", open: "Mon-Fri 12:00-14:00", close: null }]);
    expect(result!.hoursFlat).toBe("All: Mon-Fri 12:00-14:00");
    expect(result!.description).toBe("Excellent French bistro.");
    expect(result!.review).toBe("Great food and cozy atmosphere.");
    expect(result!.priceLevel).toBe(2);
  });

  it("returns all nulls when all fields are null", () => {
    const input = JSON.stringify({
      rating: null,
      reviewCount: null,
      hours: null,
      description: null,
      review: null,
      priceLevel: null,
    });
    const result = parseLlmOutput(input);
    expect(result).not.toBeNull();
    expect(result!.rating).toBeNull();
    expect(result!.reviewCount).toBeNull();
    expect(result!.hours).toBeNull();
    expect(result!.hoursFlat).toBeNull();
    expect(result!.description).toBeNull();
    expect(result!.review).toBeNull();
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
      description: "Nice.",
      review: null,
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
      description: "Perfect.",
      review: null,
      priceLevel: null,
    });
    const input = "```\n" + json + "\n```";
    const result = parseLlmOutput(input);
    expect(result).not.toBeNull();
    expect(result!.rating).toBe(5);
    expect(result!.description).toBe("Perfect.");
  });

  // -------------------------------------------------------------------------
  // JSON extraction from mixed text
  // -------------------------------------------------------------------------

  it("extracts JSON from surrounding text", () => {
    const input = `Here is the information:
{"rating": 4.0, "reviewCount": 50, "hours": "9-17", "description": "Good café.", "review": null, "priceLevel": 2}
I hope this helps!`;
    const result = parseLlmOutput(input);
    expect(result).not.toBeNull();
    expect(result!.rating).toBe(4);
    expect(result!.description).toBe("Good café.");
  });

  // -------------------------------------------------------------------------
  // Type validation and coercion
  // -------------------------------------------------------------------------

  it("rounds rating to 1 decimal place", () => {
    const input = JSON.stringify({ rating: 4.567, reviewCount: null, hours: null, description: null, review: null, priceLevel: null });
    const result = parseLlmOutput(input);
    expect(result!.rating).toBe(4.6);
  });

  it("rejects rating outside 1-5 range", () => {
    const tooLow = JSON.stringify({ rating: 0, reviewCount: null, hours: null, description: null, review: null, priceLevel: null });
    expect(parseLlmOutput(tooLow)!.rating).toBeNull();

    const tooHigh = JSON.stringify({ rating: 6, reviewCount: null, hours: null, description: null, review: null, priceLevel: null });
    expect(parseLlmOutput(tooHigh)!.rating).toBeNull();
  });

  it("rejects negative reviewCount", () => {
    const input = JSON.stringify({ rating: null, reviewCount: -5, hours: null, description: null, review: null, priceLevel: null });
    expect(parseLlmOutput(input)!.reviewCount).toBeNull();
  });

  it("rounds reviewCount to integer", () => {
    const input = JSON.stringify({ rating: null, reviewCount: 42.7, hours: null, description: null, review: null, priceLevel: null });
    expect(parseLlmOutput(input)!.reviewCount).toBe(43);
  });

  it("rejects priceLevel outside 1-4 range", () => {
    const tooLow = JSON.stringify({ rating: null, reviewCount: null, hours: null, description: null, review: null, priceLevel: 0 });
    expect(parseLlmOutput(tooLow)!.priceLevel).toBeNull();

    const tooHigh = JSON.stringify({ rating: null, reviewCount: null, hours: null, description: null, review: null, priceLevel: 5 });
    expect(parseLlmOutput(tooHigh)!.priceLevel).toBeNull();
  });

  it("rounds priceLevel to integer", () => {
    const input = JSON.stringify({ rating: null, reviewCount: null, hours: null, description: null, review: null, priceLevel: 2.6 });
    expect(parseLlmOutput(input)!.priceLevel).toBe(3);
  });

  it("truncates description to 300 characters", () => {
    const longDescription = "A".repeat(400);
    const input = JSON.stringify({ rating: null, reviewCount: null, hours: null, description: longDescription, review: null, priceLevel: null });
    const result = parseLlmOutput(input);
    expect(result!.description!.length).toBe(300);
  });

  // -------------------------------------------------------------------------
  // Type coercion – wrong types become null
  // -------------------------------------------------------------------------

  it("treats string rating as null", () => {
    const input = JSON.stringify({ rating: "four", reviewCount: null, hours: null, description: null, review: null, priceLevel: null });
    expect(parseLlmOutput(input)!.rating).toBeNull();
  });

  it("treats boolean reviewCount as null", () => {
    const input = JSON.stringify({ rating: null, reviewCount: true, hours: null, description: null, review: null, priceLevel: null });
    expect(parseLlmOutput(input)!.reviewCount).toBeNull();
  });

  it("treats numeric hours as null", () => {
    const input = JSON.stringify({ rating: null, reviewCount: null, hours: 9, description: null, review: null, priceLevel: null });
    expect(parseLlmOutput(input)!.hours).toBeNull();
  });

  it("treats empty string hours as null", () => {
    const input = JSON.stringify({ rating: null, reviewCount: null, hours: "", description: null, review: null, priceLevel: null });
    expect(parseLlmOutput(input)!.hours).toBeNull();
  });

  it("treats empty string description as null", () => {
    const input = JSON.stringify({ rating: null, reviewCount: null, hours: null, description: "", review: null, priceLevel: null });
    expect(parseLlmOutput(input)!.description).toBeNull();
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
    expect(result!.hoursFlat).toBeNull();
    expect(result!.description).toBeNull();
    expect(result!.review).toBeNull();
    expect(result!.priceLevel).toBeNull();
  });

  it("handles extra unexpected fields without error", () => {
    const input = JSON.stringify({
      rating: 4.0,
      reviewCount: null,
      hours: null,
      description: "Good.",
      review: null,
      priceLevel: null,
      unexpectedField: "should be ignored",
      anotherOne: 42,
    });
    const result = parseLlmOutput(input);
    expect(result).not.toBeNull();
    expect(result!.rating).toBe(4.0);
    expect(result!.description).toBe("Good.");
    // Extra fields should not appear in the result
    expect((result as unknown as Record<string, unknown>).unexpectedField).toBeUndefined();
  });
});
