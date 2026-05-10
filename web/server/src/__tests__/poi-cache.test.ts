// ---------------------------------------------------------------------------
// POI cache endpoint tests
//
// Covers input validation (400 paths) and the 503 fallback when no DB is
// configured. End-to-end DB tests would require a live Postgres instance and
// are out of scope for unit tests.
//
// Validation runs BEFORE the DB availability check, so we can exercise 400
// responses without a DB.
// ---------------------------------------------------------------------------

import { describe, it, expect } from "vitest";
import request from "supertest";

process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_MAX = "1000";
delete process.env.DATABASE_URL;

const { default: app } = await import("../index");

describe("POI cache — GET /poi/:osm_type/:osm_id", () => {
  it("returns 400 for invalid osm_type", async () => {
    const res = await request(app).get("/poi/invalid/12345");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/osm_type/i);
  });

  it("returns 400 for non-numeric osm_id", async () => {
    const res = await request(app).get("/poi/node/notanumber");
    expect(res.status).toBe(400);
  });

  it("returns 400 for negative osm_id", async () => {
    const res = await request(app).get("/poi/node/-1");
    expect(res.status).toBe(400);
  });

  it("returns 503 when validation passes but DB is disabled", async () => {
    const res = await request(app).get("/poi/node/12345");
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/disabled/i);
  });

  it("accepts way and relation osm_types", async () => {
    const res1 = await request(app).get("/poi/way/100");
    const res2 = await request(app).get("/poi/relation/200");
    expect(res1.status).toBe(503);
    expect(res2.status).toBe(503);
  });
});

describe("POI cache — POST /poi/search", () => {
  it("returns 400 when body has no keys array", async () => {
    const res = await request(app)
      .post("/poi/search")
      .send({})
      .set("Content-Type", "application/json");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/keys/i);
  });

  it("returns 400 when keys is not an array", async () => {
    const res = await request(app)
      .post("/poi/search")
      .send({ keys: "nope" })
      .set("Content-Type", "application/json");
    expect(res.status).toBe(400);
  });

  it("returns 400 when too many keys", async () => {
    const keys = Array.from({ length: 201 }, (_, i) => ({
      osm_type: "node",
      osm_id: String(i + 1),
    }));
    const res = await request(app)
      .post("/poi/search")
      .send({ keys })
      .set("Content-Type", "application/json");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/many/i);
  });

  it("returns 503 when DB disabled with valid body", async () => {
    const res = await request(app)
      .post("/poi/search")
      .send({ keys: [{ osm_type: "node", osm_id: "12345" }] })
      .set("Content-Type", "application/json");
    expect(res.status).toBe(503);
  });
});

describe("POI cache — PUT /poi/:osm_type/:osm_id", () => {
  const validBody = {
    category: "food",
    lat: 43.5,
    lon: -1.4,
    name: "Test",
    enrichment: { rating: 4.5 },
  };

  it("returns 400 for invalid osm_type", async () => {
    const res = await request(app)
      .put("/poi/bogus/123")
      .send(validBody)
      .set("Content-Type", "application/json");
    expect(res.status).toBe(400);
  });

  it("returns 400 for missing category", async () => {
    const res = await request(app)
      .put("/poi/node/123")
      .send({ ...validBody, category: undefined })
      .set("Content-Type", "application/json");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/category/i);
  });

  it("returns 400 for out-of-range lat", async () => {
    const res = await request(app)
      .put("/poi/node/123")
      .send({ ...validBody, lat: 999 })
      .set("Content-Type", "application/json");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/lat/i);
  });

  it("returns 400 for out-of-range lon", async () => {
    const res = await request(app)
      .put("/poi/node/123")
      .send({ ...validBody, lon: -999 })
      .set("Content-Type", "application/json");
    expect(res.status).toBe(400);
  });

  it("returns 400 for null enrichment", async () => {
    const res = await request(app)
      .put("/poi/node/123")
      .send({ ...validBody, enrichment: null })
      .set("Content-Type", "application/json");
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/enrichment/i);
  });

  it("returns 413 for huge enrichment payload", async () => {
    const huge = { blob: "x".repeat(250_000) };
    const res = await request(app)
      .put("/poi/node/123")
      .send({ ...validBody, enrichment: huge })
      .set("Content-Type", "application/json");
    // express.json 1mb limit lets 250kb through; our soft guard rejects it
    expect(res.status).toBe(413);
  });

  it("returns 503 when DB disabled with valid payload", async () => {
    const res = await request(app)
      .put("/poi/node/12345")
      .send(validBody)
      .set("Content-Type", "application/json");
    expect(res.status).toBe(503);
  });
});
