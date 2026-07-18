// ---------------------------------------------------------------------------
// ElevationProfile – collapsible strip under the map: elevation curve of one
// trace with POIs positioned along it. Hover mirrors a marker on the map.
// ---------------------------------------------------------------------------

import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo, useRef, useState } from "react";
import { buildProfile, downsampleProfile, profileAt } from "../lib/elevation";
import { TraceIndex } from "../lib/gpx-parser";
import { t } from "../lib/i18n";
import { CATEGORY_EMOJI } from "../lib/poi-config";
import { filteredPoisAtom, tracesAtom } from "../state/route";
import { profileHoverAtom, selectedPoiIdAtom, targetLanguageAtom } from "../state/ui";

const VIEW_W = 1000;
const VIEW_H = 100;
const PAD_Y = 8;

export function ElevationProfile() {
  const traces = useAtomValue(tracesAtom);
  const pois = useAtomValue(filteredPoisAtom);
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
  const tracePois = useMemo(() => {
    if (!trace) return [];
    if (traces.length === 1) return pois;
    const indices = traces.map((tr) => new TraceIndex(tr.original));
    const selectedIdx = traces.indexOf(trace);
    return pois.filter((poi) => {
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < indices.length; i++) {
        const d = indices[i].distanceTo(poi);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      return best === selectedIdx;
    });
  }, [trace, traces, pois]);

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
