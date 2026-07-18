// ---------------------------------------------------------------------------
// KMZ Export – zipped KML for Organic Maps, Guru Maps, Google Earth
// KMZ is a ZIP archive containing a single doc.kml file.
// ---------------------------------------------------------------------------

import type { EnrichedData, POI, TraceData } from "../../types";
import { buildKmlString } from "./kml";
import { downloadBlob } from "./shared";
import { buildZipSingleFile } from "./zip";

export function exportToKmz(
  pois: POI[],
  traces: TraceData[],
  filename: string = "ravitools-pois",
  enrichments?: Map<string, EnrichedData>,
): void {
  const blob = buildKmzBlob(pois, traces, enrichments);
  downloadBlob(blob, `${filename}.kmz`);
}

export function buildKmzBlob(
  pois: POI[],
  traces: TraceData[],
  enrichments?: Map<string, EnrichedData>,
): Blob {
  const kmlContent = buildKmlString(pois, traces, enrichments);
  const kmlBytes = new TextEncoder().encode(kmlContent);
  const zipBytes = buildZipSingleFile("doc.kml", kmlBytes);
  return new Blob([zipBytes.buffer as ArrayBuffer], { type: "application/vnd.google-earth.kmz" });
}
