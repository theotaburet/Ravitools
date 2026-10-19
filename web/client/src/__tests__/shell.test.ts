import { describe, expect, it } from "vitest";
import { detentPx, nearestDetent, nextDetent } from "../lib/shell";

describe("sheet detents", () => {
  it("sizes low, mid and full on a Pixel 7", () => {
    expect([detentPx("low", 839), detentPx("mid", 839), detentPx("full", 839)]).toEqual([
      196, 436, 775,
    ]);
  });

  it("keeps low ≤ mid ≤ full on a short landscape viewport", () => {
    expect(detentPx("mid", 340)).toBe(196);
    expect(detentPx("full", 340)).toBe(276);
  });

  it("settles a drag on the closest detent", () => {
    expect(nearestDetent(300, 839)).toBe("low");
    expect(nearestDetent(330, 839)).toBe("mid");
    expect(nearestDetent(700, 839)).toBe("full");
  });

  it("cycles low, mid, full on tap", () => {
    expect([nextDetent("low"), nextDetent("mid"), nextDetent("full")]).toEqual([
      "mid",
      "full",
      "low",
    ]);
  });
});
