// ---------------------------------------------------------------------------
// App – main application component (neobrutalist Tailwind)
// Supports multiple GPX files simultaneously
// ---------------------------------------------------------------------------

import { useState, useCallback, useEffect, useRef, useMemo, lazy, Suspense } from "react";
import { useRavitools } from "./hooks/useRavitools";
import { useEnrichment } from "./hooks/useEnrichment";
import { GpxUpload } from "./components/GpxUpload";
import { RouteMap } from "./components/RouteMap";
import { CategoryFilter } from "./components/CategoryFilter";
import { ExportPanel } from "./components/ExportPanel";
import { PoiList } from "./components/PoiList";
import { EnrichmentPanel } from "./components/EnrichmentPanel";
import { DebugPanel } from "./components/DebugPanel";
import { saveSession, loadSession, clearSession, hasSession } from "./lib/session";
import { t } from "./lib/i18n";
import type { TargetLanguage } from "./types";
import { isRetryableEnrichmentResult } from "./lib/enrichment";

const EnrichmentSandbox = lazy(() => import("./components/EnrichmentSandbox").then((module) => ({ default: module.EnrichmentSandbox })));

export default function App() {
  const sandboxMode = useMemo(
    () => typeof window !== "undefined" && new URLSearchParams(window.location.search).has("sandbox"),
    [],
  );
  const {
    state,
    filteredPois,
    processFiles,
    retryQuery,
    reset,
    restoreState,
    toggleCategory,
    setAllCategories,
    setMaxDistance,
  } = useRavitools();

  const {
    job: enrichmentJob,
    enrichments,
    startEnrichment,
    continueEnrichment,
    cancelEnrichment,
    resumeAfterCaptcha,
    resetEnrichment,
    restoreEnrichments,
  } = useEnrichment();

  const [targetLanguage, setTargetLanguage] = useState<TargetLanguage>("en");
  const [enrichAll, setEnrichAll] = useState(false);
  const [selectedPoiId, setSelectedPoiId] = useState<string | null>(null);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const restoredRef = useRef(false);

  // On mount: check for saved session
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (hasSession()) {
      setShowResumePrompt(true);
    }
  }, []);

  const handleResume = useCallback(() => {
    const session = loadSession();
    if (session) {
      restoreState({
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
  }, [restoreState, restoreEnrichments]);

  const handleDismissResume = useCallback(() => {
    clearSession();
    setShowResumePrompt(false);
  }, []);

  // Clear selection when the selected POI leaves the filtered set
  useEffect(() => {
    if (selectedPoiId && !filteredPois.some((p) => p.id === selectedPoiId)) {
      setSelectedPoiId(null);
    }
  }, [filteredPois, selectedPoiId]);

  // Auto-save session when pipeline is done and we have POIs
  useEffect(() => {
    if (state.stage !== "done" || state.pois.length === 0) return;
    saveSession({
      activeCategories: state.activeCategories,
      traces: state.traces,
      pois: state.pois,
      enrichments,
      targetLanguage,
      enrichAll,
      routeSettings: state.routeSettings,
    });
  }, [state.stage, state.pois, state.activeCategories, state.traces, state.routeSettings, enrichments, targetLanguage, enrichAll]);

  const isProcessing =
    state.stage === "parsing" ||
    state.stage === "simplifying" ||
    state.stage === "querying" ||
    state.stage === "processing";

  const hasPois = state.pois.length > 0;

  // Count POIs that still need enrichment (unenriched + retryable failures)
  const pendingEnrichmentCount = useMemo(
    () =>
      filteredPois.filter((poi) => {
        const e = enrichments.get(poi.id);
        return isRetryableEnrichmentResult(e);
      }).length,
    [filteredPois, enrichments],
  );

  const handleReset = useCallback(() => {
    reset();
    resetEnrichment();
    setSelectedPoiId(null);
    clearSession();
  }, [reset, resetEnrichment]);

  // Stable ref so the inline ternary stops defeating memo(PoiList) every render
  const enrichingPoiIds = useMemo(
    () => (enrichmentJob.stage === "running" ? enrichmentJob.activePoiIds : null),
    [enrichmentJob.stage, enrichmentJob.activePoiIds],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center gap-4 px-5 py-3 border-b-3 border-black bg-white shrink-0">
        <h1 className="text-2xl font-black uppercase tracking-tight">
          Ravitools
        </h1>
        <span className="neo-tag bg-lime">beta</span>
        <p className="text-sm text-muted hidden sm:block">
          {t("app.subtitle", targetLanguage)}
        </p>
      </header>

      <div className="app-layout">
        {/* Sidebar */}
        <aside className="sidebar">
          {/* Category selector – pinned at top, never scrolls away */}
          <CategoryFilter
            activeCategories={state.activeCategories}
            onToggle={toggleCategory}
            onSelectAll={setAllCategories}
            pois={state.pois}
            showCounts={hasPois}
            maxDistanceM={state.routeSettings.maxDistanceM}
            onMaxDistanceChange={setMaxDistance}
            targetLanguage={targetLanguage}
          />

          {/* Scrollable area for everything else */}
          <div className="sidebar-scroll">
          {/* Resume prompt */}
          {showResumePrompt && (
            <div className="session-prompt">
              <p className="session-prompt-text">
                {t("session.prompt", targetLanguage)}
              </p>
              <div className="session-prompt-actions">
                <button type="button" className="neo-btn-sm neo-btn-lime" onClick={handleResume}>
                  {t("session.resume", targetLanguage)}
                </button>
                <button type="button" className="neo-btn-sm neo-btn-secondary" onClick={handleDismissResume}>
                  {t("session.fresh", targetLanguage)}
                </button>
              </div>
            </div>
          )}

          {/* Upload area – show when idle, or at error with no traces loaded */}
          {((state.stage === "idle" || (state.stage === "error" && state.traces.length === 0)) && !showResumePrompt) && (
            <GpxUpload onFiles={processFiles} disabled={isProcessing} lang={targetLanguage} />
          )}

          {/* Status / Progress */}
          {state.progress && (
            <div
              className={`status-bar ${state.stage === "error" ? "error" : ""}`}
              role="status"
              aria-live="polite"
            >
              {isProcessing && <span className="spinner" />}
              <div style={{ flex: 1 }}>
                <span>{state.progress}</span>
                {state.progressRatio != null && (
                  <div className="progress-bar-track" style={{ marginTop: "0.5rem" }}>
                    <div
                      className="progress-bar-fill"
                      style={{
                        width: `${Math.round(state.progressRatio * 100)}%`,
                        backgroundColor: "var(--color-lime)",
                      }}
                    />
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Warning banner (partial results) */}
          {state.warning && (
            <div className="warning-box">
              <p>
                <span className="font-black uppercase">{t("status.warning", targetLanguage)}</span>{" "}
                {state.warning}
              </p>
              <button type="button" className="neo-btn-sm neo-btn-lime" onClick={retryQuery}>
                {t("action.retryChunks", targetLanguage)}
              </button>
            </div>
          )}

          {/* Error message */}
          {state.error && (
            <div className="error-box">
              <p>
                <span className="font-black uppercase">{t("status.error", targetLanguage)}</span>{" "}
                {state.error}
              </p>
              <div style={{ display: "flex", gap: "0.5rem" }}>
                {state.traces.length > 0 && (
                  <button type="button" className="neo-btn-sm neo-btn-lime" onClick={retryQuery}>
                    {t("action.retryQuery", targetLanguage)}
                  </button>
                )}
                <button type="button" className="neo-btn-sm neo-btn-secondary" onClick={handleReset}>
                  {state.traces.length > 0 ? t("action.startOver", targetLanguage) : t("action.tryAgain", targetLanguage)}
                </button>
              </div>
            </div>
          )}

          {/* Enrichment panel – shown when POIs are found */}
          {state.stage === "done" && (
            <EnrichmentPanel
              job={enrichmentJob}
              poiCount={filteredPois.length}
              enrichedCount={enrichments.size}
              pendingCount={pendingEnrichmentCount}
              enrichments={enrichments}
              targetLanguage={targetLanguage}
              onLanguageChange={setTargetLanguage}
              enrichAll={enrichAll}
              onEnrichAllChange={setEnrichAll}
              onStart={() => startEnrichment(filteredPois, targetLanguage, enrichAll)}
              onContinue={() => continueEnrichment(filteredPois, targetLanguage, enrichAll)}
              onCancel={cancelEnrichment}
              onResumeAfterCaptcha={resumeAfterCaptcha}
            />
          )}

          {sandboxMode && state.stage === "done" && (
            <Suspense fallback={null}>
              <EnrichmentSandbox
                pois={filteredPois}
                targetLanguage={targetLanguage}
              />
            </Suspense>
          )}

          {/* Export */}
          {state.stage === "done" && (
            <ExportPanel
              pois={filteredPois}
              traces={state.traces}
              enrichments={enrichments}
              targetLanguage={targetLanguage}
            />
          )}

          {/* Reset button */}
          {state.stage === "done" && (
            <button type="button" className="neo-btn-secondary w-full" onClick={handleReset}>
              {t("action.loadNew", targetLanguage)}
            </button>
          )}

          {/* POI list */}
          {state.stage === "done" && (
            <PoiList
              pois={filteredPois}
              enrichments={enrichments}
              selectedPoiId={selectedPoiId}
              onSelectPoi={setSelectedPoiId}
              enrichingPoiIds={enrichingPoiIds}
              targetLanguage={targetLanguage}
            />
          )}

          {/* Debug panel – always available */}
          <DebugPanel />
          </div>
        </aside>

        {/* Map */}
        <main className="map-container">
          <RouteMap
            traces={state.traces}
            pois={filteredPois}
            enrichments={enrichments}
            selectedPoiId={selectedPoiId}
            onSelectPoi={setSelectedPoiId}
            enrichingPoiIds={enrichingPoiIds}
            targetLanguage={targetLanguage}
          />
        </main>
      </div>
    </div>
  );
}
