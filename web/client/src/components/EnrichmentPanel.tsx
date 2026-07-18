// ---------------------------------------------------------------------------
// EnrichmentPanel – UI for POI enrichment via SearXNG + WebLLM
// Neobrutalist design: progress bar, model download, batch trigger
// ---------------------------------------------------------------------------

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { useEffect, useMemo } from "react";
import { fetchGoogleMapsJobStats, isRetryableEnrichmentResult } from "../lib/enrichment";
import { t } from "../lib/i18n";
import {
  API_BASE,
  cancelEnrichmentAtom,
  continueEnrichmentAtom,
  enrichmentJobAtom,
  enrichmentsAtom,
  resumeAfterCaptchaAtom,
  startEnrichmentAtom,
} from "../state/enrichment";
import { filteredPoisAtom } from "../state/route";
import { enrichAllAtom, targetLanguageAtom } from "../state/ui";

/** Format seconds into a human-readable ETA string */
function formatEta(seconds: number): string {
  if (seconds < 60) return `~${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `~${mins}m ${secs}s` : `~${mins}m`;
}

export function EnrichmentPanel() {
  const [job, setJob] = useAtom(enrichmentJobAtom);
  const enrichments = useAtomValue(enrichmentsAtom);
  const filteredPois = useAtomValue(filteredPoisAtom);
  const targetLanguage = useAtomValue(targetLanguageAtom);
  const [enrichAll, onEnrichAllChange] = useAtom(enrichAllAtom);
  const startEnrichment = useSetAtom(startEnrichmentAtom);
  const continueEnrichment = useSetAtom(continueEnrichmentAtom);
  const onCancel = useSetAtom(cancelEnrichmentAtom);
  const onResumeAfterCaptcha = useSetAtom(resumeAfterCaptchaAtom);

  const poiCount = filteredPois.length;
  const enrichedCount = enrichments.size;
  // Count POIs that still need enrichment (unenriched + retryable failures)
  const pendingCount = useMemo(
    () => filteredPois.filter((poi) => isRetryableEnrichmentResult(enrichments.get(poi.id))).length,
    [filteredPois, enrichments],
  );

  const onStart = () => startEnrichment(filteredPois, targetLanguage, enrichAll);
  const onContinue = () => continueEnrichment(filteredPois, targetLanguage, enrichAll);

  // SearXNG availability check (once on mount)
  useEffect(() => {
    fetch(`${API_BASE}/health`)
      .then((res) => res.json())
      .then((data) => {
        setJob((prev) => ({ ...prev, searxngAvailable: data.services?.searxng === "ok" }));
      })
      .catch(() => {
        setJob((prev) => ({ ...prev, searxngAvailable: false }));
      });
  }, [setJob]);

  // Poll Google Maps scraper job stats while a batch is running
  useEffect(() => {
    if (job.stage !== "running") return;
    const ctrl = new AbortController();
    const timer = setInterval(() => {
      fetchGoogleMapsJobStats(API_BASE, ctrl.signal)
        .then((stats) => {
          if (stats) setJob((prev) => ({ ...prev, googleFallbackStats: stats }));
        })
        .catch(() => undefined);
    }, 3000);
    return () => {
      ctrl.abort();
      clearInterval(timer);
    };
  }, [job.stage, setJob]);

  if (poiCount === 0) return null;

  const isRunning = job.stage === "loading-model" || job.stage === "running";
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
      <h3>{t("enrich.title", targetLanguage)}</h3>
      <p className="text-xs text-muted font-mono mb-3">
        {t("enrich.subtitle", targetLanguage)}
        {job.webGpuAvailable ? t("enrich.aiSynthesis", targetLanguage) : ""}
      </p>

      {/* Trust: AI summaries are not authoritative (M2) */}
      {job.webGpuAvailable && (
        <p className="enrichment-notice notice-info">
          ⓘ {t("enrich.aiDisclaimer", targetLanguage)}
        </p>
      )}

      {/* WebGPU status */}
      {!job.webGpuAvailable && (
        <div className="enrichment-notice">{t("enrich.noWebgpu", targetLanguage)}</div>
      )}

      {/* SearXNG status */}
      {!job.searxngAvailable && (
        <div className="enrichment-notice notice-warning">
          {t("enrich.searxngUnavailable", targetLanguage)}{" "}
          <code>docker run -d -p 8888:8080 --rm searxng/searxng</code>
        </div>
      )}

      {job.warning && <div className="enrichment-notice notice-warning">{job.warning}</div>}

      {job.googleFallbackStatus && (
        <div className="enrichment-notice notice-progress">{job.googleFallbackStatus}</div>
      )}

      {/* Scraper blocked signal (M2): CAPTCHA/anti-bot on Google/Yandex */}
      {(job.googleFallbackStats?.counts.blocked ?? 0) > 0 && (
        <div className="enrichment-notice notice-danger">
          ⚠ {t("enrich.scraperBlocked", targetLanguage)}
        </div>
      )}

      {job.googleFallbackStats &&
        (job.googleFallbackStats.counts.queued > 0 ||
          job.googleFallbackStats.counts.running > 0) && (
          <div className="enrichment-notice notice-progress">
            {t("enrich.googleQueue", targetLanguage)} {job.googleFallbackStats.counts.queued}{" "}
            {t("enrich.queued", targetLanguage)}, {job.googleFallbackStats.counts.running}{" "}
            {t("enrich.running", targetLanguage)}
            {job.googleFallbackStats.jobs.length > 0 && (
              <div className="text-xs font-mono mt-1">
                {job.googleFallbackStats.jobs
                  .filter((item) => item.status === "queued" || item.status === "running")
                  .slice(0, 3)
                  .map((item) => {
                    const label =
                      item.poiName ??
                      item.url.split("/maps/search/")[1]?.slice(0, 40) ??
                      item.jobId;
                    return `${item.status}: ${label}`;
                  })
                  .join(" | ")}
              </div>
            )}
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
            {t("enrich.enrichEverything", targetLanguage)}
          </span>
        </label>
      )}

      {/* Idle state — show trigger button */}
      {job.stage === "idle" && enrichedCount === 0 && (
        <div className="flex flex-col gap-2">
          {!enrichAll && poiCount > 0 && (
            <div className="text-xs font-mono text-muted">
              {poiCount} {t("enrich.poisTotalHint", targetLanguage)}
            </div>
          )}
          <button
            type="button"
            className="neo-btn-primary w-full"
            onClick={onStart}
            disabled={!job.searxngAvailable}
            title={
              !job.searxngAvailable ? t("enrich.startSearxngTitle", targetLanguage) : undefined
            }
          >
            {t("enrich.enrichButton", targetLanguage)}{" "}
            {enrichAll ? `${t("enrich.all", targetLanguage)} ${poiCount}` : `${poiCount}`}{" "}
            {t("enrich.poisWord", targetLanguage)}
          </button>
        </div>
      )}

      {/* Idle after partial enrichment — offer continue or re-enrich */}
      {job.stage === "idle" && enrichedCount > 0 && (
        <div className="flex flex-col gap-2">
          <div className="text-xs font-mono text-muted">
            {enrichedCount}/{poiCount} {t("enrich.poisEnriched", targetLanguage)}
            {pendingCount > 0 &&
              ` — ${pendingCount} ${t("enrich.retryableRemaining", targetLanguage)}`}
          </div>
          {pendingCount > 0 && (
            <button
              type="button"
              className="neo-btn-primary w-full"
              onClick={onContinue}
              disabled={!job.searxngAvailable}
            >
              {t("enrich.continue", targetLanguage)} ({pendingCount}{" "}
              {t("enrich.retryable", targetLanguage)})
            </button>
          )}
          <button
            type="button"
            className="neo-btn-sm neo-btn-secondary w-full"
            onClick={onStart}
            disabled={!job.searxngAvailable}
          >
            {t("enrich.reEnrichAll", targetLanguage)} ({poiCount})
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
                ? `${t("enrich.loadingModel", targetLanguage)} ${Math.round(job.modelLoadProgress * 100)}%`
                : t("enrich.preparing", targetLanguage)}
            </span>
          </div>
          <div className="progress-bar-track">
            <div className="progress-bar-fill bg-accent" style={{ width: `${progressPct}%` }} />
          </div>
          <button type="button" className="neo-btn-sm neo-btn-secondary" onClick={onCancel}>
            {t("enrich.cancel", targetLanguage)}
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
                ? t("enrich.phaseSearching", targetLanguage)
                : job.phase === "google-fallback"
                  ? t("enrich.phaseGoogle", targetLanguage)
                  : job.phase === "synthesize"
                    ? t("enrich.phaseSynth", targetLanguage)
                    : job.phase === "retry"
                      ? t("enrich.phaseRetry", targetLanguage)
                      : t("enrich.phaseEnriching", targetLanguage)}{" "}
              {job.completed}/{job.total}
            </span>
          </div>
          {job.phase === "google-fallback" && (
            <div className="text-xs text-muted font-mono">
              {t("enrich.googleWait", targetLanguage)}
            </div>
          )}
          {job.currentPoiName && (
            <div className="text-xs text-muted font-mono truncate">
              {job.activePoiIds.size > 1
                ? `${t("enrich.processing", targetLanguage)} ${job.activePoiIds.size} ${t("enrich.poisWord", targetLanguage)} (${job.currentPoiName}...)`
                : `${t("enrich.current", targetLanguage)} ${job.currentPoiName}`}
            </div>
          )}
          {(job.errorCount > 0 || job.skippedCount > 0) && (
            <div className="text-xs font-mono" style={{ display: "flex", gap: "0.75rem" }}>
              {job.errorCount > 0 && (
                <span style={{ color: "var(--color-danger)" }}>
                  {job.errorCount} {t("enrich.errorWord", targetLanguage)}
                  {job.errorCount > 1 ? "s" : ""}
                </span>
              )}
              {job.skippedCount > 0 && (
                <span style={{ color: "var(--color-muted)" }}>
                  {job.skippedCount} {t("enrich.skipped", targetLanguage)}
                </span>
              )}
            </div>
          )}
          {job.etaSeconds != null && job.etaSeconds > 0 && (
            <div className="text-xs text-muted font-mono">
              {t("enrich.eta", targetLanguage)} {formatEta(job.etaSeconds)}
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
          <button type="button" className="neo-btn-sm neo-btn-secondary" onClick={onCancel}>
            {t("enrich.stop", targetLanguage)}
          </button>
        </div>
      )}

      {/* Paused — CAPTCHA required */}
      {isPausedCaptcha && (
        <div className="flex flex-col gap-2">
          <div className="enrichment-notice notice-warning">
            <strong>{t("enrich.captchaBlocked", targetLanguage)}</strong>
            <br />
            {t("enrich.captchaInstructions", targetLanguage)}
          </div>
          {job.captchaUrl && (
            <a
              href={job.captchaUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="neo-btn-primary w-full text-center"
              style={{ display: "block" }}
            >
              {t("enrich.openSearxng", targetLanguage)}
            </a>
          )}
          <button type="button" className="neo-btn-primary w-full" onClick={onResumeAfterCaptcha}>
            {t("enrich.resume", targetLanguage)} ({pendingCount}{" "}
            {t("enrich.remaining", targetLanguage)})
          </button>
          <button type="button" className="neo-btn-sm neo-btn-secondary" onClick={onCancel}>
            {t("enrich.cancel", targetLanguage)}
          </button>
        </div>
      )}

      {/* Done */}
      {isDone && (
        <div className="flex flex-col gap-2">
          <div className="enrichment-done">
            {enrichedCount}/{poiCount} {t("enrich.poisEnriched", targetLanguage)}
          </div>
          {(job.errorCount > 0 || job.skippedCount > 0) && (
            <div className="text-xs font-mono" style={{ display: "flex", gap: "0.75rem" }}>
              {job.errorCount > 0 && (
                <span style={{ color: "var(--color-danger)" }}>
                  {job.errorCount} {t("enrich.errorWord", targetLanguage)}
                  {job.errorCount > 1 ? "s" : ""}
                </span>
              )}
              {job.skippedCount > 0 && (
                <span style={{ color: "var(--color-muted)" }}>
                  {job.skippedCount} {t("enrich.skipped", targetLanguage)}
                </span>
              )}
            </div>
          )}
          <div className="progress-bar-track">
            <div
              className="progress-bar-fill"
              style={{
                width: "100%",
                backgroundColor:
                  job.errorCount > 0 ? "var(--color-warning)" : "var(--color-success)",
              }}
            />
          </div>
          {pendingCount > 0 && (
            <button
              type="button"
              className="neo-btn-primary w-full"
              onClick={onContinue}
              disabled={!job.searxngAvailable}
            >
              {t("enrich.continue", targetLanguage)} ({pendingCount}{" "}
              {t("enrich.retryable", targetLanguage)})
            </button>
          )}
          <button
            type="button"
            className="neo-btn-sm neo-btn-secondary"
            onClick={onStart}
            disabled={!job.searxngAvailable}
          >
            {t("enrich.reEnrichAll", targetLanguage)}
          </button>
        </div>
      )}

      {/* Unresponsive engines warning */}
      {hasUnresponsiveEngines && (isDone || isRunning || hasError) && (
        <details className="engine-failures">
          <summary className="engine-failures-summary">
            {unresponsiveEngineMap.size}{" "}
            {t(
              unresponsiveEngineMap.size > 1
                ? "enrich.enginesDegradedPlural"
                : "enrich.enginesDegradedSingular",
              targetLanguage,
            )}
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
            {t("enrich.error", targetLanguage)} {job.error}
          </div>
          {enrichedCount > 0 && (
            <div className="text-xs text-muted font-mono">
              {enrichedCount}/{poiCount} {t("enrich.enrichedBeforeError", targetLanguage)}
            </div>
          )}
          {pendingCount > 0 ? (
            <button type="button" className="neo-btn-sm neo-btn-primary" onClick={onContinue}>
              {t("enrich.continueShort", targetLanguage)} ({pendingCount}{" "}
              {t("enrich.retryable", targetLanguage)})
            </button>
          ) : (
            <button type="button" className="neo-btn-sm neo-btn-primary" onClick={onStart}>
              {t("enrich.retry", targetLanguage)}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
