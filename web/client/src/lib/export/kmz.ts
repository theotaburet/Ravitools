// KMZ Export: zipped KML for Organic Maps, Guru Maps, Google Earth
// KMZ is a ZIP archive containing a single doc.kml file.

import type { EnrichedData, Palette, POI, TraceData } from "../../types";
import { buildKmlString } from "./kml";
import { buildZipSingleFile } from "./zip";

export function buildKmzBlob(
  pois: POI[],
  traces: TraceData[],
  enrichments?: Map<string, EnrichedData>,
  palette: Palette = "default",
): Blob {
  const kmlContent = buildKmlString(pois, traces, enrichments, palette);
  const kmlBytes = new TextEncoder().encode(kmlContent);
  const zipBytes = buildZipSingleFile("doc.kml", kmlBytes);
  return new Blob([zipBytes.buffer as ArrayBuffer], { type: "application/vnd.google-earth.kmz" });
}
