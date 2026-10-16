// TraceSummary: what step 01 produced, at a glance. One row per trace with
// its own POI count (nearest-trace attribution, like the profile and roadbook).

import { useAtomValue } from "jotai";
import { useMemo } from "react";
import { t } from "../lib/i18n";
import { filteredPoisAtom, tracesAtom } from "../state/route";
import { targetLanguageAtom } from "../state/ui";

export function TraceSummary() {
  const traces = useAtomValue(tracesAtom);
  const pois = useAtomValue(filteredPoisAtom);
  const lang = useAtomValue(targetLanguageAtom);
  const counts = useMemo(
    () => traces.map((trace) => pois.filter((p) => p.traceId === trace.id).length),
    [pois, traces],
  );
  if (traces.length === 0) return null;

  return (
    <ul className="neo-box trace-summary">
      {traces.map((trace, i) => (
        <li key={trace.id} className="trace-summary-row">
          <span
            className="trace-summary-swatch"
            style={{ backgroundColor: trace.color }}
            aria-hidden="true"
          />
          <span className="trace-summary-name">{trace.name ?? trace.id}</span>
          <span className="trace-summary-stats">
            {(trace.totalDistanceM / 1000).toFixed(1)} km · ↑{trace.elevationGainM}m · {counts[i]}{" "}
            {t("summary.pois", lang)}
          </span>
        </li>
      ))}
    </ul>
  );
}
