// Export panel: one card per format, grouped by target (GPS, smartphone, files).
// The FIT card is the primary action: it is the only one that carries typed alerts.

import { useAtomValue } from "jotai";
import { lazy, Suspense, useState } from "react";
import {
  buildGeoJsonObject,
  buildGpxString,
  buildKmlString,
  buildKmzBlob,
  buildOsmAndGpxString,
  exportToFit,
} from "../lib/export";
import { downloadBlob, downloadFile } from "../lib/export/shared";
import { t } from "../lib/i18n";
import { serializeSession } from "../lib/session";
import { enrichmentsAtom } from "../state/enrichment";
import { filteredPoisAtom, tracesAtom } from "../state/route";
import { sessionSnapshotAtom } from "../state/session";
import { targetLanguageAtom } from "../state/ui";

const Roadbook = lazy(() => import("./Roadbook").then((m) => ({ default: m.Roadbook })));

function ExportCard({
  format,
  target,
  primary = false,
  disabled = false,
  onClick,
}: {
  format: string;
  target: string;
  primary?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`export-card${primary ? " is-primary" : ""}`}
      disabled={disabled}
      onClick={onClick}
    >
      <span className="export-card-format">{format}</span>
      <span className="export-card-target">{target}</span>
    </button>
  );
}

export function ExportPanel() {
  const pois = useAtomValue(filteredPoisAtom);
  const traces = useAtomValue(tracesAtom);
  const snapshot = useAtomValue(sessionSnapshotAtom);
  const enrichments = useAtomValue(enrichmentsAtom);
  const lang = useAtomValue(targetLanguageAtom);
  const [roadbookOpen, setRoadbookOpen] = useState(false);
  if (pois.length === 0) return null;

  const firstName = traces[0]?.name;
  const slug = firstName?.replace(/\s+/g, "-").toLowerCase();
  const baseName = slug
    ? traces.length === 1
      ? `ravitools-${slug}`
      : `ravitools-${traces.length}-routes`
    : "ravitools-pois";
  const hasEnrichments = enrichments.size > 0;

  const savePlan = () => {
    if (!snapshot) return;
    downloadFile(
      serializeSession(snapshot),
      slug ? `${slug}.ravitools.json` : "plan.ravitools.json",
      "application/json",
    );
  };

  return (
    <div className="export-panel">
      <p className="hint">
        {pois.length} {t("export.poisReady", lang)}
        {traces.length > 1 && ` (${traces.length} traces)`}
        {hasEnrichments && ` (${enrichments.size} ${t("export.enriched", lang)})`}
      </p>

      <div className="export-group">
        <div className="export-group-title">
          <span>{t("export.gps", lang)}</span>
        </div>
        <div className="export-grid">
          <ExportCard
            primary
            format="FIT"
            target={t("export.fitTarget", lang)}
            onClick={() => exportToFit(pois, traces)}
          />
          <ExportCard
            format="GPX"
            target={t("export.gpxTarget", lang)}
            onClick={() =>
              downloadFile(
                buildGpxString(pois, traces, enrichments),
                `${baseName}.gpx`,
                "application/gpx+xml",
              )
            }
          />
          <ExportCard
            format="KML"
            target={t("export.kmlTarget", lang)}
            onClick={() =>
              downloadFile(
                buildKmlString(pois, traces, enrichments),
                `${baseName}.kml`,
                "application/vnd.google-earth.kml+xml",
              )
            }
          />
          <ExportCard
            format="GeoJSON"
            target={t("export.geojsonTarget", lang)}
            onClick={() =>
              downloadFile(
                JSON.stringify(buildGeoJsonObject(pois, enrichments), null, 2),
                `${baseName}.geojson`,
                "application/geo+json",
              )
            }
          />
        </div>
      </div>

      <div className="export-group">
        <div className="export-group-title">
          <span>{t("export.smartphone", lang)}</span>
        </div>
        <div className="export-grid">
          <ExportCard
            format="GPX OsmAnd"
            target={t("export.osmandTarget", lang)}
            onClick={() =>
              downloadFile(
                buildOsmAndGpxString(pois, traces, enrichments),
                `${baseName}-osmand.gpx`,
                "application/gpx+xml",
              )
            }
          />
          <ExportCard
            format="KMZ"
            target={t("export.kmzTarget", lang)}
            onClick={() => downloadBlob(buildKmzBlob(pois, traces, enrichments), `${baseName}.kmz`)}
          />
        </div>
      </div>

      <div className="export-group">
        <div className="export-group-title">
          <span>{t("export.files", lang)}</span>
        </div>
        <div className="export-grid">
          <ExportCard
            format={t("export.plan", lang)}
            target={t("export.planBody", lang)}
            disabled={!snapshot}
            onClick={savePlan}
          />
          <ExportCard
            format={t("roadbook.title", lang)}
            target={t("roadbook.body", lang)}
            disabled={!snapshot}
            onClick={() => setRoadbookOpen(true)}
          />
        </div>
      </div>
      {roadbookOpen && (
        <Suspense fallback={null}>
          <Roadbook onClose={() => setRoadbookOpen(false)} />
        </Suspense>
      )}

      <details className="export-notes">
        <summary>{t("export.which", lang)}</summary>
        <p>
          <strong>FIT</strong> {t("export.fitBody", lang)}
        </p>
        <p>
          <strong>OsmAnd GPX</strong> {t("export.osmandBody", lang)}
        </p>
        <p>
          <strong>KMZ</strong> {t("export.kmzBody", lang)}
        </p>
        {hasEnrichments && (
          <p>
            <strong>{t("export.enrichedLabel", lang)}</strong> {t("export.enrichedBody", lang)}
          </p>
        )}
      </details>
    </div>
  );
}
