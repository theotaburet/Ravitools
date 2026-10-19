// TraceSummary: what step 01 produced, at a glance. One row per trace with its own POI count
// (nearest-trace attribution, like the profile and roadbook) and its stretches without water or
// food past the alert threshold, which is set here.

import { useAtom, useAtomValue } from "jotai";
import { useMemo } from "react";
import { t } from "../lib/i18n";
import { filteredPoisAtom, ravitoGapsAtom, tracesAtom } from "../state/route";
import { gapThresholdKmAtom, targetLanguageAtom } from "../state/ui";

export function TraceSummary() {
  const traces = useAtomValue(tracesAtom);
  const pois = useAtomValue(filteredPoisAtom);
  const gaps = useAtomValue(ravitoGapsAtom);
  const [gapThresholdKm, setGapThresholdKm] = useAtom(gapThresholdKmAtom);
  const lang = useAtomValue(targetLanguageAtom);
  const counts = useMemo(
    () => traces.map((trace) => pois.filter((p) => p.traceId === trace.id).length),
    [pois, traces],
  );
  if (traces.length === 0) return null;

  return (
    <>
      <ul className="neo-box trace-summary">
        {traces.map((trace, i) => {
          const { water = [], food = [] } = gaps.get(trace.id) ?? {};
          const warnings = [
            water.length > 0 &&
              t("summary.gapsWater", lang, { n: water.length, km: gapThresholdKm }),
            food.length > 0 && t("summary.gapsFood", lang, { n: food.length, km: gapThresholdKm }),
          ].filter(Boolean);
          return (
            <li key={trace.id} className="trace-summary-row">
              <span
                className="trace-summary-swatch"
                style={{ backgroundColor: trace.color }}
                aria-hidden="true"
              />
              <span className="trace-summary-name">{trace.name ?? trace.id}</span>
              <span className="trace-summary-stats">
                {(trace.totalDistanceM / 1000).toFixed(1)} km · ↑{trace.elevationGainM}m ·{" "}
                {counts[i]} {t("summary.pois", lang)}
              </span>
              {warnings.length > 0 && (
                <span className="trace-summary-gaps">{warnings.join(" · ")}</span>
              )}
            </li>
          );
        })}
      </ul>
      <label className="gap-threshold">
        {t("profile.gapPrefix", lang)}
        <input
          type="number"
          min={1}
          value={gapThresholdKm}
          aria-label={t("profile.gapThreshold", lang)}
          onChange={(e) => setGapThresholdKm(Math.max(1, Number(e.target.value) || 1))}
        />
        km
      </label>
    </>
  );
}
