// --- App: layout + session lifecycle (state lives in jotai atoms, src/state/) ---

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { lazy, Suspense, useCallback, useEffect, useMemo } from "react";
import { CategoryFilter } from "./components/CategoryFilter";
import { DebugPanel } from "./components/DebugPanel";
import { ElevationProfile } from "./components/ElevationProfile";
import { EnrichmentPanel } from "./components/EnrichmentPanel";
import { ExportPanel } from "./components/ExportPanel";
import { GpxUpload } from "./components/GpxUpload";
import { PoiList } from "./components/PoiList";
import { RouteMap } from "./components/RouteMap";
import { Step, type StepState } from "./components/Step";
import { TraceSummary } from "./components/TraceSummary";
import { t } from "./lib/i18n";
import { clearSession, hasSession, loadSession, saveSession } from "./lib/session";
import { enrichmentSettledAtom, enrichmentsAtom } from "./state/enrichment";
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
  selectedPoiIdAtom,
  sheetOpenAtom,
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

function ThemeIcon({ dark }: { dark: boolean }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {dark ? (
        <>
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
        </>
      ) : (
        <path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z" />
      )}
    </svg>
  );
}

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
  const enrichments = useAtomValue(enrichmentsAtom);
  const enrichmentSettled = useAtomValue(enrichmentSettledAtom);

  const [targetLanguage, setTargetLanguage] = useAtom(targetLanguageAtom);
  const [theme, setTheme] = useAtom(themeAtom);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = targetLanguage;
  }, [theme, targetLanguage]);
  const [selectedPoiId, setSelectedPoiId] = useAtom(selectedPoiIdAtom);
  const [showResumePrompt, setShowResumePrompt] = useAtom(showResumePromptAtom);
  const [sheetOpen, setSheetOpen] = useAtom(sheetOpenAtom);

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

  // Carnet de route: the sidebar is a numbered checklist of the real sequence.
  const traceStep: StepState = stage === "done" ? "done" : "active";
  const filterStep: StepState = stage === "done" ? "active" : "open";
  const enrichStep: StepState =
    stage !== "done" ? "todo" : enrichments.size > 0 && enrichmentSettled ? "done" : "open";
  const exportStep: StepState = stage === "done" ? "open" : "todo";

  return (
    <div className="flex flex-col h-full">
      <header className="app-header">
        <h1 className="app-brand">Ravitools</h1>
        <span className="neo-tag">beta</span>
        <p className="app-tagline">{t("app.subtitle", targetLanguage)}</p>
        <div className="app-controls">
          <div className="lang-switch">
            {(["fr", "en"] as const).map((lang) => (
              <button
                type="button"
                key={lang}
                aria-pressed={lang === targetLanguage}
                onClick={() => setTargetLanguage(lang)}
              >
                {lang.toUpperCase()}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="neo-btn-secondary neo-btn-icon"
            aria-pressed={theme === "dark"}
            title={t("theme.toggle", targetLanguage)}
            aria-label={t("theme.toggle", targetLanguage)}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <ThemeIcon dark={theme === "dark"} />
          </button>
        </div>
      </header>

      <div className="app-layout">
        {/* Sidebar: carnet de route (a bottom sheet over the map on small screens) */}
        <aside
          className={`sidebar ${sheetOpen ? "is-open" : ""}`}
          aria-label={t("steps.label", targetLanguage)}
        >
          <button
            type="button"
            className="sheet-handle"
            aria-expanded={sheetOpen}
            aria-controls="sidebar-panel"
            aria-label={t("sheet.toggle", targetLanguage)}
            onClick={() => setSheetOpen((open) => !open)}
          >
            <span className="sheet-grip" aria-hidden="true" />
          </button>
          <div className="sidebar-scroll" id="sidebar-panel">
            {/* 01: Load a route: upload, resume, pipeline status, errors */}
            <Step
              num={1}
              title={t("steps.trace", targetLanguage)}
              state={traceStep}
              doneLabel={t("steps.done", targetLanguage)}
            >
              {showResumePrompt && (
                <div className="session-prompt">
                  <p className="session-prompt-text">{t("session.prompt", targetLanguage)}</p>
                  <div className="session-prompt-actions">
                    <button
                      type="button"
                      className="neo-btn-sm neo-btn-primary"
                      onClick={handleResume}
                    >
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
                </div>
              )}

              {error && (
                <div className="error-box" role="alert">
                  <p>
                    <strong>{t("status.error", targetLanguage)}</strong> {error}
                  </p>
                  <div className="box-actions">
                    {traces.length > 0 && (
                      <button
                        type="button"
                        className="neo-btn-sm neo-btn-primary"
                        onClick={retryQuery}
                      >
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
            </Step>

            {/* 02: Refine: categories + max distance (usable before and after upload) */}
            <Step num={2} title={t("steps.filter", targetLanguage)} state={filterStep}>
              <CategoryFilter />
            </Step>

            {/* The result of 01 + 02: the POIs along the route */}
            {stage === "done" && <PoiList />}

            {/* 03: Enrich (optional, needs POIs and the server: not in the static build) */}
            {!STANDALONE && (
              <Step
                num={3}
                title={t("steps.enrich", targetLanguage)}
                state={enrichStep}
                doneLabel={t("steps.done", targetLanguage)}
              >
                <EnrichmentPanel />
                {sandboxMode && (
                  <Suspense fallback={null}>
                    <EnrichmentSandbox />
                  </Suspense>
                )}
              </Step>
            )}

            {/* 04: Export offline */}
            <Step
              num={STANDALONE ? 3 : 4}
              title={t("steps.export", targetLanguage)}
              state={exportStep}
            >
              <ExportPanel />
            </Step>

            {/* Debug log: always available, quiet */}
            <DebugPanel />
          </div>
        </aside>

        {/* Map + elevation profile */}
        <main className="map-container">
          <div className="map-area">
            <RouteMap />
          </div>
          <ElevationProfile />
        </main>
      </div>
    </div>
  );
}
