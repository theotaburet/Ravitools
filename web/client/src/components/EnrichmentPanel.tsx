// ---------------------------------------------------------------------------
// EnrichmentPanel – UI for POI enrichment via SearXNG + WebLLM
// Neobrutalist design: progress bar, model download, batch trigger
// ---------------------------------------------------------------------------

import type { EnrichmentJobState, TargetLanguage, POI } from "../types";
import { TARGET_LANGUAGE_LABELS } from "../types";
import { countFullEnrichable, countEnrichable } from "../lib/poi-config";

const LANGUAGES: TargetLanguage[] = ["fr", "en"];

/** Format seconds into a human-readable ETA string */
function formatEta(seconds: number): string {
  if (seconds < 60) return `~${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `~${mins}m ${secs}s` : `~${mins}m`;
}

interface Props {
  job: EnrichmentJobState;
  poiCount: number;
  enrichedCount: number;
  targetLanguage: TargetLanguage;
  onLanguageChange: (lang: TargetLanguage) => void;
  enrichAll: boolean;
  onEnrichAllChange: (enrichAll: boolean) => void;
  onStart: () => void;
  onCancel: () => void;
}

export function EnrichmentPanel({
  job,
  poiCount,
  enrichedCount,
  targetLanguage,
  onLanguageChange,
  enrichAll,
  onEnrichAllChange,
  onStart,
  onCancel,
}: Props) {
  if (poiCount === 0) return null;

  const isRunning =
    job.stage === "loading-model" || job.stage === "running";
  const isDone = job.stage === "done";
  const hasError = job.stage === "error";

  // Progress percentage
  const progressPct =
    job.stage === "loading-model"
      ? Math.round(job.modelLoadProgress * 50) // Model loading = 0-50%
      : job.stage === "running" && job.total > 0
        ? 50 + Math.round((job.completed / job.total) * 50) // Enrichment = 50-100%
        : isDone
          ? 100
          : 0;

  return (
    <div className="enrichment-panel">
      <h3>Enrich POIs</h3>
      <p className="text-xs text-muted font-mono mb-3">
        Add ratings, hours, reviews via web search
        {job.webGpuAvailable ? " + AI synthesis" : ""}
      </p>

      {/* WebGPU status */}
      {!job.webGpuAvailable && (
        <div className="enrichment-notice">
          No WebGPU — raw search snippets only (no AI synthesis).
          Use Chrome/Edge for full experience.
        </div>
      )}

      {/* Language selector */}
      {!isRunning && (
        <div className="flex items-center gap-2 mb-3">
          <span className="text-xs font-mono text-muted">Summary language:</span>
          <div className="flex gap-1">
            {LANGUAGES.map((lang) => (
              <button
                key={lang}
                className={`neo-btn-sm ${lang === targetLanguage ? "neo-btn-primary" : "neo-btn-secondary"}`}
                onClick={() => onLanguageChange(lang)}
              >
                {TARGET_LANGUAGE_LABELS[lang]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Enrich-all toggle */}
      {!isRunning && (
        <label className="flex items-center gap-2 mb-3 cursor-pointer text-xs font-mono">
          <input
            type="checkbox"
            checked={enrichAll}
            onChange={(e) => onEnrichAllChange(e.target.checked)}
            className="neo-checkbox"
          />
          <span className={enrichAll ? "text-foreground" : "text-muted"}>
            Enrich everything (slower)
          </span>
        </label>
      )}

      {/* Idle state — show trigger button */}
      {job.stage === "idle" && enrichedCount === 0 && (
        <div className="flex flex-col gap-2">
          {!enrichAll && poiCount > 0 && (
            <div className="text-xs font-mono text-muted">
              {poiCount} POIs total — enrichment targets high-value categories
            </div>
          )}
          <button
            className="neo-btn-primary w-full"
            onClick={onStart}
          >
            Enrich {enrichAll ? `all ${poiCount}` : `${poiCount}`} POIs
          </button>
        </div>
      )}

      {/* Idle after partial enrichment */}
      {job.stage === "idle" && enrichedCount > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-mono text-muted">
            {enrichedCount}/{poiCount} POIs enriched
          </div>
          <button
            className="neo-btn-primary w-full"
            onClick={onStart}
          >
            Re-enrich all ({poiCount})
          </button>
        </div>
      )}

      {/* Loading model */}
      {job.stage === "loading-model" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="spinner" />
            <span>
              {job.webGpuAvailable
                ? `Loading AI model... ${Math.round(job.modelLoadProgress * 100)}%`
                : "Preparing enrichment..."}
            </span>
          </div>
          <div className="progress-bar-track">
            <div
              className="progress-bar-fill bg-accent"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <button
            className="neo-btn-sm neo-btn-secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Running batch */}
      {job.stage === "running" && (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2 text-xs font-mono">
            <span className="spinner" />
            <span>
              {job.phase === "geocode-search"
                ? "Searching..."
                : job.phase === "synthesize"
                  ? "AI synthesis..."
                  : "Enriching..."}{" "}
              {job.completed}/{job.total}
            </span>
          </div>
          {job.currentPoiName && (
            <div className="text-xs text-muted font-mono truncate">
              Current: {job.currentPoiName}
            </div>
          )}
          {job.etaSeconds != null && job.etaSeconds > 0 && (
            <div className="text-xs text-muted font-mono">
              ETA: {formatEta(job.etaSeconds)}
            </div>
          )}
          <div className="progress-bar-track">
            <div
              className="progress-bar-fill bg-lime"
              style={{ width: `${progressPct}%` }}
            />
          </div>
          <button
            className="neo-btn-sm neo-btn-secondary"
            onClick={onCancel}
          >
            Stop
          </button>
        </div>
      )}

      {/* Done */}
      {isDone && (
        <div className="flex flex-col gap-2">
          <div className="enrichment-done">
            Enriched {enrichedCount}/{poiCount} POIs
          </div>
          <div className="progress-bar-track">
            <div
              className="progress-bar-fill bg-success"
              style={{ width: "100%" }}
            />
          </div>
          <button
            className="neo-btn-sm neo-btn-secondary"
            onClick={onStart}
          >
            Re-enrich all
          </button>
        </div>
      )}

      {/* Error */}
      {hasError && (
        <div className="flex flex-col gap-2">
          <div className="text-xs text-danger font-bold font-mono">
            Error: {job.error}
          </div>
          {enrichedCount > 0 && (
            <div className="text-xs text-muted font-mono">
              {enrichedCount}/{poiCount} enriched before error
            </div>
          )}
          <button
            className="neo-btn-sm neo-btn-primary"
            onClick={onStart}
          >
            Retry
          </button>
        </div>
      )}
    </div>
  );
}
