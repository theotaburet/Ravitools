// ---------------------------------------------------------------------------
// Shared rendering of a "done" enrichment result (AUDIT R27).
// Used by both the PoiList rows and the RouteMap popup — the two used to
// duplicate ~130 lines of rating/hours/description/badges markup each.
// ---------------------------------------------------------------------------

import { getSynthesisBadgeClass, getSynthesisLabel } from "../lib/enrichment/provenance";
import { getAvailabilityTags, splitHoursLines } from "../lib/export";
import { t } from "../lib/i18n";
import { starString } from "../lib/stars";
import type { EnrichedData, POI, TargetLanguage } from "../types";

interface Props {
  poi: POI;
  enrichment: EnrichedData;
  targetLanguage?: TargetLanguage;
}

/** Renders nothing unless the enrichment completed (`status === "done"`). */
export function EnrichmentDetails({ poi, enrichment, targetLanguage = "en" }: Props) {
  if (enrichment.status !== "done") return null;

  const avail = getAvailabilityTags(
    enrichment.hours,
    poi.tags.opening_hours,
    targetLanguage as "fr" | "en",
  );
  const synthesisLabel = getSynthesisLabel(enrichment);

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
            {"$".repeat(enrichment.priceLevel)}
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
      {avail.length > 0 && (
        <div className="poi-enrichment-meta poi-enrichment-meta-success">{avail.join(" · ")}</div>
      )}
      {enrichment.description && (
        <div className="poi-enrichment-summary">{enrichment.description}</div>
      )}
      {enrichment.review && (
        <div className="poi-enrichment-summary" style={{ fontStyle: "italic" }}>
          {enrichment.review}
        </div>
      )}
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
    </>
  );
}
