// ---------------------------------------------------------------------------
// App – main application component (neobrutalist Tailwind)
// Supports multiple GPX files simultaneously
// ---------------------------------------------------------------------------

import { useState, useCallback, useEffect, useRef } from "react";
import { useRavitools } from "./hooks/useRavitools";
import { useEnrichment } from "./hooks/useEnrichment";
import { GpxUpload } from "./components/GpxUpload";
import { RouteMap } from "./components/RouteMap";
import { CategoryFilter } from "./components/CategoryFilter";
import { ExportPanel } from "./components/ExportPanel";
import { PoiList } from "./components/PoiList";
import { EnrichmentPanel } from "./components/EnrichmentPanel";
import { saveSession, loadSession, clearSession, hasSession } from "./lib/session";
import type { TargetLanguage } from "./types";

export default function App() {
  const {
    state,
    filteredPois,
    processFiles,
    reset,
    restoreState,
    toggleCategory,
    setAllCategories,
  } = useRavitools();

  const {
    job: enrichmentJob,
    enrichments,
    startEnrichment,
    cancelEnrichment,
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
    });
  }, [state.stage, state.pois, state.activeCategories, state.traces, enrichments, targetLanguage, enrichAll]);

  const isProcessing =
    state.stage === "parsing" ||
    state.stage === "simplifying" ||
    state.stage === "querying" ||
    state.stage === "processing";

  const hasPois = state.pois.length > 0;

  const handleReset = useCallback(() => {
    reset();
    resetEnrichment();
    setSelectedPoiId(null);
    clearSession();
  }, [reset, resetEnrichment]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center gap-4 px-5 py-3 border-b-3 border-black bg-white shrink-0">
        <h1 className="text-2xl font-black uppercase tracking-tight">
          Ravitools
        </h1>
        <span className="neo-tag bg-lime">beta</span>
        <p className="text-sm text-muted hidden sm:block">
          Find useful POIs along your cycling route
        </p>
      </header>

      <div className="app-layout">
        {/* Sidebar */}
        <aside className="sidebar">
          {/* Resume prompt */}
          {showResumePrompt && (
            <div className="session-prompt">
              <p className="session-prompt-text">
                You have a saved session. Resume where you left off?
              </p>
              <div className="session-prompt-actions">
                <button className="neo-btn-sm neo-btn-lime" onClick={handleResume}>
                  Resume
                </button>
                <button className="neo-btn-sm neo-btn-secondary" onClick={handleDismissResume}>
                  Start fresh
                </button>
              </div>
            </div>
          )}

          {/* Category selector – always visible */}
          <CategoryFilter
            activeCategories={state.activeCategories}
            onToggle={toggleCategory}
            onSelectAll={setAllCategories}
            pois={state.pois}
            showCounts={hasPois}
          />

          {/* Upload area */}
          {(state.stage === "idle" || state.stage === "error") && !showResumePrompt && (
            <GpxUpload onFiles={processFiles} disabled={isProcessing} />
          )}

          {/* Status / Progress */}
          {state.progress && (
            <div
              className={`status-bar ${state.stage === "error" ? "error" : ""}`}
            >
              {isProcessing && <span className="spinner" />}
              <span>{state.progress}</span>
            </div>
          )}

          {/* Error message */}
          {state.error && (
            <div className="error-box">
              <p>
                <span className="font-black uppercase">Error:</span>{" "}
                {state.error}
              </p>
              <button className="neo-btn-sm neo-btn-secondary" onClick={handleReset}>
                Try again
              </button>
            </div>
          )}

          {/* Enrichment panel – shown when POIs are found */}
          {state.stage === "done" && (
            <EnrichmentPanel
              job={enrichmentJob}
              poiCount={filteredPois.length}
              enrichedCount={enrichments.size}
              targetLanguage={targetLanguage}
              onLanguageChange={setTargetLanguage}
              enrichAll={enrichAll}
              onEnrichAllChange={setEnrichAll}
              onStart={() => startEnrichment(filteredPois, targetLanguage, enrichAll)}
              onCancel={cancelEnrichment}
            />
          )}

          {/* Export */}
          {state.stage === "done" && (
            <ExportPanel
              pois={filteredPois}
              traces={state.traces}
              enrichments={enrichments}
            />
          )}

          {/* Reset button */}
          {state.stage === "done" && (
            <button className="neo-btn-secondary w-full" onClick={handleReset}>
              Load new GPX files
            </button>
          )}

          {/* POI list */}
          {state.stage === "done" && (
            <PoiList
              pois={filteredPois}
              enrichments={enrichments}
              selectedPoiId={selectedPoiId}
              onSelectPoi={setSelectedPoiId}
            />
          )}
        </aside>

        {/* Map */}
        <main className="map-container">
          <RouteMap
            traces={state.traces}
            pois={filteredPois}
            enrichments={enrichments}
            selectedPoiId={selectedPoiId}
            onSelectPoi={setSelectedPoiId}
          />
        </main>
      </div>
    </div>
  );
}
