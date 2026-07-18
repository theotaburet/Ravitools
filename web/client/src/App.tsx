// ---------------------------------------------------------------------------
// App – layout + session lifecycle (state lives in jotai atoms, src/state/)
// ---------------------------------------------------------------------------

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef } from "react";
import { CategoryFilter } from "./components/CategoryFilter";
import { DebugPanel } from "./components/DebugPanel";
import { ElevationProfile } from "./components/ElevationProfile";
import { EnrichmentPanel } from "./components/EnrichmentPanel";
import { ExportPanel } from "./components/ExportPanel";
import { GpxUpload } from "./components/GpxUpload";
import { PoiList } from "./components/PoiList";
import { RouteMap } from "./components/RouteMap";
import { Step, type StepState } from "./components/Step";
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

  // Carnet de route: the sidebar is a numbered checklist of the real sequence.
  const traceStep: StepState = stage === "done" ? "done" : "active";
  const filterStep: StepState = stage === "done" ? "active" : "open";
  const enrichStep: StepState = stage !== "done" ? "todo" : enrichments.size > 0 ? "done" : "open";
  const exportStep: StepState = stage === "done" ? "open" : "todo";

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center gap-4 px-5 py-3 border-b-3 border-black bg-white shrink-0">
        <h1 className="text-2xl font-black uppercase tracking-tight">Ravitools</h1>
        <span className="neo-tag bg-lime">beta</span>
        <p className="text-sm text-muted hidden sm:block flex-1">
          {t("app.subtitle", targetLanguage)}
        </p>
        <div className="flex gap-1">
          {(["fr", "en"] as const).map((lang) => (
            <button
              type="button"
              key={lang}
              className={`neo-btn-sm ${lang === targetLanguage ? "neo-btn-primary" : "neo-btn-secondary"}`}
              aria-pressed={lang === targetLanguage}
              onClick={() => setTargetLanguage(lang)}
            >
              {lang.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <div className="app-layout">
        {/* Sidebar — carnet de route */}
        <aside className="sidebar" aria-label={t("steps.label", targetLanguage)}>
          <div className="sidebar-scroll">
            {/* 01 — Load a route: upload, resume, pipeline status, errors */}
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
                      className="neo-btn-sm neo-btn-lime"
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
                  <div style={{ flex: 1 }}>
                    <span>{progress}</span>
                    {progressRatio != null && (
                      <div
                        className="progress-bar-track"
                        style={{ marginTop: "0.5rem" }}
                        role="progressbar"
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-valuenow={Math.round(progressRatio * 100)}
                      >
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

              {error && (
                <div className="error-box" role="alert">
                  <p>
                    <span className="font-black uppercase">
                      {t("status.error", targetLanguage)}
                    </span>{" "}
                    {error}
                  </p>
                  <div style={{ display: "flex", gap: "0.5rem" }}>
                    {traces.length > 0 && (
                      <button
                        type="button"
                        className="neo-btn-sm neo-btn-lime"
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
                <button type="button" className="neo-btn-secondary w-full" onClick={handleReset}>
                  {t("action.loadNew", targetLanguage)}
                </button>
              )}
            </Step>

            {/* 02 — Refine: categories + max distance (usable before and after upload) */}
            <Step num={2} title={t("steps.filter", targetLanguage)} state={filterStep}>
              <CategoryFilter />
            </Step>

            {/* 03 — Enrich (optional, needs POIs) */}
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

            {/* 04 — Export offline */}
            <Step num={4} title={t("steps.export", targetLanguage)} state={exportStep}>
              <ExportPanel />
            </Step>

            {/* Results */}
            {stage === "done" && <PoiList />}

            {/* Debug panel – always available */}
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
