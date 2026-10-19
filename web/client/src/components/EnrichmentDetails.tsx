// A "done" enrichment in the POI detail (design.md 7, 02 POI): the trust badge and the
// description in sight (EnrichmentSummary), everything else behind its <details> (EnrichmentDetails).

import { BOOKING_KEY } from "../lib/enrichment/osm-facts";
import { getSynthesisBadgeClass, getSynthesisLabel } from "../lib/enrichment/provenance";
import { splitHoursLines } from "../lib/export";
import { priceTier } from "../lib/format";
import { t, tLabel } from "../lib/i18n";
import { starString } from "../lib/stars";
import type { EnrichedData, TargetLanguage } from "../types";

interface Props {
  enrichment: EnrichedData;
  targetLanguage?: TargetLanguage;
}

/** Format confidence as a label */
function confidenceLabel(c: number): string {
  if (c >= 0.6) return "high";
  if (c >= 0.3) return "medium";
  if (c > 0) return "low";
  return "none";
}

/** Trust badge, description and review; renders nothing unless the enrichment completed */
export function EnrichmentSummary({ enrichment, targetLanguage = "en" }: Props) {
  if (enrichment.status !== "done") return null;
  const synthesisLabel = getSynthesisLabel(enrichment);

  return (
    <>
      {synthesisLabel && (
        <div className="poi-enrichment-meta">
          <span
            className={getSynthesisBadgeClass(enrichment)}
            title={
              enrichment.synthesisSource === "llm" || enrichment.synthesisSource === "llm-repaired"
                ? t("enrich.aiDisclaimer", targetLanguage)
                : undefined
            }
          >
            {synthesisLabel}
          </span>
          {enrichment.googleMapsFields && enrichment.googleMapsFields.length > 0 && (
            <span
              className="poi-badge poi-badge-maps"
              title={`Google Maps: ${enrichment.googleMapsFields.join(", ")}`}
            >
              Maps
            </span>
          )}
        </div>
      )}
      {enrichment.description && (
        <div className="poi-enrichment-summary">{enrichment.description}</div>
      )}
      {enrichment.review && (
        <div className="poi-enrichment-summary" style={{ fontStyle: "italic" }}>
          {enrichment.review}
        </div>
      )}
    </>
  );
}

/** Rating, hours, season, prices, booking, divergences, cautions, confidence and sources */
export function EnrichmentDetails({ enrichment, targetLanguage = "en" }: Props) {
  if (enrichment.status !== "done") return null;
  const confidence = confidenceLabel(enrichment.confidence);
  const confirmation = enrichment.structured?.sourceConfirmation;

  return (
    <>
      <div className="poi-enrichment-meta">
        {enrichment.rating != null && (
          <span className="poi-rating">
            {starString(enrichment.rating)} {enrichment.rating.toFixed(1)}
          </span>
        )}
        {enrichment.reviewCount != null && (
          <span>
            {" "}
            ({enrichment.reviewCount} {t("poi.reviews", targetLanguage)})
          </span>
        )}
        {enrichment.priceLevel != null && (
          <span>
            {" · "}
            {priceTier(enrichment.priceLevel)}
          </span>
        )}
      </div>
      {enrichment.openingHours && enrichment.openingHours.length > 0 ? (
        <table className="poi-hours-table">
          <tbody>
            {enrichment.openingHours.map((entry) => (
              <tr key={`${entry.day}-${entry.open}`}>
                <td className="poi-hours-day">{entry.day}</td>
                <td className="poi-hours-time">
                  {entry.open === "closed"
                    ? t("poi.closed", targetLanguage)
                    : `${entry.open}–${entry.close ?? ""}`}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : enrichment.hours ? (
        <div className="poi-enrichment-meta poi-enrichment-meta-preline">
          {splitHoursLines(enrichment.hours).join("\n")}
        </div>
      ) : null}
      {enrichment.season && (
        <div className="poi-enrichment-meta">
          {tLabel("poi.season", enrichment.season, targetLanguage)}
        </div>
      )}
      {enrichment.priceNote && (
        <div className="poi-enrichment-meta">
          {tLabel("poi.prices", enrichment.priceNote, targetLanguage)}
        </div>
      )}
      {enrichment.booking && (
        <div className="poi-enrichment-meta">
          {t(BOOKING_KEY[enrichment.booking], targetLanguage)}
        </div>
      )}
      {enrichment.structured?.divergences && enrichment.structured.divergences.length > 0 && (
        <div className="poi-enrichment-meta poi-divergences">
          {enrichment.structured.divergences.map((d) => (
            <span key={d}>⚠ {d}</span>
          ))}
        </div>
      )}
      {enrichment.structured?.cautions && enrichment.structured.cautions.length > 0 && (
        <div className="poi-enrichment-meta poi-cautions">
          {enrichment.structured.cautions.slice(0, 2).map((c) => (
            <span key={c}>{c}</span>
          ))}
        </div>
      )}
      {enrichment.sourceCount > 0 && (
        <div className="poi-confidence-row">
          <span className={`poi-confidence poi-confidence-${confidence}`}>
            {t(`poi.confidence.${confidence}`, targetLanguage)}{" "}
            {Math.round(enrichment.confidence * 100)}%
          </span>
          {confirmation && confirmation !== "none" && (
            <span
              className={confirmation === "reviews-only" ? "poi-badge" : "poi-badge poi-badge-maps"}
            >
              {t(
                confirmation === "both"
                  ? "poi.confirm.both"
                  : confirmation === "official"
                    ? "poi.confirm.official"
                    : "poi.confirm.reviewsOnly",
                targetLanguage,
              )}
            </span>
          )}
          <span className="micro">
            {enrichment.sourceCount} {t("poi.sourceWord", targetLanguage)}
            {enrichment.sourceCount > 1 ? "s" : ""}
          </span>
        </div>
      )}
      {enrichment.sourceUrls.length > 0 && (
        <div className="poi-sources-list">
          {enrichment.sourceUrls.map((url) => (
            <a
              key={url}
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="poi-source-link"
            >
              {(() => {
                try {
                  return new URL(url).hostname;
                } catch {
                  return url;
                }
              })()}
            </a>
          ))}
        </div>
      )}
    </>
  );
}
