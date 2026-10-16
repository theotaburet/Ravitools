// --- Tests for parseLlmOutput: pure function, no mocks needed ---

import { describe, expect, it } from "vitest";
import { parseLlmOutput } from "../lib/enrichment/llm";

describe("parseLlmOutput", () => {
  // --- Happy path: clean JSON ---

  it("parses a well-formed JSON object", () => {
    const input = JSON.stringify({
      rating: 4.2,
      reviewCount: 87,
      hours: [{ day: "Mon-Fri", open: "12:00", close: "14:00" }],
      description: "Excellent French bistro.",
      review: "Great food and cozy atmosphere.",
      priceLevel: 2,
    });
    const result = parseLlmOutput(input);
    expect(result).not.toBeNull();
    expect(result?.rating).toBe(4.2);
    expect(result?.reviewCount).toBe(87);
    expect(result?.hours).toEqual([{ day: "Mon-Fri", open: "12:00", close: "14:00" }]);
    expect(result?.hoursFlat).toBe("Mon-Fri: 12:00-14:00");
    expect(result?.description).toBe("Excellent French bistro.");
    expect(result?.review).toBe("Great food and cozy atmosphere.");
    expect(result?.priceLevel).toBe(2);
  });

  it("maps season, priceNote and booking, and rejects unknown booking values", () => {
    const result = parseLlmOutput(
      JSON.stringify({
        rating: null,
        reviewCount: null,
        hours: null,
        description: null,
        review: null,
        priceLevel: null,
        season: "6 June to 28 September 2026",
        priceNote: "night 21 €, half board 55 €",
        booking: "required",
      }),
    );
    expect(result?.season).toBe("6 June to 28 September 2026");
    expect(result?.priceNote).toBe("night 21 €, half board 55 €");
    expect(result?.booking).toBe("required");

    const loose = parseLlmOutput(
      JSON.stringify({ booking: "maybe", season: "x".repeat(200), priceNote: 12 }),
    );
    expect(loose?.booking).toBeNull();
    expect(loose?.season).toHaveLength(80);
    expect(loose?.priceNote).toBeNull();
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
    expect(result?.rating).toBeNull();
    expect(result?.reviewCount).toBeNull();
    expect(result?.hours).toBeNull();
    expect(result?.hoursFlat).toBeNull();
    expect(result?.description).toBeNull();
    expect(result?.review).toBeNull();
    expect(result?.priceLevel).toBeNull();
  });

  // --- Type validation and coercion ---

  it("rounds rating to 1 decimal place", () => {
    const input = JSON.stringify({
      rating: 4.567,
      reviewCount: null,
      hours: null,
      description: null,
      review: null,
      priceLevel: null,
    });
    const result = parseLlmOutput(input);
    expect(result?.rating).toBe(4.6);
  });

  it("rejects rating outside 1-5 range", () => {
    const tooLow = JSON.stringify({
      rating: 0,
      reviewCount: null,
      hours: null,
      description: null,
      review: null,
      priceLevel: null,
    });
    expect(parseLlmOutput(tooLow)?.rating).toBeNull();

    const tooHigh = JSON.stringify({
      rating: 6,
      reviewCount: null,
      hours: null,
      description: null,
      review: null,
      priceLevel: null,
    });
    expect(parseLlmOutput(tooHigh)?.rating).toBeNull();
  });

  it("rejects negative reviewCount", () => {
    const input = JSON.stringify({
      rating: null,
      reviewCount: -5,
      hours: null,
      description: null,
      review: null,
      priceLevel: null,
    });
    expect(parseLlmOutput(input)?.reviewCount).toBeNull();
  });

  it("rounds reviewCount to integer", () => {
    const input = JSON.stringify({
      rating: null,
      reviewCount: 42.7,
      hours: null,
      description: null,
      review: null,
      priceLevel: null,
    });
    expect(parseLlmOutput(input)?.reviewCount).toBe(43);
  });

  it("rejects priceLevel outside 1-4 range", () => {
    const tooLow = JSON.stringify({
      rating: null,
      reviewCount: null,
      hours: null,
      description: null,
      review: null,
      priceLevel: 0,
    });
    expect(parseLlmOutput(tooLow)?.priceLevel).toBeNull();

    const tooHigh = JSON.stringify({
      rating: null,
      reviewCount: null,
      hours: null,
      description: null,
      review: null,
      priceLevel: 5,
    });
    expect(parseLlmOutput(tooHigh)?.priceLevel).toBeNull();
  });

  it("rounds priceLevel to integer", () => {
    const input = JSON.stringify({
      rating: null,
      reviewCount: null,
      hours: null,
      description: null,
      review: null,
      priceLevel: 2.6,
    });
    expect(parseLlmOutput(input)?.priceLevel).toBe(3);
  });

  it("truncates description to 180 characters", () => {
    const longDescription = "A".repeat(400);
    const input = JSON.stringify({
      rating: null,
      reviewCount: null,
      hours: null,
      description: longDescription,
      review: null,
      priceLevel: null,
    });
    const result = parseLlmOutput(input);
    expect(result?.description?.length).toBe(180);
  });

  // --- Type coercion: wrong types become null ---

  it("treats string rating as null", () => {
    const input = JSON.stringify({
      rating: "four",
      reviewCount: null,
      hours: null,
      description: null,
      review: null,
      priceLevel: null,
    });
    expect(parseLlmOutput(input)?.rating).toBeNull();
  });

  it("treats boolean reviewCount as null", () => {
    const input = JSON.stringify({
      rating: null,
      reviewCount: true,
      hours: null,
      description: null,
      review: null,
      priceLevel: null,
    });
    expect(parseLlmOutput(input)?.reviewCount).toBeNull();
  });

  it("treats numeric hours as null", () => {
    const input = JSON.stringify({
      rating: null,
      reviewCount: null,
      hours: 9,
      description: null,
      review: null,
      priceLevel: null,
    });
    expect(parseLlmOutput(input)?.hours).toBeNull();
  });

  it("treats empty string hours as null", () => {
    const input = JSON.stringify({
      rating: null,
      reviewCount: null,
      hours: "",
      description: null,
      review: null,
      priceLevel: null,
    });
    expect(parseLlmOutput(input)?.hours).toBeNull();
  });

  it("treats empty string description as null", () => {
    const input = JSON.stringify({
      rating: null,
      reviewCount: null,
      hours: null,
      description: "",
      review: null,
      priceLevel: null,
    });
    expect(parseLlmOutput(input)?.description).toBeNull();
  });

  // --- Edge cases / error handling ---

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
    expect(result?.rating).toBe(3.0);
    expect(result?.reviewCount).toBeNull();
    expect(result?.hours).toBeNull();
    expect(result?.hoursFlat).toBeNull();
    expect(result?.description).toBeNull();
    expect(result?.review).toBeNull();
    expect(result?.priceLevel).toBeNull();
  });

  it("returns null for clearly garbled/gibberish text", () => {
    // No JSON object at all: pure LLM hallucination noise
    expect(parseLlmOutput("aaaaaaaaaaaa bbbbbbbbbbb!!!!")).toBeNull();
  });

  it("accepts repaired JSON where outer text is trimmed", () => {
    // LLM repair response that embeds valid JSON
    const repaired = `{"rating":3.8,"reviewCount":null,"hours":null,"description":"Bon refuge en montagne.","review":null,"priceLevel":null}`;
    const result = parseLlmOutput(repaired);
    expect(result).not.toBeNull();
    expect(result?.rating).toBe(3.8);
    expect(result?.description).toBe("Bon refuge en montagne.");
  });
});
