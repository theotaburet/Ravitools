// ---------------------------------------------------------------------------
// ElevationProfile – collapsible strip under the map: elevation curve of one
// trace with POIs positioned along it. Hover mirrors a marker on the map.
// ---------------------------------------------------------------------------

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildProfile,
  downsampleProfile,
  gainAt,
  type ProfilePoint,
  profileAt,
  type SlopeBucket,
  slopeBuckets,
} from "../lib/elevation";
import { findGaps, type Gap } from "../lib/gaps";
import { t } from "../lib/i18n";
import { clusterProfilePois, poiBounds } from "../lib/poi-cluster";
import { CATEGORY_EMOJI } from "../lib/poi-config";
import { poisForTrace } from "../lib/trace-attribution";
import { filteredPoisAtom, poisAtom, tracesAtom } from "../state/route";
import {
  gapThresholdKmAtom,
  mapFocusAtom,
  mapViewBoundsAtom,
  profileHoverAtom,
  selectedPoiIdAtom,
  targetLanguageAtom,
} from "../state/ui";
import type { POI, TargetLanguage } from "../types";

const VIEW_W = 1000;
const VIEW_H = 100;
const PAD_Y = 8;

/** Continuous slope → color: pale blue (descent) → green → yellow → red → near-black */
const SLOPE_STOPS: [number, [number, number, number]][] = [
  [-6, [147, 197, 253]],
  [-2, [219, 234, 254]],
  [1, [74, 222, 128]],
  [5, [250, 204, 21]],
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

const SLOPE_LEGEND = [3, 6, 9, 12, 16].map((s) => [s, slopeColor(s)] as const);

// Static (hover-independent) part of the strip, memoized: a mousemove only
// re-renders the cursor overlays in the parent, not this SVG + POI buttons.
const ProfileStatic = memo(function ProfileStatic({
  winProfile,
  fullProfile,
  profile,
  heat,
  waterGaps,
  foodGaps,
  tracePois,
  winStart,
  winEnd,
  totalDist,
  totalGain,
  minEle,
  maxEle,
  gainCurve,
  targetLanguage,
  onSelectPoi,
  onFocusCluster,
}: {
  winProfile: ProfilePoint[];
  fullProfile: ProfilePoint[];
  profile: ProfilePoint[];
  heat: SlopeBucket[];
  waterGaps: Gap[];
  foodGaps: Gap[];
  tracePois: POI[];
  winStart: number;
  winEnd: number;
  totalDist: number;
  totalGain: number;
  minEle: number;
  maxEle: number;
  gainCurve: { dist: number; gain: number }[];
  targetLanguage: TargetLanguage;
  onSelectPoi: (id: string) => void;
  onFocusCluster: (members: POI[]) => void;
}) {
  const { singles, clusters } = useMemo(
    () => clusterProfilePois(tracePois, winStart, winEnd),
    [tracePois, winStart, winEnd],
  );
  const x = (dist: number) => ((dist - winStart) / (winEnd - winStart)) * VIEW_W;
  const y = (ele: number) =>
    maxEle === minEle
      ? VIEW_H - PAD_Y
      : VIEW_H - PAD_Y - ((ele - minEle) / (maxEle - minEle)) * (VIEW_H - 2 * PAD_Y);

  const linePath = winProfile
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.dist).toFixed(1)},${y(p.ele).toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L${VIEW_W},${VIEW_H} L0,${VIEW_H} Z`;

  const yG = (g: number) =>
    VIEW_H - PAD_Y - (totalGain === 0 ? 0 : (g / totalGain) * (VIEW_H - 2 * PAD_Y));
  const gainPath = gainCurve
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.dist).toFixed(1)},${yG(p.gain).toFixed(1)}`)
    .join(" ");

  // Horizontal gridlines at round altitudes (Komoot-style): 2-4 lines
  const gridStep = [1000, 500, 200, 100, 50, 20, 10].find((s) => (maxEle - minEle) / s >= 2) ?? 10;
  const gridLevels: number[] = [];
  for (let e = Math.ceil(minEle / gridStep) * gridStep; e < maxEle; e += gridStep) {
    gridLevels.push(e);
  }

  return (
    <>
      <svg
        className="elevation-svg"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${t("profile.title", targetLanguage)}: ${Math.round(minEle)}–${Math.round(maxEle)}m`}
      >
        <defs>
          <clipPath id="ele-clip">
            <path d={areaPath} />
          </clipPath>
          <linearGradient id="slope-grad" x1="0" y1="0" x2="1" y2="0">
            {heat.map((b) => (
              <stop
                key={b.startM}
                offset={`${((((b.startM + b.endM) / 2 - winStart) / (winEnd - winStart)) * 100).toFixed(2)}%`}
                stopColor={slopeColor(b.slopePct)}
              />
            ))}
          </linearGradient>
        </defs>
        {gridLevels.map((e) => (
          <line
            key={e}
            x1={0}
            y1={y(e)}
            x2={VIEW_W}
            y2={y(e)}
            className="elevation-grid"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {/* Komoot-style fill: smooth slope gradient clipped under the curve */}
        <g clipPath="url(#ele-clip)">
          <rect
            x={0}
            y={0}
            width={VIEW_W}
            height={VIEW_H}
            fill="url(#slope-grad)"
            className="elevation-slope-fill"
          />
        </g>
        <path d={gainPath} className="elevation-gain-line" vectorEffect="non-scaling-stroke" />
        <path d={linePath} className="elevation-line" vectorEffect="non-scaling-stroke" />
        {waterGaps.map((g) => {
          const s = Math.max(winStart, g.startM);
          const e = Math.min(winEnd, g.endM);
          if (e <= s) return null;
          return (
            <rect
              key={`w${g.startM}`}
              x={x(s)}
              y={0}
              width={x(e) - x(s)}
              height={VIEW_H}
              className="gap-band-water"
            />
          );
        })}
        {foodGaps.map((g) => {
          const s = Math.max(winStart, g.startM);
          const e = Math.min(winEnd, g.endM);
          if (e <= s) return null;
          return (
            <rect
              key={`f${g.startM}`}
              x={x(s)}
              y={0}
              width={x(e) - x(s)}
              height={VIEW_H}
              className="gap-band-food"
            />
          );
        })}
      </svg>
      {gridLevels.length > 0 ? (
        gridLevels.map((e) => (
          <span
            key={e}
            className="elevation-gridlabel"
            style={{ top: `${((y(e) / VIEW_H) * 100).toFixed(2)}%` }}
          >
            {e} m
          </span>
        ))
      ) : (
        <>
          <span className="elevation-axis elevation-axis-max">{Math.round(maxEle)}m</span>
          <span className="elevation-axis elevation-axis-min">{Math.round(minEle)}m</span>
        </>
      )}
      <span className="elevation-legend" aria-hidden="true">
        {SLOPE_LEGEND.map(([pct, color]) => (
          <span key={pct} className="elevation-legend-item">
            <i style={{ background: color }} />
            {pct}%
          </span>
        ))}
      </span>
      {winStart === 0 && (
        <span className="elevation-flag left" aria-hidden="true">
          🚩
        </span>
      )}
      {winEnd === totalDist && (
        <span className="elevation-flag right" aria-hidden="true">
          🏁
        </span>
      )}
      {winStart > 0 && (
        <span className="elevation-offscreen left" role="status">
          ← {(winStart / 1000).toFixed(1)} km · ↑{Math.round(gainAt(fullProfile, winStart))} m
        </span>
      )}
      {winEnd < totalDist && (
        <span className="elevation-offscreen right" role="status">
          {((totalDist - winEnd) / 1000).toFixed(1)} km · ↑
          {Math.round(totalGain - gainAt(fullProfile, winEnd))} m →
        </span>
      )}
      {singles.map((poi) => {
        const at = profileAt(profile, poi.alongTraceDistance);
        const topPct = (y(at.ele) / VIEW_H) * 100;
        const leftPct = ((poi.alongTraceDistance - winStart) / (winEnd - winStart)) * 100;
        return (
          <button
            type="button"
            key={poi.id}
            className="elevation-poi"
            style={{
              left: `${Math.min(100, leftPct).toFixed(2)}%`,
              top: `${topPct.toFixed(2)}%`,
            }}
            aria-label={poi.name || poi.category}
            title={poi.name || poi.category}
            onClick={() => onSelectPoi(poi.id)}
          >
            {CATEGORY_EMOJI[poi.category] ?? "📍"}
          </button>
        );
      })}
      {clusters.map((c) => {
        const at = profileAt(profile, c.dist);
        const topPct = (y(at.ele) / VIEW_H) * 100;
        const leftPct = ((c.dist - winStart) / (winEnd - winStart)) * 100;
        const label = `${c.count} ${t("profile.cluster", targetLanguage)}`;
        return (
          <button
            type="button"
            key={`cluster-${c.dist.toFixed(0)}`}
            className="elevation-poi elevation-poi-cluster"
            style={{
              left: `${Math.min(100, leftPct).toFixed(2)}%`,
              top: `${topPct.toFixed(2)}%`,
            }}
            aria-label={label}
            title={label}
            onClick={() => onFocusCluster(c.members)}
          >
            {c.count}
          </button>
        );
      })}
    </>
  );
});

export function ElevationProfile() {
  const traces = useAtomValue(tracesAtom);
  const pois = useAtomValue(filteredPoisAtom);
  const allPois = useAtomValue(poisAtom);
  const [gapThresholdKm, setGapThresholdKm] = useAtom(gapThresholdKmAtom);
  const targetLanguage = useAtomValue(targetLanguageAtom);
  const setSelectedPoiId = useSetAtom(selectedPoiIdAtom);
  const setProfileHover = useSetAtom(profileHoverAtom);
  const setMapFocus = useSetAtom(mapFocusAtom);
  const handleFocusCluster = useCallback(
    (members: POI[]) => setMapFocus(poiBounds(members)),
    [setMapFocus],
  );

  const [collapsed, setCollapsed] = useState(false);
  const [traceChoice, setTraceChoice] = useState<string | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const trace = traces.find((tr) => tr.id === traceChoice) ?? traces[0];
  const mapBounds = useAtomValue(mapViewBoundsAtom);

  // Full-resolution profile for slope/D+ (no smoothing), downsampled for drawing
  const fullProfile = useMemo(() => (trace ? (buildProfile(trace.original) ?? []) : []), [trace]);
  const profile = useMemo(() => downsampleProfile(fullProfile), [fullProfile]);

  // Window the profile to the portion of the trace visible on the map
  const { winStart, winEnd } = useMemo(() => {
    const totalD = profile.length > 0 ? profile[profile.length - 1].dist : 0;
    if (!mapBounds || totalD === 0) return { winStart: 0, winEnd: totalD };
    let lo = Infinity;
    let hi = -Infinity;
    for (const p of profile) {
      if (
        p.lat >= mapBounds.south &&
        p.lat <= mapBounds.north &&
        p.lon >= mapBounds.west &&
        p.lon <= mapBounds.east
      ) {
        if (p.dist < lo) lo = p.dist;
        if (p.dist > hi) hi = p.dist;
      }
    }
    // Nothing (or a sliver) visible → show the whole trace
    if (!Number.isFinite(lo) || hi - lo < 1000) return { winStart: 0, winEnd: totalD };
    return { winStart: lo, winEnd: hi };
  }, [mapBounds, profile]);

  // Slope heatmap over the visible window, from the full-res profile
  const heat = useMemo(
    () => slopeBuckets(fullProfile, winStart, winEnd, 120),
    [fullProfile, winStart, winEnd],
  );

  // Attribute each POI to its nearest trace so dots land on the right profile
  const tracePois = useMemo(
    () => (trace ? poisForTrace(pois, traces, trace) : []),
    [trace, traces, pois],
  );

  // Ravito gaps — computed from ALL POIs (unfiltered): unchecking a category
  // in the filter must not turn the trace into a fake desert.
  const { waterGaps, foodGaps } = useMemo(() => {
    if (!trace) return { waterGaps: [], foodGaps: [] };
    const mine = poisForTrace(allPois, traces, trace);
    const thresholdM = gapThresholdKm * 1000;
    const water = mine.filter((p) => p.category === "Water").map((p) => p.alongTraceDistance);
    const food = mine
      .filter((p) => p.category === "Food shop" || p.category === "Restaurant or Bar")
      .map((p) => p.alongTraceDistance);
    return {
      waterGaps: findGaps(water, trace.totalDistanceM, thresholdM),
      foodGaps: findGaps(food, trace.totalDistanceM, thresholdM),
    };
  }, [trace, traces, allPois, gapThresholdKm]);

  const winProfile = useMemo(() => {
    if (profile.length === 0) return profile;
    const totalD = profile[profile.length - 1].dist;
    if (winStart === 0 && winEnd === totalD) return profile;
    return [
      profileAt(profile, winStart),
      ...profile.filter((p) => p.dist > winStart && p.dist < winEnd),
      profileAt(profile, winEnd),
    ];
  }, [profile, winStart, winEnd]);

  // Cumulative D+ at each drawn point (full-res data, memoized — gainAt is O(n))
  const gainCurve = useMemo(
    () => winProfile.map((p) => ({ dist: p.dist, gain: gainAt(fullProfile, p.dist) })),
    [winProfile, fullProfile],
  );

  // Clear the map marker when the strip unmounts (trace reset)
  useEffect(() => () => setProfileHover(null), [setProfileHover]);

  if (!trace || profile.length === 0) return null;

  const totalDist = profile[profile.length - 1].dist;
  const totalGain = gainAt(fullProfile, totalDist);

  let minEle = Infinity;
  let maxEle = -Infinity;
  for (const p of winProfile) {
    if (p.ele < minEle) minEle = p.ele;
    if (p.ele > maxEle) maxEle = p.ele;
  }
  // y() duplicated from ProfileStatic — the hover overlays need it too
  const y = (ele: number) =>
    maxEle === minEle
      ? VIEW_H - PAD_Y
      : VIEW_H - PAD_Y - ((ele - minEle) / (maxEle - minEle)) * (VIEW_H - 2 * PAD_Y);

  const handleMove = (e: React.MouseEvent) => {
    const rect = bodyRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHoverX(frac);
    const at = profileAt(profile, winStart + frac * (winEnd - winStart));
    setProfileHover({ lat: at.lat, lon: at.lon });
  };
  const handleLeave = () => {
    setHoverX(null);
    setProfileHover(null);
  };

  const hoverInfo =
    hoverX != null ? profileAt(profile, winStart + hoverX * (winEnd - winStart)) : null;
  // Local slope at the cursor: ±50m window on the full-res profile
  let hoverSlope = 0;
  if (hoverInfo) {
    const a = profileAt(fullProfile, hoverInfo.dist - 50);
    const b = profileAt(fullProfile, hoverInfo.dist + 50);
    const run = b.dist - a.dist;
    hoverSlope = run > 0 ? ((b.ele - a.ele) / run) * 100 : 0;
  }

  return (
    <div className="elevation-strip">
      <div className="elevation-header">
        <button
          type="button"
          className="elevation-toggle"
          aria-expanded={!collapsed}
          onClick={() => setCollapsed((c) => !c)}
        >
          <span aria-hidden="true">{collapsed ? "▸" : "▾"}</span>{" "}
          {t("profile.title", targetLanguage)}
        </button>
        <span className="elevation-stats">
          {trace.name ?? trace.id} · {(trace.totalDistanceM / 1000).toFixed(1)} km · ↑
          {trace.elevationGainM}m ↓{trace.elevationLossM}m
        </span>
        <span className="gap-controls">
          <label className="gap-threshold">
            &gt;
            <input
              type="number"
              min={1}
              value={gapThresholdKm}
              aria-label={t("profile.gapThreshold", targetLanguage)}
              onChange={(e) => setGapThresholdKm(Math.max(1, Number(e.target.value) || 1))}
            />
            km
          </label>
          {(waterGaps.length > 0 || foodGaps.length > 0) && (
            <span className="gap-summary" role="status">
              ⚠{" "}
              {[
                waterGaps.length > 0 &&
                  `${waterGaps.length} × >${gapThresholdKm} km ${t("profile.without", targetLanguage)} 💧`,
                foodGaps.length > 0 &&
                  `${foodGaps.length} × >${gapThresholdKm} km ${t("profile.without", targetLanguage)} 🛒`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </span>
        {traces.length > 1 && (
          <span className="elevation-chips">
            {traces.map((tr) => (
              <button
                type="button"
                key={tr.id}
                className={`elevation-chip ${tr.id === trace.id ? "active" : ""}`}
                style={{ backgroundColor: tr.color }}
                aria-pressed={tr.id === trace.id}
                title={tr.name ?? tr.id}
                onClick={() => setTraceChoice(tr.id)}
              />
            ))}
          </span>
        )}
      </div>

      {!collapsed && (
        // biome-ignore lint/a11y/noStaticElementInteractions: hover sync is a pointer-only enhancement — the POI buttons inside remain the keyboard-accessible controls
        <div
          ref={bodyRef}
          className="elevation-body"
          onMouseMove={handleMove}
          onMouseLeave={handleLeave}
        >
          <ProfileStatic
            winProfile={winProfile}
            fullProfile={fullProfile}
            profile={profile}
            heat={heat}
            waterGaps={waterGaps}
            foodGaps={foodGaps}
            tracePois={tracePois}
            winStart={winStart}
            winEnd={winEnd}
            totalDist={totalDist}
            totalGain={totalGain}
            minEle={minEle}
            maxEle={maxEle}
            gainCurve={gainCurve}
            targetLanguage={targetLanguage}
            onSelectPoi={setSelectedPoiId}
            onFocusCluster={handleFocusCluster}
          />
          {hoverX != null && (
            <div
              className="elevation-cursor-line"
              style={{ left: `${(hoverX * 100).toFixed(2)}%` }}
            />
          )}
          {hoverInfo && hoverX != null && (
            <>
              <div
                className="elevation-dot"
                style={{
                  left: `${(hoverX * 100).toFixed(2)}%`,
                  top: `${((y(hoverInfo.ele) / VIEW_H) * 100).toFixed(2)}%`,
                }}
              />
              <div
                className={`elevation-tooltip${hoverX > 0.6 ? " flip" : ""}`}
                style={{
                  left: `${(hoverX * 100).toFixed(2)}%`,
                  top: `${((y(hoverInfo.ele) / VIEW_H) * 100).toFixed(2)}%`,
                }}
              >
                <strong>km {(hoverInfo.dist / 1000).toFixed(1)}</strong> ·{" "}
                {Math.round(hoverInfo.ele)} m · ↑{Math.round(gainAt(fullProfile, hoverInfo.dist))} m
                ·{" "}
                <span style={{ color: slopeColor(hoverSlope), fontWeight: 700 }}>
                  {hoverSlope > 0 ? "+" : ""}
                  {hoverSlope.toFixed(1)} %
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
