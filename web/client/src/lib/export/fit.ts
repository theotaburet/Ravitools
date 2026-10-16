// FIT course export: the trace as a course plus one typed course point per POI.
// Garmin lists course points in Up Ahead, Wahoo and Hammerhead read them from
// FIT courses too. FIT protocol 2.0, little-endian, no compressed timestamps.
// Spec: https://developer.garmin.com/fit/protocol/

import type { POI, TraceData, TracePoint } from "../../types";
import { alongTraceProjection, haversine } from "../gpx-parser";
import { FIT_COURSE_POINT_TYPES } from "../poi-config";
import { downloadBlob } from "./shared";

const FIT_EPOCH_S = 631065600; // 1989-12-31T00:00:00Z
/** Devices want increasing timestamps on a course; 15 km/h gives them a plausible ETA. */
const COURSE_SPEED_MS = 15 / 3.6;
/** 15 bytes + NUL: what Garmin shows in Up Ahead before cutting. */
const POINT_NAME_BYTES = 16;
const COURSE_NAME_BYTES = 32;
const PROFILE_VERSION = 2178;

// Base types (FIT_BASE_TYPE)
const ENUM = 0x00;
const UINT8 = 0x02;
const STRING = 0x07;
const UINT16 = 0x84;
const SINT32 = 0x85;
const UINT32 = 0x86;
const UINT32Z = 0x8c;
const UINT16_INVALID = 0xffff;

// Global message numbers
const MSG_FILE_ID = 0;
const MSG_LAP = 19;
const MSG_RECORD = 20;
const MSG_EVENT = 21;
const MSG_COURSE = 31;
const MSG_COURSE_POINT = 32;

interface FieldDef {
  num: number;
  size: number;
  base: number;
}

const FILE_ID_FIELDS: FieldDef[] = [
  { num: 0, size: 1, base: ENUM }, // type
  { num: 1, size: 2, base: UINT16 }, // manufacturer
  { num: 2, size: 2, base: UINT16 }, // product
  { num: 3, size: 4, base: UINT32Z }, // serial_number
  { num: 4, size: 4, base: UINT32 }, // time_created
];
const COURSE_FIELDS: FieldDef[] = [
  { num: 4, size: 1, base: ENUM }, // sport
  { num: 5, size: COURSE_NAME_BYTES, base: STRING }, // name
];
const LAP_FIELDS: FieldDef[] = [
  { num: 253, size: 4, base: UINT32 }, // timestamp
  { num: 2, size: 4, base: UINT32 }, // start_time
  { num: 3, size: 4, base: SINT32 }, // start_position_lat
  { num: 4, size: 4, base: SINT32 }, // start_position_long
  { num: 5, size: 4, base: SINT32 }, // end_position_lat
  { num: 6, size: 4, base: SINT32 }, // end_position_long
  { num: 7, size: 4, base: UINT32 }, // total_elapsed_time (ms)
  { num: 8, size: 4, base: UINT32 }, // total_timer_time (ms)
  { num: 9, size: 4, base: UINT32 }, // total_distance (cm)
];
const EVENT_FIELDS: FieldDef[] = [
  { num: 253, size: 4, base: UINT32 }, // timestamp
  { num: 0, size: 1, base: ENUM }, // event (0 = timer)
  { num: 1, size: 1, base: ENUM }, // event_type (0 = start, 4 = stop_all)
  { num: 4, size: 1, base: UINT8 }, // event_group
];
const RECORD_FIELDS: FieldDef[] = [
  { num: 253, size: 4, base: UINT32 }, // timestamp
  { num: 0, size: 4, base: SINT32 }, // position_lat
  { num: 1, size: 4, base: SINT32 }, // position_long
  { num: 5, size: 4, base: UINT32 }, // distance (cm)
  { num: 2, size: 2, base: UINT16 }, // altitude ((m + 500) * 5)
];
const COURSE_POINT_FIELDS: FieldDef[] = [
  { num: 1, size: 4, base: UINT32 }, // timestamp
  { num: 2, size: 4, base: SINT32 }, // position_lat
  { num: 3, size: 4, base: SINT32 }, // position_long
  { num: 4, size: 4, base: UINT32 }, // distance (cm)
  { num: 5, size: 1, base: ENUM }, // type
  { num: 6, size: POINT_NAME_BYTES, base: STRING }, // name
];

// Local message types, one per definition written once at the top of the file
const LOCAL_FILE_ID = 0;
const LOCAL_COURSE = 1;
const LOCAL_LAP = 2;
const LOCAL_EVENT = 3;
const LOCAL_RECORD = 4;
const LOCAL_COURSE_POINT = 5;

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

class FitWriter {
  private readonly bytes: number[] = [];

  u8(v: number): void {
    this.bytes.push(v & 0xff);
  }
  u16(v: number): void {
    this.u8(v);
    this.u8(v >> 8);
  }
  /** Also used for sint32: two's complement bytes are the same. */
  u32(v: number): void {
    this.u16(v & 0xffff);
    this.u16((v >>> 16) & 0xffff);
  }
  /** UTF-8, NUL-terminated, padded to `size`; whole characters only. */
  str(s: string, size: number): void {
    const enc = new TextEncoder();
    let kept = "";
    for (const ch of s) {
      if (enc.encode(kept + ch).length > size - 1) break;
      kept += ch;
    }
    const bytes = enc.encode(kept);
    for (let i = 0; i < size; i++) this.u8(i < bytes.length ? bytes[i] : 0);
  }

  definition(local: number, global: number, fields: FieldDef[]): void {
    this.u8(0x40 | local);
    this.u8(0); // reserved
    this.u8(0); // architecture: little-endian
    this.u16(global);
    this.u8(fields.length);
    for (const f of fields) {
      this.u8(f.num);
      this.u8(f.size);
      this.u8(f.base);
    }
  }

  data(local: number, fields: FieldDef[], values: (number | string)[]): void {
    this.u8(local);
    fields.forEach((f, i) => {
      const v = values[i];
      if (f.base === STRING) this.str(String(v), f.size);
      else if (f.base === UINT16) this.u16(v as number);
      else if (f.size === 1) this.u8(v as number);
      else this.u32(v as number);
    });
  }

  /** Header (14 bytes with its own CRC), data, then the CRC over header and data. */
  finish(): Uint8Array {
    const data = Uint8Array.from(this.bytes);
    const out = new Uint8Array(14 + data.length + 2);
    const view = new DataView(out.buffer);
    out[0] = 14;
    out[1] = 0x20; // protocol 2.0
    view.setUint16(2, PROFILE_VERSION, true);
    view.setUint32(4, data.length, true);
    out.set([0x2e, 0x46, 0x49, 0x54], 8); // ".FIT"
    view.setUint16(12, crc16(out.subarray(0, 12)), true);
    out.set(data, 14);
    view.setUint16(14 + data.length, crc16(out.subarray(0, 14 + data.length)), true);
    return out;
  }
}

const semicircles = (deg: number): number => Math.round((deg * 2 ** 31) / 180);
const cm = (m: number): number => Math.round(m * 100);
const ms = (s: number): number => Math.round(s * 1000);

function cumulativeDistances(points: TracePoint[]): number[] {
  const cum = [0];
  for (let i = 1; i < points.length; i++)
    cum.push(cum[i - 1] + haversine(points[i - 1], points[i]));
  return cum;
}

/** Point on the polyline at `along` meters from its start (linear interpolation). */
function pointAt(points: TracePoint[], cum: number[], along: number): TracePoint {
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= along) lo = mid;
    else hi = mid;
  }
  const segLen = cum[hi] - cum[lo];
  const t = segLen > 0 ? Math.min(1, Math.max(0, (along - cum[lo]) / segLen)) : 0;
  return {
    lat: points[lo].lat + t * (points[hi].lat - points[lo].lat),
    lon: points[lo].lon + t * (points[hi].lon - points[lo].lon),
  };
}

/** One FIT course for `trace` (at least two points) with `pois` as course points on the track. */
export function buildFitCourse(trace: TraceData, pois: POI[], now: Date = new Date()): Uint8Array {
  const points = trace.original;
  const cum = cumulativeDistances(points);
  const total = cum[cum.length - 1];
  const start = Math.floor(now.getTime() / 1000) - FIT_EPOCH_S;
  const timeAt = (along: number): number => start + Math.round(along / COURSE_SPEED_MS);
  const first = points[0];
  const last = points[points.length - 1];
  const w = new FitWriter();

  w.definition(LOCAL_FILE_ID, MSG_FILE_ID, FILE_ID_FIELDS);
  w.data(LOCAL_FILE_ID, FILE_ID_FIELDS, [6, 255, 1, 0x52415649, start]); // course, development
  w.definition(LOCAL_COURSE, MSG_COURSE, COURSE_FIELDS);
  w.data(LOCAL_COURSE, COURSE_FIELDS, [2, trace.name ?? "Ravitools"]); // cycling
  w.definition(LOCAL_LAP, MSG_LAP, LAP_FIELDS);
  w.data(LOCAL_LAP, LAP_FIELDS, [
    timeAt(total),
    start,
    semicircles(first.lat),
    semicircles(first.lon),
    semicircles(last.lat),
    semicircles(last.lon),
    ms(total / COURSE_SPEED_MS),
    ms(total / COURSE_SPEED_MS),
    cm(total),
  ]);
  w.definition(LOCAL_EVENT, MSG_EVENT, EVENT_FIELDS);
  w.data(LOCAL_EVENT, EVENT_FIELDS, [start, 0, 0, 0]); // timer start

  w.definition(LOCAL_RECORD, MSG_RECORD, RECORD_FIELDS);
  points.forEach((p, i) => {
    const altitude = p.ele == null ? UINT16_INVALID : Math.round((p.ele + 500) * 5);
    w.data(LOCAL_RECORD, RECORD_FIELDS, [
      timeAt(cum[i]),
      semicircles(p.lat),
      semicircles(p.lon),
      cm(cum[i]),
      altitude,
    ]);
  });

  w.definition(LOCAL_COURSE_POINT, MSG_COURSE_POINT, COURSE_POINT_FIELDS);
  const placed = pois
    .map((poi) => ({ poi, along: alongTraceProjection(poi, points) }))
    .sort((a, b) => a.along - b.along);
  for (const { poi, along } of placed) {
    const at = pointAt(points, cum, along);
    w.data(LOCAL_COURSE_POINT, COURSE_POINT_FIELDS, [
      timeAt(along),
      semicircles(at.lat),
      semicircles(at.lon),
      cm(along),
      FIT_COURSE_POINT_TYPES[poi.category],
      poi.name,
    ]);
  }

  w.data(LOCAL_EVENT, EVENT_FIELDS, [timeAt(total), 0, 4, 0]); // timer stop_all
  return w.finish();
}

export interface FitFile {
  filename: string;
  bytes: Uint8Array;
}

/** One course per trace, each with the POIs nearest to that trace. */
export function buildFitCourses(
  pois: POI[],
  traces: TraceData[],
  now: Date = new Date(),
): FitFile[] {
  const usable = traces.filter((t) => t.original.length >= 2);
  return usable.map((trace, i) => {
    const slug = (trace.name ?? "").trim().replace(/\s+/g, "-").toLowerCase();
    return {
      filename: `${slug || `ravitools-route-${i + 1}`}.fit`,
      bytes: buildFitCourse(
        trace,
        pois.filter((p) => p.traceId === trace.id),
        now,
      ),
    };
  });
}

export function exportToFit(pois: POI[], traces: TraceData[]): void {
  // ponytail: one download per trace (the browser asks once for multiple files);
  // a multi-file zip if someone exports ten traces at a time.
  for (const file of buildFitCourses(pois, traces)) {
    downloadBlob(
      new Blob([file.bytes.buffer as ArrayBuffer], { type: "application/vnd.ant.fit" }),
      file.filename,
    );
  }
}
