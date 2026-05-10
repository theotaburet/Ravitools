// ---------------------------------------------------------------------------
// EnrichmentPanel – UI for POI enrichment via SearXNG + WebLLM
// Neobrutalist design: progress bar, model download, batch trigger
// ---------------------------------------------------------------------------

import type { EnrichmentJobState, TargetLanguage, EnrichedData } from "../types";
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
  /** Number of POIs that still need enrichment (unenriched + errors) */
  pendingCount: number;
  /** Enrichment results for aggregating engine failures */
  enrichments: Map<string, EnrichedData>;
  targetLanguage: TargetLanguage;
  onLanguageChange: (lang: TargetLanguage) => void;
  enrichAll: boolean;
  onEnrichAllChange: (enrichAll: boolean) => void;
  onStart: () => void;
  /** Continue enrichment for remaining/failed POIs only */
  onContinue: () => void;
  onCancel: () => void;
  /** Resume after user has manually resolved a CAPTCHA */
  onResumeAfterCaptcha: () => void;
}

export function EnrichmentPanel({
  job,
  poiCount,
  enrichedCount,
  pendingCount,
  enrichments,
  targetLanguage,
  onLanguageChange,
  enrichAll,
  onEnrichAllChange,
  onStart,
  onContinue,
  onCancel,
  onResumeAfterCaptcha,
}: Props) {
  if (poiCount === 0) return null;

  const isRunning =
    job.stage === "loading-model" || job.stage === "running";
  const isDone = job.stage === "done";
  const hasError = job.stage === "error";
  const isPausedCaptcha = job.stage === "paused-captcha";

  // Progress percentage
  const progressPct =
    job.stage === "loading-model"
      ? Math.round(job.modelLoadProgress * 50) // Model loading = 0-50%
      : job.stage === "running" && job.total > 0
        ? 50 + Math.round((job.completed / job.total) * 50) // Enrichment = 50-100%
        : isDone
          ? 100
          : 0;

  // Aggregate unresponsive engines across all enrichment results
  const unresponsiveEngineMap = new Map<string, string>();
  for (const [, data] of enrichments) {
    if (data.unresponsiveEngines) {
      for (const [engine, reason] of data.unresponsiveEngines) {
        if (!unresponsiveEngineMap.has(engine)) {
          unresponsiveEngineMap.set(engine, reason);
        }
      }
    }
  }
  const hasUnresponsiveEngines = unresponsiveEngineMap.size > 0;

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

      {/* SearXNG status */}
      {!job.searxngAvailable && (
        <div className="enrichment-notice" style={{ backgroundColor: "#fef3c7", borderColor: "#f59e0b" }}>
          SearXNG unavailable — search enrichment disabled.
          Start SearXNG: <code>docker run -d -p 8888:8080 --rm searxng/searxng</code>
        </div>
      )}

      {job.warning && (
        <div className="enrichment-notice" style={{ backgroundColor: "#fef3c7", borderColor: "#f59e0b" }}>
          {job.warning}
        </div>
      )}

      {job.googleFallbackStatus && (
        <div className="enrichment-notice" style={{ backgroundColor: "#dbeafe", borderColor: "#60a5fa" }}>
          {job.googleFallbackStatus}
        </div>
      )}

      {job.googleFallbackStats && (job.googleFallbackStats.counts.queued > 0 || job.googleFallbackStats.counts.running > 0) && (
        <div className="enrichment-notice" style={{ backgroundColor: "#dbeafe", borderColor: "#60a5fa" }}>
          Google queue: {job.googleFallbackStats.counts.queued} queued, {job.googleFallbackStats.counts.running} running
          {job.googleFallbackStats.jobs.length > 0 && (
            <div className="text-xs font-mono mt-1">
              {job.googleFallbackStats.jobs
                .filter((item) => item.status === "queued" || item.status === "running")
                .slice(0, 3)
                .map((item) => {
                  const label = item.poiName ?? item.url.split("/maps/search/")[1]?.slice(0, 40) ?? item.jobId;
                  return `${item.status}: ${label}`;
                })
                .join(" | ")}
            </div>
          )}
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
            disabled={!job.searxngAvailable}
            title={!job.searxngAvailable ? "Start SearXNG to enable enrichment" : undefined}
          >
            Enrich {enrichAll ? `all ${poiCount}` : `${poiCount}`} POIs
          </button>
        </div>
      )}

      {/* Idle after partial enrichment — offer continue or re-enrich */}
      {job.stage === "idle" && enrichedCount > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-mono text-muted">
            {enrichedCount}/{poiCount} POIs enriched
            {pendingCount > 0 && ` — ${pendingCount} retryable remaining`}
          </div>
          {pendingCount > 0 && (
            <button
              className="neo-btn-primary w-full"
              onClick={onContinue}
              disabled={!job.searxngAvailable}
            >
              Continue enrichment ({pendingCount} retryable)
            </button>
          )}
          <button
            className="neo-btn-sm neo-btn-secondary w-full"
            onClick={onStart}
            disabled={!job.searxngAvailable}
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
                : job.phase === "google-fallback"
                  ? "Google fallback queue..."
                : job.phase === "synthesize"
                  ? "AI synthesis..."
                  : job.phase === "retry"
                    ? "Retrying failed..."
                    : "Enriching..."}{" "}
              {job.completed}/{job.total}
            </span>
          </div>
          {job.phase === "google-fallback" && (
            <div className="text-xs text-muted font-mono">
              Google Maps can take 30-90s per place. Still running — please wait.
            </div>
          )}
          {job.currentPoiName && (
            <div className="text-xs text-muted font-mono truncate">
              {job.activePoiIds.size > 1
                ? `Processing ${job.activePoiIds.size} POIs (${job.currentPoiName}...)`
                : `Current: ${job.currentPoiName}`}
            </div>
          )}
          {(job.errorCount > 0 || job.skippedCount > 0) && (
            <div className="text-xs font-mono" style={{ display: "flex", gap: "0.75rem" }}>
              {job.errorCount > 0 && (
                <span style={{ color: "var(--color-danger)" }}>
                  {job.errorCount} error{job.errorCount > 1 ? "s" : ""}
                </span>
              )}
              {job.skippedCount > 0 && (
                <span style={{ color: "var(--color-muted)" }}>
                  {job.skippedCount} skipped
                </span>
              )}
            </div>
          )}
          {job.etaSeconds != null && job.etaSeconds > 0 && (
            <div className="text-xs text-muted font-mono">
              ETA: {formatEta(job.etaSeconds)}
            </div>
          )}
          <div className="progress-bar-track">
            <div
              className="progress-bar-fill"
              style={{
                width: `${progressPct}%`,
                backgroundColor: job.errorCount > 0 ? "var(--color-warning)" : "var(--color-lime)",
              }}
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

      {/* Paused — CAPTCHA required */}
      {isPausedCaptcha && (
        <div className="flex flex-col gap-2">
          <div className="enrichment-notice" style={{ backgroundColor: "#fef3c7", borderColor: "#f59e0b" }}>
            <strong>All search engines blocked (CAPTCHA / access denied).</strong>
            <br />
            Open SearXNG in a new tab, complete the CAPTCHA, then come back and resume.
          </div>
          {job.captchaUrl && (
            <a
              href={job.captchaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="neo-btn-primary w-full text-center"
              style={{ display: "block" }}
            >
              Open SearXNG — solve CAPTCHA
            </a>
          )}
          <button
            className="neo-btn-primary w-full"
            onClick={onResumeAfterCaptcha}
          >
            Resume enrichment ({pendingCount} remaining)
          </button>
          <button
            className="neo-btn-sm neo-btn-secondary"
            onClick={onCancel}
          >
            Cancel
          </button>
        </div>
      )}

      {/* Done */}
      {isDone && (
        <div className="flex flex-col gap-2">
          <div className="enrichment-done">
            Enriched {enrichedCount}/{poiCount} POIs
          </div>
          {(job.errorCount > 0 || job.skippedCount > 0) && (
            <div className="text-xs font-mono" style={{ display: "flex", gap: "0.75rem" }}>
              {job.errorCount > 0 && (
                <span style={{ color: "var(--color-danger)" }}>
                  {job.errorCount} error{job.errorCount > 1 ? "s" : ""}
                </span>
              )}
              {job.skippedCount > 0 && (
                <span style={{ color: "var(--color-muted)" }}>
                  {job.skippedCount} skipped
                </span>
              )}
            </div>
          )}
          <div className="progress-bar-track">
            <div
              className="progress-bar-fill"
              style={{
                width: "100%",
                backgroundColor: job.errorCount > 0 ? "var(--color-warning)" : "var(--color-success)",
              }}
            />
          </div>
          {pendingCount > 0 && (
            <button
              className="neo-btn-primary w-full"
              onClick={onContinue}
              disabled={!job.searxngAvailable}
            >
              Continue enrichment ({pendingCount} retryable)
            </button>
          )}
          <button
            className="neo-btn-sm neo-btn-secondary"
            onClick={onStart}
            disabled={!job.searxngAvailable}
          >
            Re-enrich all
          </button>
        </div>
      )}

      {/* Unresponsive engines warning */}
      {hasUnresponsiveEngines && (isDone || isRunning || hasError) && (
        <details className="engine-failures">
          <summary className="engine-failures-summary">
            {unresponsiveEngineMap.size} search engine{unresponsiveEngineMap.size > 1 ? "s" : ""} degraded
          </summary>
          <ul className="engine-failures-list">
            {[...unresponsiveEngineMap.entries()].map(([engine, reason]) => (
              <li key={engine}>
                <span className="engine-name">{engine}</span>
                <span className="engine-reason">{reason}</span>
              </li>
            ))}
          </ul>
        </details>
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
          {pendingCount > 0 ? (
            <button
              className="neo-btn-sm neo-btn-primary"
              onClick={onContinue}
            >
              Continue ({pendingCount} retryable)
            </button>
          ) : (
            <button
              className="neo-btn-sm neo-btn-primary"
              onClick={onStart}
            >
              Retry
            </button>
          )}
        </div>
      )}
    </div>
  );
}
