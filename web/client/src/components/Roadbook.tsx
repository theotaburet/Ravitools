// ---------------------------------------------------------------------------
// Roadbook – printable route sheet: per-trace header, elevation SVG, POI table.
// Fullscreen overlay rendered in a portal; @media print hides the rest of the app.
// ---------------------------------------------------------------------------

import { useAtomValue } from "jotai";
import { createPortal } from "react-dom";
import { buildProfile, downsampleProfile } from "../lib/elevation";
import { splitHoursLines } from "../lib/export/hours";
import { t, translateCategory, translatePoiName } from "../lib/i18n";
import { CATEGORY_EMOJI } from "../lib/poi-config";
import { poisForTrace } from "../lib/trace-attribution";
import { enrichmentsAtom } from "../state/enrichment";
import { filteredPoisAtom, tracesAtom } from "../state/route";
import { targetLanguageAtom } from "../state/ui";
import type { TraceData } from "../types";

const VIEW_W = 1000;
const VIEW_H = 120;
const PAD_Y = 10;

function profilePath(trace: TraceData): string | null {
  const profile = downsampleProfile(buildProfile(trace.original) ?? []);
  if (profile.length === 0) return null;
  let minEle = Infinity;
  let maxEle = -Infinity;
  for (const p of profile) {
    if (p.ele < minEle) minEle = p.ele;
    if (p.ele > maxEle) maxEle = p.ele;
  }
  const total = profile[profile.length - 1].dist;
  return profile
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${((p.dist / total) * VIEW_W).toFixed(1)},${(
          VIEW_H - PAD_Y - ((p.ele - minEle) / (maxEle - minEle)) * (VIEW_H - 2 * PAD_Y)
        ).toFixed(1)}`,
    )
    .join(" ");
}

export function Roadbook({ onClose }: { onClose: () => void }) {
  const traces = useAtomValue(tracesAtom);
  const pois = useAtomValue(filteredPoisAtom);
  const enrichments = useAtomValue(enrichmentsAtom);
  const lang = useAtomValue(targetLanguageAtom);

  return createPortal(
    <div className="roadbook-overlay">
      <div className="roadbook-toolbar">
        <h2>{t("roadbook.title", lang)}</h2>
        <button type="button" className="neo-btn-lime" onClick={() => window.print()}>
          {t("roadbook.print", lang)}
        </button>
        <button type="button" className="neo-btn-secondary" onClick={onClose}>
          {t("roadbook.close", lang)}
        </button>
      </div>
      {traces.map((trace) => {
        const path = profilePath(trace);
        const tracePois = [...poisForTrace(pois, traces, trace)].sort(
          (a, b) => a.alongTraceDistance - b.alongTraceDistance,
        );
        return (
          <section key={trace.id} className="roadbook-trace">
            <h3>
              {trace.name ?? trace.id} · {(trace.totalDistanceM / 1000).toFixed(1)} km · ↑
              {trace.elevationGainM}m ↓{trace.elevationLossM}m
            </h3>
            {path && (
              <svg
                className="roadbook-profile"
                viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={t("profile.title", lang)}
              >
                <path d={path} fill="none" stroke="black" vectorEffect="non-scaling-stroke" />
              </svg>
            )}
            <table className="roadbook-table">
              <thead>
                <tr>
                  <th>{t("roadbook.km", lang)}</th>
                  <th>{t("roadbook.category", lang)}</th>
                  <th>{t("roadbook.name", lang)}</th>
                  <th>{t("roadbook.hours", lang)}</th>
                </tr>
              </thead>
              <tbody>
                {tracePois.map((poi) => {
                  const rawHours = enrichments.get(poi.id)?.hours ?? poi.tags.opening_hours ?? "";
                  return (
                    <tr key={poi.id}>
                      <td>{(poi.alongTraceDistance / 1000).toFixed(1)}</td>
                      <td>
                        {CATEGORY_EMOJI[poi.category] ?? "📍"}{" "}
                        {translateCategory(poi.category, lang)}
                      </td>
                      <td>{poi.name ? translatePoiName(poi.name, lang) : "—"}</td>
                      <td>{splitHoursLines(rawHours).join(" · ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>,
    document.body,
  );
}
