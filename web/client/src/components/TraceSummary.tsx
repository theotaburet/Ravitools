// TraceSummary: what step 01 produced. One card per trace, the legend and selector of the map's
// traces: name, distance, elevation gain, its own POI count (nearest-trace attribution, like the
// strip and the roadbook) and its stretches without water or food past the alert threshold, which
// is set here.

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useMemo } from "react";
import { kmShort } from "../lib/format";
import { t } from "../lib/i18n";
import { filteredPoisAtom, ravitoGapsAtom, tracesAtom } from "../state/route";
import {
  gapThresholdKmAtom,
  selectedTraceIdAtom,
  selectTraceAtom,
  targetLanguageAtom,
} from "../state/ui";

export function TraceSummary() {
  const traces = useAtomValue(tracesAtom);
  const pois = useAtomValue(filteredPoisAtom);
  const gaps = useAtomValue(ravitoGapsAtom);
  const selectedTraceId = useAtomValue(selectedTraceIdAtom);
  const selectTrace = useSetAtom(selectTraceAtom);
  const [gapThresholdKm, setGapThresholdKm] = useAtom(gapThresholdKmAtom);
  const lang = useAtomValue(targetLanguageAtom);
  const counts = useMemo(
    () => traces.map((trace) => pois.filter((p) => p.traceId === trace.id).length),
    [pois, traces],
  );
  if (traces.length === 0) return null;

  return (
    <>
      <ul className="trace-cards">
        {traces.map((trace, i) => {
          const { water = [], food = [] } = gaps.get(trace.id) ?? {};
          const warnings = [
            water.length > 0 &&
              t("summary.gapsWater", lang, { n: water.length, km: gapThresholdKm }),
            food.length > 0 && t("summary.gapsFood", lang, { n: food.length, km: gapThresholdKm }),
          ].filter(Boolean);
          return (
            <li key={trace.id}>
              <button
                type="button"
                className="card trace-card"
                aria-pressed={trace.id === selectedTraceId}
                onClick={() => selectTrace(trace.id)}
              >
                <span className="trace-card-name">{trace.name ?? trace.id}</span>
                <span className="micro">
                  {kmShort(trace.totalDistanceM)} KM · {trace.elevationGainM} M D+ · {counts[i]} POI
                </span>
                {warnings.length > 0 && (
                  <span className="trace-card-gaps">{warnings.join(" · ")}</span>
                )}
              </button>
            </li>
          );
        })}
      </ul>
      <label className="gap-threshold">
        {t("profile.gapPrefix", lang)}
        <input
          type="number"
          className="field"
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
