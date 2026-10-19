// Export panel: the formats as radio cards (FIT first: the only one that carries typed alerts) and
// one download button; then the plan file and the roadbook. Colours follow the palette (design.md 8).

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
import { paletteAtom, targetLanguageAtom } from "../state/ui";

const Roadbook = lazy(() => import("./Roadbook").then((m) => ({ default: m.Roadbook })));

export function ExportPanel() {
  const pois = useAtomValue(filteredPoisAtom);
  const traces = useAtomValue(tracesAtom);
  const snapshot = useAtomValue(sessionSnapshotAtom);
  const enrichments = useAtomValue(enrichmentsAtom);
  const lang = useAtomValue(targetLanguageAtom);
  const palette = useAtomValue(paletteAtom);
  const [chosen, setChosen] = useState(0);
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

  const formats = [
    { label: "FIT", target: "export.fitTarget", run: () => exportToFit(pois, traces) },
    {
      label: "GPX",
      target: "export.gpxTarget",
      run: () =>
        downloadFile(
          buildGpxString(pois, traces, enrichments),
          `${baseName}.gpx`,
          "application/gpx+xml",
        ),
    },
    {
      label: "GPX OsmAnd",
      target: "export.osmandTarget",
      run: () =>
        downloadFile(
          buildOsmAndGpxString(pois, traces, enrichments, palette),
          `${baseName}-osmand.gpx`,
          "application/gpx+xml",
        ),
    },
    {
      label: "KMZ",
      target: "export.kmzTarget",
      run: () => downloadBlob(buildKmzBlob(pois, traces, enrichments, palette), `${baseName}.kmz`),
    },
    {
      label: "KML",
      target: "export.kmlTarget",
      run: () =>
        downloadFile(
          buildKmlString(pois, traces, enrichments, palette),
          `${baseName}.kml`,
          "application/vnd.google-earth.kml+xml",
        ),
    },
    {
      label: "GeoJSON",
      target: "export.geojsonTarget",
      run: () =>
        downloadFile(
          JSON.stringify(buildGeoJsonObject(pois, enrichments), null, 2),
          `${baseName}.geojson`,
          "application/geo+json",
        ),
    },
  ];
  const format = formats[chosen];

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

      <fieldset className="export-formats">
        <legend className="micro">{t("export.format", lang)}</legend>
        {formats.map((f, i) => (
          <label key={f.label} className="card export-card">
            <input
              type="radio"
              name="export-format"
              checked={i === chosen}
              onChange={() => setChosen(i)}
            />
            <span className="export-card-format">{f.label}</span>
            <span className="export-card-target">{t(f.target, lang)}</span>
          </label>
        ))}
      </fieldset>
      <button type="button" className="btn btn-primary dock" onClick={format.run}>
        {t("export.download", lang, { format: format.label })}
      </button>

      <div className="box-actions">
        <button type="button" className="btn btn-quiet" disabled={!snapshot} onClick={savePlan}>
          {t("export.plan", lang)}
        </button>
        <button
          type="button"
          className="btn btn-quiet"
          disabled={!snapshot}
          onClick={() => setRoadbookOpen(true)}
        >
          {t("roadbook.title", lang)}
        </button>
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
        <p>
          <strong>{t("export.plan", lang)}</strong> {t("export.planBody", lang)}
        </p>
        <p>
          <strong>{t("roadbook.title", lang)}</strong> {t("roadbook.body", lang)}
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
