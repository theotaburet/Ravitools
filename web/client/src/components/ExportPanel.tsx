// ---------------------------------------------------------------------------
// Export panel (neobrutalist)
// Two sections: GPS devices + Smartphone offline apps
// ---------------------------------------------------------------------------

import { useAtomValue } from "jotai";
import { lazy, Suspense, useState } from "react";
import {
  exportToGeoJson,
  exportToGpx,
  exportToKml,
  exportToKmz,
  exportToOsmAndGpx,
} from "../lib/export";
import { downloadFile } from "../lib/export/shared";
import { t } from "../lib/i18n";
import { serializeSession } from "../lib/session";
import { enrichmentsAtom } from "../state/enrichment";
import {
  activeCategoriesAtom,
  filteredPoisAtom,
  poisAtom,
  routeSettingsAtom,
  stageAtom,
  tracesAtom,
} from "../state/route";
import { enrichAllAtom, targetLanguageAtom } from "../state/ui";

const Roadbook = lazy(() => import("./Roadbook").then((m) => ({ default: m.Roadbook })));

export function ExportPanel() {
  const pois = useAtomValue(filteredPoisAtom);
  const allPois = useAtomValue(poisAtom);
  const traces = useAtomValue(tracesAtom);
  const activeCategories = useAtomValue(activeCategoriesAtom);
  const routeSettings = useAtomValue(routeSettingsAtom);
  const stage = useAtomValue(stageAtom);
  const enrichments = useAtomValue(enrichmentsAtom);
  const enrichAll = useAtomValue(enrichAllAtom);
  const targetLanguage = useAtomValue(targetLanguageAtom);
  const [roadbookOpen, setRoadbookOpen] = useState(false);
  if (pois.length === 0) return null;

  const firstName = traces[0]?.name;
  const baseName = firstName
    ? traces.length === 1
      ? `ravitools-${firstName.replace(/\s+/g, "-").toLowerCase()}`
      : `ravitools-${traces.length}-routes`
    : "ravitools-pois";

  return (
    <div className="export-panel">
      <h3>{t("export.gps", targetLanguage)}</h3>
      <p className="text-xs text-muted font-mono mb-3">
        {pois.length} {t("export.poisReady", targetLanguage)}
        {traces.length > 1 && ` (${traces.length} traces)`}
        {enrichments &&
          enrichments.size > 0 &&
          ` (${enrichments.size} ${t("export.enriched", targetLanguage)})`}
      </p>

      {/* GPS device exports */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="neo-btn-lime w-full"
          onClick={() => exportToGpx(pois, traces, baseName, enrichments)}
        >
          .GPX (Garmin, Wahoo...)
        </button>
        <button
          type="button"
          className="neo-btn-secondary w-full"
          onClick={() => exportToKml(pois, traces, baseName, enrichments)}
        >
          .KML (Google Earth)
        </button>
        <button
          type="button"
          className="neo-btn-secondary w-full"
          onClick={() => exportToGeoJson(pois, baseName, enrichments)}
        >
          .GeoJSON
        </button>
      </div>

      {/* Smartphone offline apps */}
      <div className="export-divider" />
      <h3>{t("export.smartphone", targetLanguage)}</h3>
      <p className="text-xs text-muted font-mono mb-3">{t("export.offlineApps", targetLanguage)}</p>
      <div className="flex flex-col gap-2">
        <button
          type="button"
          className="neo-btn-pink w-full"
          onClick={() => exportToOsmAndGpx(pois, traces, baseName, enrichments)}
        >
          .GPX OsmAnd (icons + colors)
        </button>
        <button
          type="button"
          className="neo-btn-secondary w-full"
          onClick={() => exportToKmz(pois, traces, baseName, enrichments)}
        >
          .KMZ (Organic Maps, Guru Maps)
        </button>
      </div>

      {/* Plan file — full session as .ravitools.json */}
      <div className="export-divider" />
      <h3>{t("export.plan", targetLanguage)}</h3>
      <p className="text-xs text-muted font-mono mb-3">{t("export.planBody", targetLanguage)}</p>
      <button
        type="button"
        className="neo-btn-secondary w-full"
        disabled={stage !== "done"}
        onClick={() =>
          downloadFile(
            serializeSession({
              activeCategories,
              traces,
              pois: allPois,
              enrichments,
              targetLanguage,
              enrichAll,
              routeSettings,
            }),
            firstName
              ? `${firstName.replace(/\s+/g, "-").toLowerCase()}.ravitools.json`
              : "plan.ravitools.json",
            "application/json",
          )
        }
      >
        {t("export.savePlan", targetLanguage)}
      </button>

      {/* Roadbook */}
      <div className="export-divider" />
      <h3>{t("roadbook.title", targetLanguage)}</h3>
      <p className="text-xs text-muted font-mono mb-3">{t("roadbook.body", targetLanguage)}</p>
      <button
        type="button"
        className="neo-btn-secondary w-full"
        disabled={stage !== "done"}
        onClick={() => setRoadbookOpen(true)}
      >
        {t("roadbook.open", targetLanguage)}
      </button>
      {roadbookOpen && (
        <Suspense fallback={null}>
          <Roadbook onClose={() => setRoadbookOpen(false)} />
        </Suspense>
      )}

      <p className="text-xs text-muted mt-3 leading-snug">
        <strong>OsmAnd GPX</strong> {t("export.osmandBody", targetLanguage)}
        <br />
        <strong>KMZ</strong> {t("export.kmzBody", targetLanguage)}
        {enrichments && enrichments.size > 0 && (
          <>
            <br />
            <strong>{t("export.enrichedLabel", targetLanguage)}</strong>{" "}
            {t("export.enrichedBody", targetLanguage)}
          </>
        )}
      </p>
    </div>
  );
}
