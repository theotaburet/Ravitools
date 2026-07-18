// ---------------------------------------------------------------------------
// App – layout + session lifecycle (state lives in jotai atoms, src/state/)
// ---------------------------------------------------------------------------

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { CategoryFilter } from "./components/CategoryFilter";
import { DebugPanel } from "./components/DebugPanel";
import { EnrichmentPanel } from "./components/EnrichmentPanel";
import { ExportPanel } from "./components/ExportPanel";
import { GpxUpload } from "./components/GpxUpload";
import { PoiList } from "./components/PoiList";
import { RouteMap } from "./components/RouteMap";
import { t } from "./lib/i18n";
import { clearSession, hasSession, loadSession, saveSession } from "./lib/session";
import { enrichmentsAtom, resetEnrichmentAtom, restoreEnrichmentsAtom } from "./state/enrichment";
import {
  activeCategoriesAtom,
  filteredPoisAtom,
  isProcessingAtom,
  poisAtom,
  progressAtom,
  progressRatioAtom,
  resetRouteAtom,
  restoreRouteAtom,
  retryQueryAtom,
  routeErrorAtom,
  routeSettingsAtom,
  routeWarningAtom,
  stageAtom,
  tracesAtom,
} from "./state/route";
import {
  enrichAllAtom,
  selectedPoiIdAtom,
  showResumePromptAtom,
  targetLanguageAtom,
} from "./state/ui";

const EnrichmentSandbox = lazy(() =>
  import("./components/EnrichmentSandbox").then((module) => ({
    default: module.EnrichmentSandbox,
  })),
);

export default function App() {
  const sandboxMode = useMemo(
    () =>
      typeof window !== "undefined" && new URLSearchParams(window.location.search).has("sandbox"),
    [],
  );

  const stage = useAtomValue(stageAtom);
  const traces = useAtomValue(tracesAtom);
  const pois = useAtomValue(poisAtom);
  const activeCategories = useAtomValue(activeCategoriesAtom);
  const routeSettings = useAtomValue(routeSettingsAtom);
  const filteredPois = useAtomValue(filteredPoisAtom);
  const isProcessing = useAtomValue(isProcessingAtom);
  const progress = useAtomValue(progressAtom);
  const progressRatio = useAtomValue(progressRatioAtom);
  const warning = useAtomValue(routeWarningAtom);
  const error = useAtomValue(routeErrorAtom);
  const enrichments = useAtomValue(enrichmentsAtom);

  const [targetLanguage, setTargetLanguage] = useAtom(targetLanguageAtom);
  const [enrichAll, setEnrichAll] = useAtom(enrichAllAtom);
  const [selectedPoiId, setSelectedPoiId] = useAtom(selectedPoiIdAtom);
  const [showResumePrompt, setShowResumePrompt] = useAtom(showResumePromptAtom);

  const retryQuery = useSetAtom(retryQueryAtom);
  const reset = useSetAtom(resetRouteAtom);
  const restoreRoute = useSetAtom(restoreRouteAtom);
  const resetEnrichment = useSetAtom(resetEnrichmentAtom);
  const restoreEnrichments = useSetAtom(restoreEnrichmentsAtom);

  const restoredRef = useRef(false);

  // On mount: check for saved session
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (hasSession()) {
      setShowResumePrompt(true);
    }
  }, [setShowResumePrompt]);

  const handleResume = useCallback(() => {
    const session = loadSession();
    if (session) {
      restoreRoute({
        traces: session.traces,
        pois: session.pois,
        activeCategories: session.activeCategories,
        routeSettings: session.routeSettings,
      });
      restoreEnrichments(session.enrichments);
      setTargetLanguage(session.targetLanguage);
      setEnrichAll(session.enrichAll);
    }
    setShowResumePrompt(false);
  }, [restoreRoute, restoreEnrichments, setTargetLanguage, setEnrichAll, setShowResumePrompt]);

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

  // Auto-save session when pipeline is done and we have POIs
  useEffect(() => {
    if (stage !== "done" || pois.length === 0) return;
    saveSession({
      activeCategories,
      traces,
      pois,
      enrichments,
      targetLanguage,
      enrichAll,
      routeSettings,
    });
  }, [
    stage,
    pois,
    activeCategories,
    traces,
    routeSettings,
    enrichments,
    targetLanguage,
    enrichAll,
  ]);

  const handleReset = useCallback(() => {
    reset();
    resetEnrichment();
    setSelectedPoiId(null);
    clearSession();
  }, [reset, resetEnrichment, setSelectedPoiId]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center gap-4 px-5 py-3 border-b-3 border-black bg-white shrink-0">
        <h1 className="text-2xl font-black uppercase tracking-tight">Ravitools</h1>
        <span className="neo-tag bg-lime">beta</span>
        <p className="text-sm text-muted hidden sm:block">{t("app.subtitle", targetLanguage)}</p>
      </header>

      <div className="app-layout">
        {/* Sidebar */}
        <aside className="sidebar">
          {/* Category selector – pinned at top, never scrolls away */}
          <CategoryFilter />

          {/* Scrollable area for everything else */}
          <div className="sidebar-scroll">
            {/* Resume prompt */}
            {showResumePrompt && (
              <div className="session-prompt">
                <p className="session-prompt-text">{t("session.prompt", targetLanguage)}</p>
                <div className="session-prompt-actions">
                  <button type="button" className="neo-btn-sm neo-btn-lime" onClick={handleResume}>
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

            {/* Upload area – show when idle, or at error with no traces loaded */}
            {(stage === "idle" || (stage === "error" && traces.length === 0)) &&
              !showResumePrompt && <GpxUpload />}

            {/* Status / Progress */}
            {progress && (
              <div
                className={`status-bar ${stage === "error" ? "error" : ""}`}
                role="status"
                aria-live="polite"
              >
                {isProcessing && <span className="spinner" />}
                <div style={{ flex: 1 }}>
                  <span>{progress}</span>
                  {progressRatio != null && (
                    <div className="progress-bar-track" style={{ marginTop: "0.5rem" }}>
                      <div
                        className="progress-bar-fill"
                        style={{
                          width: `${Math.round(progressRatio * 100)}%`,
                          backgroundColor: "var(--color-lime)",
                        }}
                      />
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Warning banner (partial results) */}
            {warning && (
              <div className="warning-box">
                <p>
                  <span className="font-black uppercase">
                    {t("status.warning", targetLanguage)}
                  </span>{" "}
                  {warning}
                </p>
                <button type="button" className="neo-btn-sm neo-btn-lime" onClick={retryQuery}>
                  {t("action.retryChunks", targetLanguage)}
                </button>
              </div>
            )}

            {/* Error message */}
            {error && (
              <div className="error-box">
                <p>
                  <span className="font-black uppercase">{t("status.error", targetLanguage)}</span>{" "}
                  {error}
                </p>
                <div style={{ display: "flex", gap: "0.5rem" }}>
                  {traces.length > 0 && (
                    <button type="button" className="neo-btn-sm neo-btn-lime" onClick={retryQuery}>
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

            {/* Enrichment panel – shown when POIs are found */}
            {stage === "done" && <EnrichmentPanel />}

            {sandboxMode && stage === "done" && (
              <Suspense fallback={null}>
                <EnrichmentSandbox />
              </Suspense>
            )}

            {/* Export */}
            {stage === "done" && <ExportPanel />}

            {/* Reset button */}
            {stage === "done" && (
              <button type="button" className="neo-btn-secondary w-full" onClick={handleReset}>
                {t("action.loadNew", targetLanguage)}
              </button>
            )}

            {/* POI list */}
            {stage === "done" && <PoiList />}

            {/* Debug panel – always available */}
            <DebugPanel />
          </div>
        </aside>

        {/* Map */}
        <main className="map-container">
          <RouteMap />
        </main>
      </div>
    </div>
  );
}
