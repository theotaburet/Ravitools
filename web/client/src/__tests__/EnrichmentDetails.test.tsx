// @vitest-environment jsdom
// --- EnrichmentDetails shows season, prices and booking when the enrichment carries them ---

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { EnrichmentDetails } from "../components/EnrichmentDetails";
import type { EnrichedData } from "../types";

const BASE: EnrichedData = {
  rating: null,
  reviewCount: null,
  hours: null,
  openingHours: null,
  description: null,
  review: null,
  priceLevel: null,
  googleMapsUrl: "https://maps.google.com",
  sourceUrls: [],
  rawSnippets: [],
  enrichedAt: "2026-10-11T00:00:00Z",
  status: "done",
  locality: null,
  sourceCount: 0,
  sourceEngines: [],
  confidence: 0,
};

describe("EnrichmentDetails", () => {
  it("renders season, prices and booking with French labels", () => {
    const { container } = render(
      <EnrichmentDetails
        enrichment={{
          ...BASE,
          season: "6 juin au 28 septembre 2026",
          priceNote: "nuitée 21 €, demi-pension 55 €",
          booking: "required",
        }}
        targetLanguage="fr"
      />,
    );
    expect(container.textContent).toContain("Saison : 6 juin au 28 septembre 2026");
    expect(container.textContent).toContain("Tarifs : nuitée 21 €, demi-pension 55 €");
    expect(container.textContent).toContain("Réservation obligatoire");
  });

  it("renders nothing for those when absent", () => {
    const { container } = render(<EnrichmentDetails enrichment={BASE} targetLanguage="en" />);
    expect(container.textContent).not.toMatch(/Season|Prices|Booking/);
  });
});
