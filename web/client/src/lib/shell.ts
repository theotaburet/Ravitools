// --- Shell geometry: the mobile sheet detents, shared by the sheet and the map camera ---

export type SheetDetent = "low" | "mid" | "full";

const DETENTS: SheetDetent[] = ["low", "mid", "full"];
const LOW_PX = 196; // handle + header strip + pill tabs (design.md 5.1)
const MAP_STRIP_PX = 64; // map left visible above the full sheet

/** Panel instead of sheet; the same breakpoint as the desktop rules in index.css */
export const DESKTOP_QUERY = "(min-width: 768px)";

/** Visible sheet height in px for a viewport height (mid never drops under low, in landscape) */
export function detentPx(detent: SheetDetent, vh: number): number {
  const mid = Math.max(LOW_PX, Math.round(vh * 0.52));
  if (detent === "low") return LOW_PX;
  return detent === "mid" ? mid : Math.max(mid, vh - MAP_STRIP_PX);
}

/** Where a dragged sheet settles: the closest detent */
export function nearestDetent(px: number, vh: number): SheetDetent {
  const gap = (d: SheetDetent) => Math.abs(detentPx(d, vh) - px);
  return DETENTS.reduce((a, b) => (gap(b) < gap(a) ? b : a));
}

/** Handle tap or Enter: low → mid → full → low */
export function nextDetent(detent: SheetDetent): SheetDetent {
  return DETENTS[(DETENTS.indexOf(detent) + 1) % DETENTS.length];
}
