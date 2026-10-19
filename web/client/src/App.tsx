// --- App: layout + session lifecycle (state lives in jotai atoms, src/state/) ---

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { lazy, Suspense, useCallback, useEffect, useMemo } from "react";
import { CategoryFilter } from "./components/CategoryFilter";
import { DebugPanel } from "./components/DebugPanel";
import { ElevationProfile } from "./components/ElevationProfile";
import { EnrichmentPanel } from "./components/EnrichmentPanel";
import { ExportPanel } from "./components/ExportPanel";
import { GpxUpload } from "./components/GpxUpload";
import { PoiDetail } from "./components/PoiDetail";
import { PoiList } from "./components/PoiList";
import { RouteMap } from "./components/RouteMap";
import { Settings } from "./components/Settings";
import { type PillTab, Sheet, TabBar, TabPanel } from "./components/Sheet";
import { TraceSummary } from "./components/TraceSummary";
import { t } from "./lib/i18n";
import { clearSession, hasSession, loadSession, saveSession } from "./lib/session";
import {
  filteredPoisAtom,
  isProcessingAtom,
  progressAtom,
  progressRatioAtom,
  retryQueryAtom,
  routeErrorAtom,
  routeWarningAtom,
  stageAtom,
  tracesAtom,
} from "./state/route";
import { resetAllAtom, restoreSessionAtom, sessionSnapshotAtom } from "./state/session";
import {
  paletteAtom,
  selectedPoiIdAtom,
  sheetDetentAtom,
  showResumePromptAtom,
  targetLanguageAtom,
  themeAtom,
} from "./state/ui";

const EnrichmentSandbox = lazy(() =>
  import("./components/EnrichmentSandbox").then((module) => ({
    default: module.EnrichmentSandbox,
  })),
);

// Static build (GitHub Pages): no server, so no enrichment.
const STANDALONE = import.meta.env.VITE_STANDALONE === "true";
const TABS: PillTab[] = STANDALONE
  ? ["trace", "poi", "export"]
  : ["trace", "poi", "enrich", "export"];

export default function App() {
  const sandboxMode = useMemo(
    () =>
      typeof window !== "undefined" && new URLSearchParams(window.location.search).has("sandbox"),
    [],
  );

  const stage = useAtomValue(stageAtom);
  const traces = useAtomValue(tracesAtom);
  const filteredPois = useAtomValue(filteredPoisAtom);
  const isProcessing = useAtomValue(isProcessingAtom);
  const progress = useAtomValue(progressAtom);
  const progressRatio = useAtomValue(progressRatioAtom);
  const warning = useAtomValue(routeWarningAtom);
  const error = useAtomValue(routeErrorAtom);

  const targetLanguage = useAtomValue(targetLanguageAtom);
  const theme = useAtomValue(themeAtom);
  const palette = useAtomValue(paletteAtom);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.dataset.palette = palette;
    document.documentElement.lang = targetLanguage;
  }, [theme, palette, targetLanguage]);
  const [selectedPoiId, setSelectedPoiId] = useAtom(selectedPoiIdAtom);
  const [showResumePrompt, setShowResumePrompt] = useAtom(showResumePromptAtom);
  const detent = useAtomValue(sheetDetentAtom);

  const retryQuery = useSetAtom(retryQueryAtom);
  const handleReset = useSetAtom(resetAllAtom);
  const restoreSession = useSetAtom(restoreSessionAtom);
  const snapshot = useAtomValue(sessionSnapshotAtom);

  // On mount: offer to resume a saved session
  useEffect(() => {
    if (hasSession()) setShowResumePrompt(true);
  }, [setShowResumePrompt]);

  const handleResume = useCallback(() => {
    const session = loadSession();
    if (session) restoreSession(session);
    setShowResumePrompt(false);
  }, [restoreSession, setShowResumePrompt]);

  const handleDismissResume = useCallback(() => {
    clearSession();
    setShowResumePrompt(false);
  }, [setShowResumePrompt]);

  // Clear selection when the selected POI leaves the filtered set
  useEffect(() => {
    if (selectedPoiId && !filteredPois.some((p) => p.id === selectedPoiId)) {
      setSelectedPoiId(null);
    }
  }, [filteredPois, selectedPoiId, setSelectedPoiId]);

  // Auto-save once the pipeline is done with POIs
  useEffect(() => {
    if (snapshot && snapshot.pois.length > 0) saveSession(snapshot);
  }, [snapshot]);

  // Full-bleed map; the sheet (mobile) or panel (desktop) holds one tab at a time
  return (
    <div className="shell" data-detent={detent}>
      <main className="map-area">
        <RouteMap />
      </main>
      <Settings />
      <Sheet strip={<ElevationProfile />}>
        {/* 01: Load a route: upload, resume, pipeline status, errors */}
        <TabPanel tab="trace">
          {showResumePrompt && (
            <div className="session-prompt">
              <p className="session-prompt-text">{t("session.prompt", targetLanguage)}</p>
              <div className="session-prompt-actions">
                <button type="button" className="neo-btn-sm neo-btn-primary" onClick={handleResume}>
                  {t("session.resume", targetLanguage)}
                </button>
                <button
                  type="button"
                  className="neo-btn-sm neo-btn-secondary"
                  onClick={handleDismissResume}
                >
                  {t("session.fresh", targetLanguage)}
                </button>
              </div>
            </div>
          )}

          {(stage === "idle" || (stage === "error" && traces.length === 0)) &&
            !showResumePrompt && <GpxUpload />}

          {progress && (
            <div
              className={`status-bar ${stage === "error" ? "error" : ""}`}
              role="status"
              aria-live="polite"
            >
              {isProcessing && <span className="spinner" />}
              <div className="status-bar-body">
                <span>{progress}</span>
                {progressRatio != null && (
                  <div
                    className="progress-bar-track"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progressRatio * 100)}
                  >
                    <div
                      className="progress-bar-fill"
                      style={{ width: `${Math.round(progressRatio * 100)}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {warning && (
            <div className="warning-box">
              <p>
                <strong>{t("status.warning", targetLanguage)}</strong> {warning}
              </p>
              <div className="box-actions">
                <button type="button" className="neo-btn-sm neo-btn-primary" onClick={retryQuery}>
                  {t("action.retryQuery", targetLanguage)}
                </button>
              </div>
            </div>
          )}

          {error && (
            <div className="error-box" role="alert">
              <p>
                <strong>{t("status.error", targetLanguage)}</strong> {error}
              </p>
              <div className="box-actions">
                {traces.length > 0 && (
                  <button type="button" className="neo-btn-sm neo-btn-primary" onClick={retryQuery}>
                    {t("action.retryQuery", targetLanguage)}
                  </button>
                )}
                <button
                  type="button"
                  className="neo-btn-sm neo-btn-secondary"
                  onClick={handleReset}
                >
                  {traces.length > 0
                    ? t("action.startOver", targetLanguage)
                    : t("action.tryAgain", targetLanguage)}
                </button>
              </div>
            </div>
          )}

          {stage === "done" && (
            <>
              <TraceSummary />
              <button type="button" className="neo-btn-secondary w-full" onClick={handleReset}>
                {t("action.loadNew", targetLanguage)}
              </button>
            </>
          )}
        </TabPanel>

        {/* 02: the POIs along the route and their filters; a selected POI's detail replaces them,
            which stay mounted underneath (sort, scroll, open sections survive) */}
        <TabPanel tab="poi">
          <PoiDetail />
          <div className="poi-browse" hidden={selectedPoiId !== null}>
            <CategoryFilter />
            {stage === "done" && <PoiList />}
          </div>
        </TabPanel>

        {/* 03: Enrich (optional, needs the server: not in the static build) */}
        {!STANDALONE && (
          <TabPanel tab="enrich">
            <EnrichmentPanel />
            {sandboxMode && (
              <Suspense fallback={null}>
                <EnrichmentSandbox />
              </Suspense>
            )}
          </TabPanel>
        )}

        {/* 04: Export offline */}
        <TabPanel tab="export">
          <ExportPanel />
        </TabPanel>

        {/* Debug log, opened from the settings */}
        <TabPanel tab="debug">
          <DebugPanel />
        </TabPanel>
      </Sheet>
      <TabBar tabs={TABS} />
    </div>
  );
}
