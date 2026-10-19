// EnrichmentPanel: UI for POI enrichment via SearXNG + WebLLM.
// Machine check first (can the local model run here?), then the batch controls.

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { CircleAlert, TriangleAlert } from "lucide";
import { useEffect } from "react";
import { km } from "../lib/format";
import { t, tLabel, translateCategory, translatePoiName } from "../lib/i18n";
import {
  cancelEnrichmentAtom,
  checkSearxngAtom,
  continueEnrichmentAtom,
  enrichmentJobAtom,
  enrichmentsAtom,
  enrichmentTallyAtom,
  llmCapabilityAtom,
  llmEnabledAtom,
  llmOptInAtom,
  probeLlmCapabilityAtom,
  refreshGoogleFallbackStatsAtom,
  resumeAfterCaptchaAtom,
  startEnrichmentAtom,
} from "../state/enrichment";
import { filteredPoisAtom } from "../state/route";
import { enrichAllAtom, selectedPoiIdAtom, targetLanguageAtom } from "../state/ui";
import type { POI, SkipReason, TargetLanguage } from "../types";
import { Icon } from "./Icon";

/** Format seconds into a human-readable ETA string */
function formatEta(seconds: number): string {
  if (seconds < 60) return `~${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return secs > 0 ? `~${mins}m ${secs}s` : `~${mins}m`;
}

/** Local model verdict: ready / limited (opt-in) / unavailable, with the reasons. */
function LlmCheck({ lang }: { lang: TargetLanguage }) {
  const cap = useAtomValue(llmCapabilityAtom);
  const enabled = useAtomValue(llmEnabledAtom);
  const [optIn, setOptIn] = useAtom(llmOptInAtom);
  const probe = useSetAtom(probeLlmCapabilityAtom);
  useEffect(() => {
    void probe();
  }, [probe]);

  if (!cap) {
    return (
      <div className="card llm-check">
        <div className="llm-check-title">{tLabel("llm.title", t("llm.checking", lang), lang)}</div>
      </div>
    );
  }

  const modelNote = `${(cap.modelSizeMb / 1000).toFixed(1)} GB ${t("llm.modelNote", lang)}`;
  const reasons = cap.reasons.map((r) => t(`llm.reason.${r}`, lang)).join(", ");
  return (
    <div className={`card llm-check llm-check-${cap.level}`}>
      <div className="llm-check-title">
        {tLabel("llm.title", t(`llm.${cap.level}`, lang), lang)}
        {cap.gpuName && ` (${cap.gpuName})`}
      </div>
      <details>
        <summary>{t("llm.more", lang)}</summary>
        <div className="llm-check-body">
          {cap.level === "ready" && modelNote}
          {cap.level === "limited" && `${reasons}. ${modelNote}`}
          {cap.level === "unsupported" && `${reasons}. ${t("llm.fallback", lang)}`}
        </div>
        {enabled && <div className="hint">{t("enrich.aiDisclaimer", lang)}</div>}
      </details>
      {cap.level === "limited" && (
        <label className="switch">
          <input
            type="checkbox"
            role="switch"
            aria-checked={optIn}
            checked={optIn}
            onChange={(e) => setOptIn(e.target.checked)}
          />
          {t("llm.tryAnyway", lang)}
        </label>
      )}
    </div>
  );
}

/** One bar for the whole picture (done, skipped, remaining); which POIs were skipped and why is one click away. */
function Tally({ lang }: { lang: TargetLanguage }) {
  const { total, done, skipped, remaining, errors, skippedByReason } =
    useAtomValue(enrichmentTallyAtom);
  const enrichments = useAtomValue(enrichmentsAtom);
  const selectPoi = useSetAtom(selectedPoiIdAtom);
  const width = (n: number) => `${(n / total) * 100}%`;
  const overview = (
    <>
      <span className="progress progress-segmented" aria-hidden="true">
        <span className="is-done" style={{ width: width(done) }} />
        <span className="is-skipped" style={{ width: width(skipped) }} />
      </span>
      <span className="tally-legend">
        <span className="is-done">
          {done} {t("enrich.poisEnriched", lang)}
        </span>
        <span className="is-skipped">
          {skipped} {t("enrich.skipped", lang)}
        </span>
        <span className="is-remaining">
          {remaining} {t("enrich.remaining", lang)}
          {errors > 0 && ` (${errors} ${t("enrich.errorWord", lang)}${errors > 1 ? "s" : ""})`}
        </span>
      </span>
    </>
  );
  const reasons = (Object.entries(skippedByReason) as [SkipReason, POI[]][]).sort(
    ([, a], [, b]) => b.length - a.length,
  );
  if (reasons.length === 0) return <div className="tally">{overview}</div>;
  return (
    <details className="tally">
      <summary>{overview}</summary>
      <div className="tally-reasons">
        {reasons.map(([reason, pois]) => (
          <details key={reason}>
            <summary>
              <span>{t(`poi.skip.${reason}`, lang)}</span>
              <span>{pois.length}</span>
            </summary>
            <ul>
              {pois.map((poi) => {
                const query = enrichments.get(poi.id)?.searchQuery;
                return (
                  <li key={poi.id}>
                    <button type="button" onClick={() => selectPoi(poi.id)}>
                      <span>{translatePoiName(poi.name, lang) || t("poi.skip.unnamed", lang)}</span>
                      <span className="tally-poi-meta">
                        {translateCategory(poi.category, lang)} &middot; km{" "}
                        {km(poi.alongTraceDistance)}
                      </span>
                      {query && <span className="tally-poi-meta">{query}</span>}
                    </button>
                  </li>
                );
              })}
            </ul>
          </details>
        ))}
      </div>
    </details>
  );
}

export function EnrichmentPanel() {
  const job = useAtomValue(enrichmentJobAtom);
  const enrichments = useAtomValue(enrichmentsAtom);
  const filteredPois = useAtomValue(filteredPoisAtom);
  const lang = useAtomValue(targetLanguageAtom);
  const [enrichAll, onEnrichAllChange] = useAtom(enrichAllAtom);
  const startEnrichment = useSetAtom(startEnrichmentAtom);
  const continueEnrichment = useSetAtom(continueEnrichmentAtom);
  const onCancel = useSetAtom(cancelEnrichmentAtom);
  const onResumeAfterCaptcha = useSetAtom(resumeAfterCaptchaAtom);
  const checkSearxng = useSetAtom(checkSearxngAtom);
  const refreshGoogleStats = useSetAtom(refreshGoogleFallbackStatsAtom);

  const poiCount = filteredPois.length;
  const enrichedCount = enrichments.size;
  // POIs that still need enrichment (unenriched + retryable failures)
  const pendingCount = useAtomValue(enrichmentTallyAtom).remaining;

  const onStart = () => startEnrichment(filteredPois);
  const onContinue = () => continueEnrichment(filteredPois);

  useEffect(() => {
    void checkSearxng();
  }, [checkSearxng]);

  // Poll Google Maps scraper job stats while a batch is running
  useEffect(() => {
    if (job.stage !== "running") return;
    const ctrl = new AbortController();
    const timer = setInterval(() => void refreshGoogleStats(ctrl.signal), 3000);
    return () => {
      ctrl.abort();
      clearInterval(timer);
    };
  }, [job.stage, refreshGoogleStats]);

  if (poiCount === 0) return null;

  const isRunning = job.stage === "loading-model" || job.stage === "running";
  const isDone = job.stage === "done";
  const hasError = job.stage === "error";
  const isPausedCaptcha = job.stage === "paused-captcha";

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

  // Searching: POIs past the search; synthesis and retries: POIs finished
  const phaseCount =
    job.phase === "geocode-search" || job.phase === "google-fallback"
      ? job.searched
      : job.completed;

  return (
    <div className="enrichment-panel">
      <p className="hint">{t("enrich.subtitle", lang)}</p>

      <LlmCheck lang={lang} />

      {/* SearXNG status */}
      {!job.searxngAvailable && (
        <div className="notice notice-warning">
          <Icon node={TriangleAlert} />
          <p>{t("enrich.searxngUnavailable", lang)}</p>
        </div>
      )}

      {job.googleFallbackStatus && <p className="hint">{job.googleFallbackStatus}</p>}

      {/* Scraper blocked signal: CAPTCHA/anti-bot on Google/Yandex */}
      {(job.googleFallbackStats?.counts.blocked ?? 0) > 0 && (
        <div className="notice notice-danger">
          <Icon node={CircleAlert} />
          <p>{t("enrich.scraperBlocked", lang)}</p>
        </div>
      )}

      {/* Source layout drift: Google changed its page and a section no longer parses */}
      {(job.googleFallbackStats?.counts.layoutIssues ?? 0) > 0 && (
        <div className="notice notice-danger">
          <Icon node={CircleAlert} />
          <p>{t("enrich.sourceLayout", lang)}</p>
        </div>
      )}

      {job.googleFallbackStats &&
        (job.googleFallbackStats.counts.queued > 0 ||
          job.googleFallbackStats.counts.running > 0) && (
          <div className="hint">
            {t("enrich.googleQueue", lang)} {job.googleFallbackStats.counts.queued}{" "}
            {t("enrich.queued", lang)}, {job.googleFallbackStats.counts.running}{" "}
            {t("enrich.running", lang)}
            {job.googleFallbackStats.jobs.length > 0 && (
              <div>
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
        <label className="switch">
          <input
            type="checkbox"
            role="switch"
            aria-checked={enrichAll}
            checked={enrichAll}
            onChange={(e) => onEnrichAllChange(e.target.checked)}
          />
          {t("enrich.enrichEverything", lang)}
        </label>
      )}

      {/* Idle state: show trigger button (direct children of the panel, so the main action can
          dock above the tabs) */}
      {job.stage === "idle" && enrichedCount === 0 && (
        <>
          {!enrichAll && poiCount > 0 && (
            <div className="hint">
              {poiCount} {t("enrich.poisTotalHint", lang)}
            </div>
          )}
          <button
            type="button"
            className="btn btn-primary dock"
            onClick={onStart}
            disabled={!job.searxngAvailable}
            title={!job.searxngAvailable ? t("enrich.startSearxngTitle", lang) : undefined}
          >
            {t("enrich.enrichButton", lang)}{" "}
            {enrichAll ? `${t("enrich.all", lang)} ${poiCount}` : `${poiCount}`}{" "}
            {t("enrich.poisWord", lang)}
          </button>
        </>
      )}

      {/* Done, or idle after a partial run: offer continue or re-enrich */}
      {(isDone || (job.stage === "idle" && enrichedCount > 0)) && (
        <>
          <Tally lang={lang} />
          {pendingCount > 0 && (
            <button
              type="button"
              className="btn btn-primary dock"
              onClick={onContinue}
              disabled={!job.searxngAvailable}
            >
              {t("enrich.continue", lang)} ({pendingCount} {t("enrich.retryable", lang)})
            </button>
          )}
          <button
            type="button"
            className="btn btn-quiet"
            onClick={onStart}
            disabled={!job.searxngAvailable}
          >
            {t("enrich.reEnrichAll", lang)} ({poiCount})
          </button>
        </>
      )}

      {/* Loading model */}
      {job.stage === "loading-model" && (
        <>
          <div className="status">
            <span className="spinner" />
            <span>
              {job.llmActive
                ? `${t("enrich.loadingModel", lang)} ${Math.round(job.modelLoadProgress * 100)}%`
                : t("enrich.preparing", lang)}
            </span>
          </div>
          <div className="progress">
            <div style={{ width: `${Math.round(job.modelLoadProgress * 100)}%` }} />
          </div>
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            {t("enrich.cancel", lang)}
          </button>
        </>
      )}

      {/* Running batch */}
      {job.stage === "running" && (
        <>
          <div className="status">
            <span className="spinner" />
            <span>
              {t(`enrich.phase.${job.phase}`, lang)} {phaseCount}/{job.total}
            </span>
          </div>
          {job.phase === "google-fallback" && (
            <div className="hint">{t("enrich.googleWait", lang)}</div>
          )}
          {job.currentPoiName && (
            <div className="hint truncate">
              {job.activePoiIds.size > 1
                ? `${t("enrich.processing", lang)} ${job.activePoiIds.size} ${t("enrich.poisWord", lang)} (${job.currentPoiName}...)`
                : `${t("enrich.current", lang)} ${job.currentPoiName}`}
            </div>
          )}
          {job.etaSeconds != null && job.etaSeconds > 0 && (
            <div className="hint">
              {t("enrich.eta", lang)} {formatEta(job.etaSeconds)}
            </div>
          )}
          <Tally lang={lang} />
          <button type="button" className="btn" onClick={onCancel}>
            {t("enrich.stop", lang)}
          </button>
        </>
      )}

      {/* Paused: CAPTCHA required */}
      {isPausedCaptcha && (
        <>
          <div className="notice notice-warning">
            <Icon node={TriangleAlert} />
            <p>
              <strong>{t("enrich.captchaBlocked", lang)}</strong>
              <br />
              {t("enrich.captchaInstructions", lang)}
            </p>
          </div>
          {job.captchaUrl && (
            <a href={job.captchaUrl} target="_blank" rel="noopener noreferrer" className="btn">
              {t("enrich.openSearxng", lang)}
            </a>
          )}
          <button type="button" className="btn btn-primary dock" onClick={onResumeAfterCaptcha}>
            {t("enrich.resume", lang)} ({pendingCount} {t("enrich.remaining", lang)})
          </button>
          <button type="button" className="btn btn-quiet" onClick={onCancel}>
            {t("enrich.cancel", lang)}
          </button>
        </>
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
              lang,
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
        <>
          <div className="notice notice-danger">
            <Icon node={CircleAlert} />
            <p>
              <strong>{t("enrich.error", lang)}</strong> {job.error}
            </p>
          </div>
          {enrichedCount > 0 && <Tally lang={lang} />}
          {pendingCount > 0 ? (
            <button type="button" className="btn btn-primary dock" onClick={onContinue}>
              {t("enrich.continueShort", lang)} ({pendingCount} {t("enrich.retryable", lang)})
            </button>
          ) : (
            <button type="button" className="btn btn-primary dock" onClick={onStart}>
              {t("enrich.retry", lang)}
            </button>
          )}
        </>
      )}
    </div>
  );
}
