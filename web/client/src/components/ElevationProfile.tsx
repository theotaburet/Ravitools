// ---------------------------------------------------------------------------
// ElevationProfile – collapsible strip under the map: elevation curve of one
// trace with POIs positioned along it. Hover mirrors a marker on the map.
// ---------------------------------------------------------------------------

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildProfile, downsampleProfile, profileAt } from "../lib/elevation";
import { findGaps } from "../lib/gaps";
import { t } from "../lib/i18n";
import { CATEGORY_EMOJI } from "../lib/poi-config";
import { poisForTrace } from "../lib/trace-attribution";
import { filteredPoisAtom, poisAtom, tracesAtom } from "../state/route";
import {
  gapThresholdKmAtom,
  profileHoverAtom,
  selectedPoiIdAtom,
  targetLanguageAtom,
} from "../state/ui";

const VIEW_W = 1000;
const VIEW_H = 100;
const PAD_Y = 8;

export function ElevationProfile() {
  const traces = useAtomValue(tracesAtom);
  const pois = useAtomValue(filteredPoisAtom);
  const allPois = useAtomValue(poisAtom);
  const [gapThresholdKm, setGapThresholdKm] = useAtom(gapThresholdKmAtom);
  const targetLanguage = useAtomValue(targetLanguageAtom);
  const setSelectedPoiId = useSetAtom(selectedPoiIdAtom);
  const setProfileHover = useSetAtom(profileHoverAtom);

  const [collapsed, setCollapsed] = useState(false);
  const [traceChoice, setTraceChoice] = useState<string | null>(null);
  const [hoverX, setHoverX] = useState<number | null>(null);
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const trace = traces.find((tr) => tr.id === traceChoice) ?? traces[0];

  const profile = useMemo(
    () => (trace ? downsampleProfile(buildProfile(trace.original) ?? []) : []),
    [trace],
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

  // Clear the map marker when the strip unmounts (trace reset)
  useEffect(() => () => setProfileHover(null), [setProfileHover]);

  if (!trace || profile.length === 0) return null;

  let minEle = Infinity;
  let maxEle = -Infinity;
  for (const p of profile) {
    if (p.ele < minEle) minEle = p.ele;
    if (p.ele > maxEle) maxEle = p.ele;
  }
  const totalDist = profile[profile.length - 1].dist;
  const x = (dist: number) => (dist / totalDist) * VIEW_W;
  const y = (ele: number) =>
    VIEW_H - PAD_Y - ((ele - minEle) / (maxEle - minEle)) * (VIEW_H - 2 * PAD_Y);

  const linePath = profile
    .map((p, i) => `${i === 0 ? "M" : "L"}${x(p.dist).toFixed(1)},${y(p.ele).toFixed(1)}`)
    .join(" ");
  const areaPath = `${linePath} L${VIEW_W},${VIEW_H} L0,${VIEW_H} Z`;

  const handleMove = (e: React.MouseEvent) => {
    const rect = bodyRef.current?.getBoundingClientRect();
    if (!rect) return;
    const frac = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    setHoverX(frac);
    const at = profileAt(profile, frac * totalDist);
    setProfileHover({ lat: at.lat, lon: at.lon });
  };
  const handleLeave = () => {
    setHoverX(null);
    setProfileHover(null);
  };

  const hoverInfo = hoverX != null ? profileAt(profile, hoverX * totalDist) : null;

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
        {hoverInfo && !collapsed && (
          <span className="elevation-cursor-info">
            km {(hoverInfo.dist / 1000).toFixed(1)} · {Math.round(hoverInfo.ele)}m
          </span>
        )}
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
          <svg
            className="elevation-svg"
            viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
            preserveAspectRatio="none"
            role="img"
            aria-label={`${t("profile.title", targetLanguage)}: ${Math.round(minEle)}–${Math.round(maxEle)}m`}
          >
            <path d={areaPath} className="elevation-area" />
            <path d={linePath} className="elevation-line" vectorEffect="non-scaling-stroke" />
            {waterGaps.map((g) => (
              <rect
                key={`w${g.startM}`}
                x={x(g.startM)}
                y={0}
                width={Math.min(VIEW_W, x(g.endM)) - x(g.startM)}
                height={VIEW_H}
                className="gap-band-water"
              />
            ))}
            {foodGaps.map((g) => (
              <rect
                key={`f${g.startM}`}
                x={x(g.startM)}
                y={0}
                width={Math.min(VIEW_W, x(g.endM)) - x(g.startM)}
                height={VIEW_H}
                className="gap-band-food"
              />
            ))}
            {hoverX != null && (
              <line
                x1={hoverX * VIEW_W}
                y1={0}
                x2={hoverX * VIEW_W}
                y2={VIEW_H}
                className="elevation-cursor"
                vectorEffect="non-scaling-stroke"
              />
            )}
          </svg>
          <span className="elevation-axis elevation-axis-max">{Math.round(maxEle)}m</span>
          <span className="elevation-axis elevation-axis-min">{Math.round(minEle)}m</span>
          {tracePois.map((poi) => {
            const at = profileAt(profile, poi.alongTraceDistance);
            const topPct = (y(at.ele) / VIEW_H) * 100;
            return (
              <button
                type="button"
                key={poi.id}
                className="elevation-poi"
                style={{
                  left: `${Math.min(100, (poi.alongTraceDistance / totalDist) * 100).toFixed(2)}%`,
                  top: `${topPct.toFixed(2)}%`,
                }}
                aria-label={poi.name || poi.category}
                title={poi.name || poi.category}
                onClick={() => setSelectedPoiId(poi.id)}
              >
                {CATEGORY_EMOJI[poi.category] ?? "📍"}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
