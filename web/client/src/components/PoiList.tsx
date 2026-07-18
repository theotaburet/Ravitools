// ---------------------------------------------------------------------------
// POI list component (neobrutalist) – virtualized, with enrichment + selection
// ---------------------------------------------------------------------------

import { useVirtualizer } from "@tanstack/react-virtual";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { buildGoogleMapsUrl } from "../lib/enrichment";
import { isRetryableDegradedResult } from "../lib/enrichment/provenance";
import { getAvailabilityTags } from "../lib/export";
import { t, translateCategory, translatePoiName } from "../lib/i18n";
import type { EnrichedData, POI, TargetLanguage } from "../types";
import { EnrichmentDetails } from "./EnrichmentDetails";

/** Format confidence as a label */
function confidenceLabel(c: number): string {
  if (c >= 0.6) return "high";
  if (c >= 0.3) return "medium";
  if (c > 0) return "low";
  return "none";
}

/** Sort mode for the POI list */
type SortMode = "distance" | "category" | "name";

function sortPois(pois: POI[], mode: SortMode): POI[] {
  const sorted = [...pois];
  switch (mode) {
    case "distance":
      sorted.sort((a, b) => a.distanceToTrace - b.distanceToTrace);
      break;
    case "category":
      sorted.sort(
        (a, b) => a.category.localeCompare(b.category) || a.distanceToTrace - b.distanceToTrace,
      );
      break;
    case "name":
      sorted.sort((a, b) => a.name.localeCompare(b.name));
      break;
  }
  return sorted;
}

interface Props {
  pois: POI[];
  enrichments: Map<string, EnrichedData>;
  selectedPoiId?: string | null;
  onSelectPoi?: (poiId: string | null) => void;
  /** IDs of POIs currently being enriched (for in-progress indicator) */
  enrichingPoiIds?: Set<string> | null;
  targetLanguage?: TargetLanguage;
}

function PoiListInner({
  pois,
  enrichments,
  selectedPoiId,
  onSelectPoi,
  enrichingPoiIds,
  targetLanguage = "en",
}: Props) {
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<SortMode>("distance");
  const parentRef = useRef<HTMLDivElement>(null);

  const sortedPois = useMemo(() => sortPois(pois, sortMode), [pois, sortMode]);

  const virtualizer = useVirtualizer({
    count: sortedPois.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80, // estimated row height in px
    overscan: 10,
  });

  // Scroll selected item into view when selectedPoiId changes (from map click)
  useEffect(() => {
    if (!selectedPoiId) return;
    const idx = sortedPois.findIndex((p) => p.id === selectedPoiId);
    if (idx >= 0) {
      virtualizer.scrollToIndex(idx, { align: "center", behavior: "smooth" });
    }
  }, [selectedPoiId, sortedPois, virtualizer]);

  if (pois.length === 0) {
    // AUDIT U5: don't render nothing — tell the user why the list is empty.
    return (
      <div
        className="neo-box"
        style={{ padding: "1rem", textAlign: "center", color: "#6b6b6b", fontFamily: "monospace" }}
      >
        {t("poi.empty", targetLanguage)}
      </div>
    );
  }

  const toggleSources = (e: React.MouseEvent, poiId: string) => {
    e.stopPropagation();
    setExpandedSources((prev) => {
      const next = new Set(prev);
      if (next.has(poiId)) next.delete(poiId);
      else next.add(poiId);
      return next;
    });
  };

  const handleRowClick = (poiId: string) => {
    if (!onSelectPoi) return;
    onSelectPoi(selectedPoiId === poiId ? null : poiId);
  };

  const cycleSortMode = () => {
    const modes: SortMode[] = ["distance", "category", "name"];
    const idx = modes.indexOf(sortMode);
    setSortMode(modes[(idx + 1) % modes.length]);
  };

  return (
    <div className="neo-box overflow-hidden">
      <div className="poi-list-header">
        <span>
          {t("poi.alongRoute", targetLanguage)} ({pois.length})
        </span>
        <button
          type="button"
          className="poi-sort-btn"
          onClick={cycleSortMode}
          aria-label={`${t("poi.changeSort", targetLanguage)}: ${t(`poi.sort.${sortMode}`, targetLanguage)}`}
          title={t("poi.changeSort", targetLanguage)}
        >
          ↕ {t(`poi.sort.${sortMode}`, targetLanguage)}
        </button>
      </div>
      <div ref={parentRef} className="poi-list-scroll">
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: "100%",
            position: "relative",
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const poi = sortedPois[virtualRow.index];
            const enrichment = enrichments.get(poi.id);
            const gmapsUrl = enrichment?.googleMapsUrl ?? buildGoogleMapsUrl(poi);
            const showSources = expandedSources.has(poi.id);
            const isSelected = selectedPoiId === poi.id;
            const isEnriching = enrichingPoiIds?.has(poi.id) ?? false;

            return (
              // biome-ignore lint/a11y/useSemanticElements: a real <button> cannot wrap the row — it contains nested buttons and links
              <div
                key={poi.id}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className={`poi-list-item${isSelected ? " poi-list-item-selected" : ""}`}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: "100%",
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                onClick={() => handleRowClick(poi.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleRowClick(poi.id);
                  }
                }}
              >
                <span
                  className="poi-list-dot"
                  style={{ backgroundColor: poi.style.backgroundColor }}
                />
                <div className="flex-1 min-w-0">
                  <div className="poi-list-name">{translatePoiName(poi.name, targetLanguage)}</div>
                  <div className="poi-list-meta">
                    {translateCategory(poi.category, targetLanguage)} &middot; km{" "}
                    {(poi.alongTraceDistance / 1000).toFixed(1)} &middot;{" "}
                    {Math.round(poi.distanceToTrace)}m
                    {poi.tags.opening_hours && ` · ${poi.tags.opening_hours}`}
                  </div>
                  {/* Availability tags from OSM hours (when no enrichment) */}
                  {enrichment?.status !== "done" &&
                    (() => {
                      const osmAvail = getAvailabilityTags(
                        null,
                        poi.tags.opening_hours,
                        targetLanguage as "fr" | "en",
                      );
                      return osmAvail.length > 0 ? (
                        <div className="poi-enrichment-meta poi-enrichment-meta-success">
                          {osmAvail.join(" · ")}
                        </div>
                      ) : null;
                    })()}

                  {/* In-progress enrichment indicator */}
                  {isEnriching && enrichment?.status !== "done" && (
                    <div className="poi-enrichment-meta poi-enriching-indicator">
                      <span className="spinner-sm" /> {t("poi.searching", targetLanguage)}
                    </div>
                  )}

                  {/* Enrichment data */}
                  {enrichment && enrichment.status === "done" && (
                    <>
                      <EnrichmentDetails
                        poi={poi}
                        enrichment={enrichment}
                        targetLanguage={targetLanguage}
                      />

                      {/* Confidence + source confirmation + sources */}
                      {enrichment.sourceCount > 0 && (
                        <div className="poi-confidence-row">
                          <span
                            className={`poi-confidence poi-confidence-${confidenceLabel(enrichment.confidence)}`}
                          >
                            {t(
                              `poi.confidence.${confidenceLabel(enrichment.confidence)}`,
                              targetLanguage,
                            )}{" "}
                            {Math.round(enrichment.confidence * 100)}%
                          </span>
                          {enrichment.structured?.sourceConfirmation &&
                            enrichment.structured.sourceConfirmation !== "none" && (
                              <span
                                className={
                                  enrichment.structured.sourceConfirmation === "reviews-only"
                                    ? "poi-badge"
                                    : "poi-badge poi-badge-maps"
                                }
                              >
                                {t(
                                  enrichment.structured.sourceConfirmation === "both"
                                    ? "poi.confirm.both"
                                    : enrichment.structured.sourceConfirmation === "official"
                                      ? "poi.confirm.official"
                                      : "poi.confirm.reviewsOnly",
                                  targetLanguage,
                                )}
                              </span>
                            )}
                          <button
                            type="button"
                            className="poi-sources-toggle"
                            onClick={(e) => toggleSources(e, poi.id)}
                            aria-expanded={showSources}
                          >
                            {enrichment.sourceCount} {t("poi.sourceWord", targetLanguage)}
                            {enrichment.sourceCount > 1 ? "s" : ""} {showSources ? "▲" : "▼"}
                          </button>
                        </div>
                      )}

                      {/* Sources disclosure */}
                      {showSources && enrichment.sourceUrls.length > 0 && (
                        <div className="poi-sources-list">
                          {enrichment.sourceUrls.map((url) => (
                            <a
                              key={url}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="poi-source-link"
                              onClick={(e) => e.stopPropagation()}
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
                  )}

                  {/* Skip reason */}
                  {enrichment && enrichment.status === "skipped" && enrichment.skipReason && (
                    <div className="poi-skip-reason">
                      {t(`poi.skip.${enrichment.skipReason}`, targetLanguage)}
                      {isRetryableDegradedResult(enrichment)
                        ? t("poi.skipRetryable", targetLanguage)
                        : ""}
                    </div>
                  )}

                  {/* Google Maps link – always shown */}
                  <a
                    href={gmapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="poi-gmaps-link"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Google Maps →
                  </a>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export const PoiList = memo(PoiListInner);
