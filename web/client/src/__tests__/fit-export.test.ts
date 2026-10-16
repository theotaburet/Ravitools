// --- Tests for the FIT course export (Garmin, Wahoo, Hammerhead course points) ---

import { describe, expect, it } from "vitest";
import { buildFitCourse, buildFitCourses } from "../lib/export/fit";
import { haversine } from "../lib/gpx-parser";
import type { POI, PoiCategory, TraceData } from "../types";

function poi(
  id: string,
  category: PoiCategory,
  name: string,
  lat: number,
  lon: number,
  traceId = "paris",
): POI {
  return {
    id,
    lat,
    lon,
    category,
    name,
    icon: "droplet",
    distanceToTrace: 50,
    alongTraceDistance: 0,
    traceId,
    tags: {},
  };
}

function trace(id: string, name: string, original: TraceData["original"]): TraceData {
  return {
    id,
    name,
    original,
    simplified: original,
    totalDistanceM: 0,
    elevationGainM: 0,
    elevationLossM: 0,
    color: "#000000",
  };
}

const PARIS = trace("paris", "Paris loop", [
  { lat: 48.8566, lon: 2.3522, ele: 35 },
  { lat: 48.86, lon: 2.36, ele: 40 },
  { lat: 48.865, lon: 2.37, ele: 45 },
  { lat: 48.87, lon: 2.38, ele: 50 },
]);

const POIS: POI[] = [
  // Listed out of travel order on purpose: the export must sort them.
  poi("camp", "Sleeping place", "Camping Mairie", 48.869, 2.379),
  poi("water", "Water", "Fontaine", 48.8601, 2.3605),
];

const NOW = new Date("2026-10-09T08:00:00Z");
const FIT_EPOCH_S = 631065600;

// --- Minimal FIT reader for the assertions (little-endian only) ---

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401,
  0x5000, 0x9c01, 0x8801, 0x4400,
];

function crc16(bytes: Uint8Array): number {
  let crc = 0;
  for (const byte of bytes) {
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[byte & 0xf];
    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(byte >> 4) & 0xf];
  }
  return crc;
}

interface Field {
  num: number;
  size: number;
  base: number;
}
interface Message {
  global: number;
  fields: Map<number, number | string>;
}

function readField(view: DataView, bytes: Uint8Array, pos: number, f: Field): number | string {
  switch (f.base & 0x1f) {
    case 0x00:
    case 0x02:
    case 0x0a:
      return bytes[pos];
    case 0x01:
      return view.getInt8(pos);
    case 0x03:
      return view.getInt16(pos, true);
    case 0x04:
    case 0x0b:
      return view.getUint16(pos, true);
    case 0x05:
      return view.getInt32(pos, true);
    case 0x06:
    case 0x0c:
      return view.getUint32(pos, true);
    case 0x07: {
      const raw = bytes.subarray(pos, pos + f.size);
      const nul = raw.indexOf(0);
      return new TextDecoder("utf-8", { fatal: true }).decode(
        nul >= 0 ? raw.subarray(0, nul) : raw,
      );
    }
    default:
      throw new Error(`unsupported base type ${f.base}`);
  }
}

function parseFit(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const headerSize = bytes[0];
  const dataSize = view.getUint32(4, true);
  const magic = new TextDecoder().decode(bytes.subarray(8, 12));
  const headerCrcOk = view.getUint16(12, true) === crc16(bytes.subarray(0, 12));
  const fileCrcOk =
    view.getUint16(bytes.length - 2, true) === crc16(bytes.subarray(0, bytes.length - 2));
  const defs = new Map<number, { global: number; fields: Field[] }>();
  const messages: Message[] = [];
  let pos = headerSize;
  const end = headerSize + dataSize;
  while (pos < end) {
    const header = bytes[pos++];
    const local = header & 0x0f;
    if (header & 0x40) {
      pos += 2; // reserved, architecture
      const global = view.getUint16(pos, true);
      pos += 2;
      const count = bytes[pos++];
      const fields: Field[] = [];
      for (let i = 0; i < count; i++) {
        fields.push({ num: bytes[pos], size: bytes[pos + 1], base: bytes[pos + 2] });
        pos += 3;
      }
      defs.set(local, { global, fields });
    } else {
      const def = defs.get(local);
      if (!def) throw new Error(`data message before definition for local type ${local}`);
      const fields = new Map<number, number | string>();
      for (const f of def.fields) {
        fields.set(f.num, readField(view, bytes, pos, f));
        pos += f.size;
      }
      messages.push({ global: def.global, fields });
    }
  }
  return {
    headerSize,
    dataSize,
    magic,
    headerCrcOk,
    fileCrcOk,
    messages,
    totalLength: bytes.length,
  };
}

const FILE_ID = 0;
const LAP = 19;
const RECORD = 20;
const EVENT = 21;
const COURSE = 31;
const COURSE_POINT = 32;

function semicirclesToDeg(v: number): number {
  return (v * 180) / 2 ** 31;
}

describe("FIT course export", () => {
  it("writes a FIT header whose size, magic and CRCs agree with the body", () => {
    const fit = parseFit(buildFitCourse(PARIS, POIS, NOW));
    expect(fit.headerSize).toBe(14);
    expect(fit.magic).toBe(".FIT");
    expect(fit.headerCrcOk).toBe(true);
    expect(fit.fileCrcOk).toBe(true);
    expect(fit.totalLength).toBe(14 + fit.dataSize + 2);
    expect(fit.messages.slice(0, 4).map((m) => m.global)).toEqual([FILE_ID, COURSE, LAP, EVENT]);
    expect(fit.messages[fit.messages.length - 1].global).toBe(EVENT);
    expect(fit.messages[0].fields.get(0)).toBe(6); // file type: course
    expect(fit.messages[1].fields.get(5)).toBe("Paris loop");
  });

  it("writes one record per trace point with timestamps and distance increasing", () => {
    const fit = parseFit(buildFitCourse(PARIS, POIS, NOW));
    const records = fit.messages.filter((m) => m.global === RECORD);
    expect(records).toHaveLength(PARIS.original.length);
    const start = (NOW.getTime() / 1000 - FIT_EPOCH_S) | 0;
    expect(records[0].fields.get(253)).toBe(start);
    expect(records[0].fields.get(5)).toBe(0);
    expect(semicirclesToDeg(records[0].fields.get(0) as number)).toBeCloseTo(48.8566, 5);
    expect(semicirclesToDeg(records[0].fields.get(1) as number)).toBeCloseTo(2.3522, 5);
    for (let i = 1; i < records.length; i++) {
      expect(records[i].fields.get(253) as number).toBeGreaterThan(
        records[i - 1].fields.get(253) as number,
      );
      expect(records[i].fields.get(5) as number).toBeGreaterThan(
        records[i - 1].fields.get(5) as number,
      );
    }
    // altitude is stored as (m + 500) * 5
    expect(records[0].fields.get(2)).toBe((35 + 500) * 5);
    const lap = fit.messages.find((m) => m.global === LAP);
    expect(lap?.fields.get(9)).toBe(records[records.length - 1].fields.get(5)); // total_distance
  });

  it("writes one typed course point per POI, projected on the track, in travel order", () => {
    const fit = parseFit(buildFitCourse(PARIS, POIS, NOW));
    const points = fit.messages.filter((m) => m.global === COURSE_POINT);
    expect(points.map((p) => p.fields.get(6))).toEqual(["Fontaine", "Camping Mairie"]);
    expect(points.map((p) => p.fields.get(5))).toEqual([3, 27]); // water, campsite
    const [water, camp] = points;
    expect(water.fields.get(4) as number).toBeGreaterThan(0);
    expect(camp.fields.get(4) as number).toBeGreaterThan(water.fields.get(4) as number);
    expect(camp.fields.get(1) as number).toBeGreaterThan(water.fields.get(1) as number);
    for (const [point, source] of [
      [water, POIS[1]],
      [camp, POIS[0]],
    ] as const) {
      const onTrack = {
        lat: semicirclesToDeg(point.fields.get(2) as number),
        lon: semicirclesToDeg(point.fields.get(3) as number),
      };
      expect(haversine(onTrack, source)).toBeLessThan(60);
      expect(haversine(onTrack, source)).toBeGreaterThan(0);
    }
    const lap = fit.messages.find((m) => m.global === LAP);
    expect(camp.fields.get(4) as number).toBeLessThanOrEqual(lap?.fields.get(9) as number);
  });

  it("keeps course point names within 15 bytes without splitting a multibyte character", () => {
    const long = poi("b", "Food shop", "Boulangerie Pâtisserie Élysée", 48.8601, 2.3605);
    const fit = parseFit(buildFitCourse(PARIS, [long], NOW));
    const point = fit.messages.find((m) => m.global === COURSE_POINT);
    const name = point?.fields.get(6) as string;
    expect(new TextEncoder().encode(name).length).toBeLessThanOrEqual(15);
    expect(name).toBe("Boulangerie Pâ");
  });

  it("exports one course per trace with the POIs of that trace", () => {
    const lyon = trace("lyon", "Lyon", [
      { lat: 45.76, lon: 4.83 },
      { lat: 45.77, lon: 4.84 },
    ]);
    const lyonPoi = poi("lyon-water", "Water", "Fontaine Lyon", 45.765, 4.835, "lyon");
    const files = buildFitCourses([...POIS, lyonPoi], [PARIS, lyon], NOW);
    expect(files.map((f) => f.filename)).toEqual(["paris-loop.fit", "lyon.fit"]);
    const names = files.map((f) =>
      parseFit(f.bytes)
        .messages.filter((m) => m.global === COURSE_POINT)
        .map((m) => m.fields.get(6)),
    );
    expect(names).toEqual([["Fontaine", "Camping Mairie"], ["Fontaine Lyon"]]);
  });
});
