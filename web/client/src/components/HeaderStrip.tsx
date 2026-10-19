// --- Header strip (design.md 5.1): the counter and the compact profile of the selected trace,
// at the top of the sheet at every detent (floating at the bottom of the map on desktop) ---

import { useAtomValue, useSetAtom } from "jotai";
import { memo, useEffect, useMemo, useState } from "react";
import {
  buildProfile,
  downsampleProfile,
  elevationScale,
  type ProfilePoint,
  profileAt,
  type SlopeBucket,
  slopeBuckets,
  svgPath,
} from "../lib/elevation";
import { km, kmShort } from "../lib/format";
import type { Gap } from "../lib/gaps";
import { t } from "../lib/i18n";
import { FAMILY_COLORS } from "../lib/poi-config";
import { filteredPoisAtom, ravitoGapsAtom, tracesAtom } from "../state/route";
import {
  type MapViewBounds,
  mapCenterAtom,
  mapTraceHoverAtom,
  mapViewBoundsAtom,
  paletteAtom,
  profileHoverAtom,
  selectedTraceIdAtom,
  targetLanguageAtom,
} from "../state/ui";
import type { TraceData } from "../types";

const VIEW_W = 1000;
const VIEW_H = 100;
const PAD_Y = 6;
const RAIL_H = 6; // a stretch without water or food: a thin rail under the silhouette

/** Continuous slope → color: lime (≤0%) → yellow → red → near-black */
const SLOPE_STOPS: [number, [number, number, number]][] = [
  [0, [190, 242, 100]],
  [4, [250, 204, 21]],
  [8, [251, 146, 60]],
  [11, [239, 68, 68]],
  [15, [153, 27, 27]],
  [20, [69, 10, 10]],
];

function slopeColor(s: number): string {
  if (s <= SLOPE_STOPS[0][0]) return `rgb(${SLOPE_STOPS[0][1].join(",")})`;
  for (let i = 1; i < SLOPE_STOPS.length; i++) {
    const [s1, c1] = SLOPE_STOPS[i];
    if (s <= s1) {
      const [s0, c0] = SLOPE_STOPS[i - 1];
      const f = (s - s0) / (s1 - s0);
      const c = c0.map((v, k) => Math.round(v + (c1[k] - v) * f));
      return `rgb(${c.join(",")})`;
    }
  }
  return `rgb(${SLOPE_STOPS[SLOPE_STOPS.length - 1][1].join(",")})`;
}

/** The stretch of the trace the map shows; null when it shows all of it, or none */
function visibleStretch(
  profile: ProfilePoint[],
  bounds: MapViewBounds | null,
): { start: number; end: number } | null {
  if (!bounds || profile.length === 0) return null;
  let start = Infinity;
  let end = -Infinity;
  for (const p of profile) {
    if (p.lat >= bounds.south && p.lat <= bounds.north) {
      if (p.lon >= bounds.west && p.lon <= bounds.east) {
        start = Math.min(start, p.dist);
        end = Math.max(end, p.dist);
      }
    }
  }
  const total = profile[profile.length - 1].dist;
  if (!Number.isFinite(start) || (start === 0 && end === total)) return null;
  return { start, end };
}

export function HeaderStrip() {
  const traces = useAtomValue(tracesAtom);
  const selectedTraceId = useAtomValue(selectedTraceIdAtom);
  const pois = useAtomValue(filteredPoisAtom);

  const trace = traces.find((tr) => tr.id === selectedTraceId) ?? traces[0];
  if (!trace) return null;
  const poiCount = pois.filter((p) => p.traceId === trace.id).length;

  return (
    <div className="strip">
      <dl className="counter">
        <div>
          <dt className="micro">KM</dt>
          <dd>{kmShort(trace.totalDistanceM)}</dd>
        </div>
        <div>
          <dt className="micro">D+</dt>
          <dd>{trace.elevationGainM}</dd>
        </div>
        <div>
          <dt className="micro">POI</dt>
          <dd>{poiCount}</dd>
        </div>
      </dl>
      <Profile trace={trace} />
    </div>
  );
}

/** The whole trace: slope-coloured silhouette, stretches without water or food, the map's view
 *  highlighted. A transparent native slider on top: a tap or the arrow keys centre the map */
function Profile({ trace }: { trace: TraceData }) {
  const lang = useAtomValue(targetLanguageAtom);
  const mapBounds = useAtomValue(mapViewBoundsAtom);
  const mapHover = useAtomValue(mapTraceHoverAtom);
  const gaps = useAtomValue(ravitoGapsAtom).get(trace.id);
  const palette = useAtomValue(paletteAtom);
  const setProfileHover = useSetAtom(profileHoverAtom);
  const setMapCenter = useSetAtom(mapCenterAtom);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const [centredAt, setCentredAt] = useState(0);

  // Full resolution for slopes and positions, downsampled for drawing
  const fullProfile = useMemo(() => buildProfile(trace.original) ?? [], [trace]);
  const profile = useMemo(() => downsampleProfile(fullProfile), [fullProfile]);
  const total = profile.length > 0 ? profile[profile.length - 1].dist : 0;
  const heat = useMemo(() => slopeBuckets(fullProfile, 0, total, 120), [fullProfile, total]);
  const view = useMemo(() => visibleStretch(profile, mapBounds), [profile, mapBounds]);

  // Clear the map marker when the strip goes (trace reset)
  useEffect(() => () => setProfileHover(null), [setProfileHover]);

  if (profile.length === 0) return null;

  // The slider covers the drawing: its box is the profile's
  const handleMove = (e: React.MouseEvent<HTMLInputElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHoverX(frac);
    const at = profileAt(fullProfile, frac * total);
    setProfileHover({ lat: at.lat, lon: at.lon });
  };
  const handleLeave = () => {
    setHoverX(null);
    setProfileHover(null);
  };
  const centre = (dist: number) => {
    setCentredAt(dist);
    const at = profileAt(fullProfile, dist);
    setMapCenter({ lat: at.lat, lon: at.lon });
  };

  // A hover on the map trace shows here too; a local hover wins
  const mirroredX = mapHover?.traceId === trace.id ? mapHover.dist / total : null;
  const cursorX = hoverX ?? mirroredX;

  return (
    <div className="profile">
      <ProfileDrawing
        profile={profile}
        heat={heat}
        total={total}
        waterGaps={gaps?.water ?? []}
        foodGaps={gaps?.food ?? []}
        waterFill={FAMILY_COLORS[palette].Water.fill}
        foodFill={FAMILY_COLORS[palette].Food.fill}
        view={view}
      />
      {cursorX != null && (
        <div className="profile-cursor" style={{ left: `${(cursorX * 100).toFixed(2)}%` }} />
      )}
      <input
        type="range"
        className="profile-scrub"
        min={0}
        max={Math.round(total)}
        step={100}
        value={centredAt}
        aria-label={t("profile.centre", lang)}
        aria-valuetext={`km ${km(centredAt)}`}
        onChange={(e) => centre(Number(e.target.value))}
        onMouseMove={handleMove}
        onMouseLeave={handleLeave}
      />
    </div>
  );
}

// Memoized: a mousemove only re-renders the cursor, not the SVG
const ProfileDrawing = memo(function ProfileDrawing({
  profile,
  heat,
  total,
  waterGaps,
  foodGaps,
  waterFill,
  foodFill,
  view,
}: {
  profile: ProfilePoint[];
  heat: SlopeBucket[];
  total: number;
  waterGaps: Gap[];
  foodGaps: Gap[];
  waterFill: string;
  foodFill: string;
  view: { start: number; end: number } | null;
}) {
  const x = (dist: number) => (dist / total) * VIEW_W;
  const { y } = elevationScale(profile, VIEW_H, PAD_Y);
  const linePath = svgPath(profile.map((p) => [x(p.dist), y(p.ele)]));
  // Water on the bottom rail, food just above: the family colours (tab 01 says it in words)
  const rail = (g: Gap, fill: string, row: number) => (
    <rect
      key={`${row}-${g.startM}`}
      x={x(g.startM)}
      y={VIEW_H - (row + 1) * RAIL_H - row}
      width={x(g.endM) - x(g.startM)}
      height={RAIL_H}
      fill={fill}
    />
  );

  return (
    <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="none" aria-hidden="true">
      <defs>
        <clipPath id="profile-clip">
          <path d={`${linePath} L${VIEW_W},${VIEW_H} L0,${VIEW_H} Z`} />
        </clipPath>
        <linearGradient id="profile-slope" x1="0" y1="0" x2="1" y2="0">
          {heat.map((b) => (
            <stop
              key={b.startM}
              offset={`${(((b.startM + b.endM) / 2 / total) * 100).toFixed(2)}%`}
              stopColor={slopeColor(b.slopePct)}
            />
          ))}
        </linearGradient>
      </defs>
      <rect
        width={VIEW_W}
        height={VIEW_H}
        fill="url(#profile-slope)"
        clipPath="url(#profile-clip)"
      />
      <path d={linePath} className="profile-line" vectorEffect="non-scaling-stroke" />
      {waterGaps.map((g) => rail(g, waterFill, 0))}
      {foodGaps.map((g) => rail(g, foodFill, 1))}
      {/* Outside the map's view, dimmed: the lit part is what the map shows */}
      {view && (
        <>
          <rect width={x(view.start)} height={VIEW_H} className="profile-dim" />
          <rect
            x={x(view.end)}
            width={VIEW_W - x(view.end)}
            height={VIEW_H}
            className="profile-dim"
          />
        </>
      )}
    </svg>
  );
});
