// ---------------------------------------------------------------------------
// Export panel (neobrutalist)
// Two sections: GPS devices + Smartphone offline apps
// ---------------------------------------------------------------------------

import { useAtomValue } from "jotai";
import {
  exportToGeoJson,
  exportToGpx,
  exportToKml,
  exportToKmz,
  exportToOsmAndGpx,
} from "../lib/export";
import { t } from "../lib/i18n";
import { enrichmentsAtom } from "../state/enrichment";
import { filteredPoisAtom, tracesAtom } from "../state/route";
import { targetLanguageAtom } from "../state/ui";

export function ExportPanel() {
  const pois = useAtomValue(filteredPoisAtom);
  const traces = useAtomValue(tracesAtom);
  const enrichments = useAtomValue(enrichmentsAtom);
  const targetLanguage = useAtomValue(targetLanguageAtom);
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
