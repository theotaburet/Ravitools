// --- OSM tags as deterministic facts: beds, booking, fee, operator, before any LLM ---

import { describe, expect, it } from "vitest";
import { buildDeterministicShortDescription } from "../lib/enrichment/deterministic";
import { osmFacts } from "../lib/enrichment/osm-facts";
import { makePoi } from "./enrichment-helpers";

const REFUGE_TAGS = {
  tourism: "alpine_hut",
  name: "Refuge de la Valmasque",
  beds: "52",
  winter_room: "yes",
  operator: "Club Alpin Français",
  email: "refugedevalmasque@ffcam.fr",
  website: "https://refugedevalmasque.ffcam.fr/",
};

describe("osmFacts", () => {
  it("reads lodging facts in English and French", () => {
    expect(osmFacts(REFUGE_TAGS, "en")).toEqual([
      "52 beds",
      "Winter room",
      "Operator: Club Alpin Français",
      "refugedevalmasque@ffcam.fr",
    ]);
    expect(osmFacts(REFUGE_TAGS, "fr")).toEqual([
      "52 lits",
      "Salle d'hiver",
      "Gestionnaire : Club Alpin Français",
      "refugedevalmasque@ffcam.fr",
    ]);
  });

  it("reads booking, fee, access and water facts common to every category", () => {
    expect(
      osmFacts(
        {
          reservation: "required",
          fee: "yes",
          internet_access: "wlan",
          stars: "3",
          capacity: "20",
          drinking_water: "no",
        },
        "en",
      ),
    ).toEqual(["20 places", "3 stars", "Booking required", "Fee", "Wi-Fi", "No drinking water"]);
    expect(
      osmFacts({ reservation: "recommended", fee: "no", drinking_water: "yes" }, "fr"),
    ).toEqual(["Réservation conseillée", "Gratuit", "Eau potable"]);
  });

  it("ignores tags it does not know and empty tag sets", () => {
    expect(osmFacts({ amenity: "restaurant", cuisine: "pizza" }, "en")).toEqual([]);
    expect(osmFacts({}, "fr")).toEqual([]);
  });
});

describe("buildDeterministicShortDescription", () => {
  it("states the OSM facts instead of a filler sentence when there are some", () => {
    const poi = makePoi({ name: "Refuge de la Valmasque", tags: REFUGE_TAGS });
    expect(buildDeterministicShortDescription(poi, "en")).toBe(
      "Refuge de la Valmasque, alpine hut, 52 beds, winter room, operator: Club Alpin Français.",
    );
    expect(buildDeterministicShortDescription(poi, "fr")).toMatch(
      /^Refuge de la Valmasque, alpine hut, 52 lits, salle d'hiver/,
    );
  });

  it("keeps the filler sentence for a bare tag set", () => {
    const poi = makePoi({ tags: { amenity: "restaurant" } });
    expect(buildDeterministicShortDescription(poi, "en")).toBe(
      "Le Petit Zinc, restaurant, useful stop near the route.",
    );
  });
});
