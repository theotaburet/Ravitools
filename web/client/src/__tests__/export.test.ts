// ---------------------------------------------------------------------------
// Tests for export (GPX, KML, GeoJSON)
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import { buildGpxString, buildKmlString, buildGeoJsonObject, buildOsmAndGpxString, buildKmzBlob, buildZipSingleFile } from "../lib/export";
import type { POI, TraceData } from "../types";

const MOCK_POIS: POI[] = [
  {
    id: "poi_1",
    lat: 48.858,
    lon: 2.356,
    category: "Water",
    name: "Fontaine de la Place",
    icon: "droplet",
    distanceToTrace: 120,
    alongTraceDistance: 3000,
    tags: { amenity: "drinking_water", fee: "no" },
    style: {
      iconShape: "circle",
      borderColor: "#FFFFFF",
      borderWidth: "2",
      textColor: "#FFFFFF",
      backgroundColor: "#0066CC",
    },
    osmId: 1001,
    osmType: "node",
  },
  {
    id: "poi_2",
    lat: 48.870,
    lon: 2.380,
    category: "Sleeping place",
    name: "Camping Municipal",
    icon: "tent",
    distanceToTrace: 350,
    alongTraceDistance: 8000,
    tags: { tourism: "camp_site", name: "Camping Municipal" },
    style: {
      iconShape: "circle",
      borderColor: "#FFFFFF",
      borderWidth: "2",
      textColor: "#FFFFFF",
      backgroundColor: "#1A1A2E",
    },
    osmId: 2001,
    osmType: "node",
  },
];

const MOCK_TRACE: TraceData = {
  id: "trace_test",
  original: [
    { lat: 48.8566, lon: 2.3522, ele: 35 },
    { lat: 48.8700, lon: 2.3800, ele: 50 },
  ],
  simplified: [
    { lat: 48.8566, lon: 2.3522 },
    { lat: 48.8700, lon: 2.3800 },
  ],
  totalDistanceM: 2500,
  elevationGainM: 150,
  elevationLossM: 80,
  name: "Test Route",
  color: "#1a1a1a",
};

describe("GPX export", () => {
  it("should produce valid GPX XML", () => {
    const gpx = buildGpxString(MOCK_POIS, [MOCK_TRACE]);
    expect(gpx).toContain('<?xml version="1.0"');
    expect(gpx).toContain("<gpx");
    expect(gpx).toContain("</gpx>");
  });

  it("should include all POIs as waypoints", () => {
    const gpx = buildGpxString(MOCK_POIS, [MOCK_TRACE]);
    expect(gpx).toContain("<wpt");
    expect(gpx).toContain("Fontaine de la Place");
    expect(gpx).toContain("Camping Municipal");
    // Check coordinates
    expect(gpx).toContain('lat="48.858"');
    expect(gpx).toContain('lon="2.356"');
  });

  it("should include the track", () => {
    const gpx = buildGpxString(MOCK_POIS, [MOCK_TRACE]);
    expect(gpx).toContain("<trk>");
    expect(gpx).toContain("<trkpt");
    expect(gpx).toContain("Test Route");
  });

  it("should work without a trace", () => {
    const gpx = buildGpxString(MOCK_POIS, []);
    expect(gpx).toContain("<wpt");
    expect(gpx).not.toContain("<trk>");
  });

  it("should escape XML special characters", () => {
    const poisWithSpecial: POI[] = [
      {
        ...MOCK_POIS[0],
        name: 'Bar & Grill "Special" <place>',
      },
    ];
    const gpx = buildGpxString(poisWithSpecial, []);
    expect(gpx).toContain("&amp;");
    expect(gpx).toContain("&lt;");
    expect(gpx).toContain("&gt;");
    expect(gpx).toContain("&quot;");
  });
});

describe("KML export", () => {
  it("should produce valid KML XML", () => {
    const kml = buildKmlString(MOCK_POIS, [MOCK_TRACE]);
    expect(kml).toContain('<?xml version="1.0"');
    expect(kml).toContain("<kml");
    expect(kml).toContain("</kml>");
  });

  it("should group POIs by category in folders", () => {
    const kml = buildKmlString(MOCK_POIS, [MOCK_TRACE]);
    expect(kml).toContain("<Folder>");
    expect(kml).toContain("Water");
    expect(kml).toContain("Sleeping place");
  });

  it("should include the track as a LineString", () => {
    const kml = buildKmlString(MOCK_POIS, [MOCK_TRACE]);
    expect(kml).toContain("<LineString>");
    expect(kml).toContain("Test Route");
  });
});

describe("GeoJSON export", () => {
  it("should produce valid GeoJSON", () => {
    const geojson = buildGeoJsonObject(MOCK_POIS);
    expect(geojson.type).toBe("FeatureCollection");
    expect(geojson.features.length).toBe(2);
  });

  it("should include correct coordinates (lon, lat order)", () => {
    const geojson = buildGeoJsonObject(MOCK_POIS);
    const coords = geojson.features[0].geometry;
    expect(coords.type).toBe("Point");
    if (coords.type === "Point") {
      expect(coords.coordinates[0]).toBe(2.356); // lon
      expect(coords.coordinates[1]).toBe(48.858); // lat
    }
  });

  it("should include category and distance in properties", () => {
    const geojson = buildGeoJsonObject(MOCK_POIS);
    const props = geojson.features[0].properties;
    expect(props?.category).toBe("Water");
    expect(props?.distanceToTrace).toBe(120);
  });
});

// ---------------------------------------------------------------------------
// OsmAnd GPX export
// ---------------------------------------------------------------------------

describe("OsmAnd GPX export", () => {
  it("should include osmand namespace in root element", () => {
    const gpx = buildOsmAndGpxString(MOCK_POIS, [MOCK_TRACE]);
    expect(gpx).toContain('xmlns:osmand="https://osmand.net"');
  });

  it("should include osmand:points_groups in extensions", () => {
    const gpx = buildOsmAndGpxString(MOCK_POIS, [MOCK_TRACE]);
    expect(gpx).toContain("<osmand:points_groups>");
    expect(gpx).toContain("</osmand:points_groups>");
    // Should have groups for the categories used
    expect(gpx).toContain('name="Water"');
    expect(gpx).toContain('name="Sleeping place"');
  });

  it("should include osmand extensions on each waypoint", () => {
    const gpx = buildOsmAndGpxString(MOCK_POIS, [MOCK_TRACE]);
    expect(gpx).toContain("<osmand:icon>");
    expect(gpx).toContain("<osmand:color>");
    expect(gpx).toContain("<osmand:background>");
    // Water POI should get the drinking_water icon
    expect(gpx).toContain("amenity_drinking_water");
    // Sleeping place POI should get the camp_site icon
    expect(gpx).toContain("tourism_camp_site");
  });

  it("should include OsmAnd category colors", () => {
    const gpx = buildOsmAndGpxString(MOCK_POIS, [MOCK_TRACE]);
    // Water color: #0066CC
    expect(gpx).toContain("#0066CC");
    // Sleeping place color: #1A1A2E
    expect(gpx).toContain("#1A1A2E");
  });

  it("should still be valid GPX (basic structure)", () => {
    const gpx = buildOsmAndGpxString(MOCK_POIS, [MOCK_TRACE]);
    expect(gpx).toContain('<?xml version="1.0"');
    expect(gpx).toContain("<gpx");
    expect(gpx).toContain("</gpx>");
    expect(gpx).toContain("<wpt");
    expect(gpx).toContain("<name>");
    expect(gpx).toContain("<desc>");
  });

  it("should include the track when trace is provided", () => {
    const gpx = buildOsmAndGpxString(MOCK_POIS, [MOCK_TRACE]);
    expect(gpx).toContain("<trk>");
    expect(gpx).toContain("<trkpt");
    expect(gpx).toContain("Test Route");
  });

  it("should work without a trace", () => {
    const gpx = buildOsmAndGpxString(MOCK_POIS, []);
    expect(gpx).toContain("<wpt");
    expect(gpx).not.toContain("<trk>");
  });

  it("should use specific tag icon when available", () => {
    const poisWithSpecificTag: POI[] = [
      {
        ...MOCK_POIS[0],
        tags: { amenity: "drinking_water" },
      },
    ];
    const gpx = buildOsmAndGpxString(poisWithSpecificTag, []);
    expect(gpx).toContain("amenity_drinking_water");
  });
});

// ---------------------------------------------------------------------------
// KMZ export
// ---------------------------------------------------------------------------

describe("KMZ export", () => {
  it("should produce a Blob", () => {
    const blob = buildKmzBlob(MOCK_POIS, [MOCK_TRACE]);
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe("application/vnd.google-earth.kmz");
  });

  it("should have non-zero size", () => {
    const blob = buildKmzBlob(MOCK_POIS, [MOCK_TRACE]);
    expect(blob.size).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// OsmAnd GPX with optional categories
// ---------------------------------------------------------------------------

describe("OsmAnd GPX with optional categories", () => {
  const OPTIONAL_POI: POI = {
    id: "poi_medical",
    lat: 48.860,
    lon: 2.340,
    category: "Medical",
    name: "Hôpital Saint-Louis",
    icon: "hospital",
    distanceToTrace: 200,
    alongTraceDistance: 6000,
    tags: { amenity: "hospital", name: "Hôpital Saint-Louis" },
    style: {
      iconShape: "circle",
      borderColor: "#FFFFFF",
      borderWidth: "2",
      textColor: "#FFFFFF",
      backgroundColor: "#DC2626",
    },
    osmId: 3001,
    osmType: "node",
  };

  it("should include osmand extensions for optional category POIs", () => {
    const gpx = buildOsmAndGpxString([OPTIONAL_POI], []);
    expect(gpx).toContain("<osmand:icon>amenity_hospital</osmand:icon>");
    expect(gpx).toContain("<osmand:color>#DC2626</osmand:color>");
    expect(gpx).toContain('name="Medical"');
  });

  it("should produce correct GPX symbol for optional categories", () => {
    const gpx = buildGpxString([OPTIONAL_POI], []);
    expect(gpx).toContain("<sym>Medical Facility</sym>");
  });

  it("should handle mixed essential and optional categories", () => {
    const mixed = [...MOCK_POIS, OPTIONAL_POI];
    const gpx = buildOsmAndGpxString(mixed, [MOCK_TRACE]);
    // Should have groups for all 3 categories
    expect(gpx).toContain('name="Water"');
    expect(gpx).toContain('name="Sleeping place"');
    expect(gpx).toContain('name="Medical"');
    // Should have 3 waypoints
    const wptCount = (gpx.match(/<wpt /g) || []).length;
    expect(wptCount).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// GPX symbol mapping coverage for all 18 categories
// ---------------------------------------------------------------------------

describe("GPX symbol mapping", () => {
  const CATEGORY_EXPECTED_SYMBOLS: [string, string][] = [
    ["Water", "Drinking Water"],
    ["Sleeping place", "Campground"],
    ["Restroom", "Restroom"],
    ["Shelter", "Shelter"],
    ["Food shop", "Shopping Center"],
    ["Restaurant or Bar", "Restaurant"],
    ["Gears", "Bike Trail"],
    ["DIY", "Wrecker"],
    ["Laundry", "Building"],
    ["Medical", "Medical Facility"],
    ["Pharmacy", "Pharmacy"],
    ["Bank & ATM", "Bank"],
    ["Post office", "Post Office"],
    ["Viewpoint", "Scenic Area"],
    ["Tourist info", "Information"],
    ["Charging", "Charging Station"],
    ["Picnic", "Picnic Area"],
    ["Wifi", "Library"],
  ];

  for (const [category, expectedSymbol] of CATEGORY_EXPECTED_SYMBOLS) {
    it(`should map ${category} to GPX symbol "${expectedSymbol}"`, () => {
      const poi: POI = {
        ...MOCK_POIS[0],
        id: `test_${category}`,
        category: category as POI["category"],
        name: `Test ${category}`,
      };
      const gpx = buildGpxString([poi], []);
      expect(gpx).toContain(`<sym>${expectedSymbol}</sym>`);
    });
  }
});

// ---------------------------------------------------------------------------
// Minimal ZIP builder
// ---------------------------------------------------------------------------

describe("buildZipSingleFile", () => {
  it("should produce valid ZIP magic bytes", () => {
    const data = new TextEncoder().encode("hello world");
    const zip = buildZipSingleFile("test.txt", data);
    // ZIP magic: PK\x03\x04
    expect(zip[0]).toBe(0x50); // P
    expect(zip[1]).toBe(0x4b); // K
    expect(zip[2]).toBe(0x03);
    expect(zip[3]).toBe(0x04);
  });

  it("should contain the filename", () => {
    const data = new TextEncoder().encode("hello");
    const zip = buildZipSingleFile("doc.kml", data);
    const zipStr = new TextDecoder().decode(zip);
    expect(zipStr).toContain("doc.kml");
  });

  it("should contain the file data uncompressed", () => {
    const content = "test content for zip";
    const data = new TextEncoder().encode(content);
    const zip = buildZipSingleFile("file.txt", data);
    const zipStr = new TextDecoder().decode(zip);
    expect(zipStr).toContain(content);
  });

  it("should contain end of central directory signature", () => {
    const data = new TextEncoder().encode("x");
    const zip = buildZipSingleFile("a.txt", data);
    // EOCD signature: PK\x05\x06
    const eocdSig = [0x50, 0x4b, 0x05, 0x06];
    let found = false;
    for (let i = 0; i < zip.length - 3; i++) {
      if (
        zip[i] === eocdSig[0] &&
        zip[i + 1] === eocdSig[1] &&
        zip[i + 2] === eocdSig[2] &&
        zip[i + 3] === eocdSig[3]
      ) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});
