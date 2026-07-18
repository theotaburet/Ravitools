// ---------------------------------------------------------------------------
// Shared export helpers: XML escaping, downloads, colors, GPX symbols, tracks
// ---------------------------------------------------------------------------

import type { TraceData } from "../../types";

export function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

export function downloadFile(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  downloadBlob(blob, filename);
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function hexToKmlColor(hex: string): string {
  // KML uses aaBBGGRR format; input is #RRGGBB
  const clean = hex.replace("#", "");
  if (clean.length !== 6) return "ffffff";
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `${b}${g}${r}`;
}

export function mapCategoryToGpxSymbol(category: string): string {
  const symbols: Record<string, string> = {
    Water: "Drinking Water",
    "Sleeping place": "Campground",
    Restroom: "Restroom",
    Shelter: "Shelter",
    "Food shop": "Shopping Center",
    "Restaurant or Bar": "Restaurant",
    Gears: "Bike Trail",
    DIY: "Wrecker",
    Laundry: "Building",
    Medical: "Medical Facility",
    Pharmacy: "Pharmacy",
    "Bank & ATM": "Bank",
    "Post office": "Post Office",
    Viewpoint: "Scenic Area",
    "Tourist info": "Information",
    Charging: "Charging Station",
    Picnic: "Picnic Area",
    Wifi: "Library",
  };
  return symbols[category] ?? "Flag, Blue";
}

/** Build the GPX `<trk>` sections for all non-empty traces (shared by GPX and OsmAnd GPX). */
export function buildTrackSections(traces: TraceData[]): string {
  return traces
    .filter((t) => t.original.length > 0)
    .map((trace) => {
      const trkpts = trace.original
        .map((p) => {
          const elePart = p.ele != null ? `\n        <ele>${p.ele}</ele>` : "";
          return `      <trkpt lat="${p.lat}" lon="${p.lon}">${elePart}
      </trkpt>`;
        })
        .join("\n");

      return `
  <trk>
    <name>${escapeXml(trace.name ?? "Route")}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>`;
    })
    .join("");
}
