// ---------------------------------------------------------------------------
// POI list component (neobrutalist) – virtualized, with enrichment + selection
// ---------------------------------------------------------------------------

import { useState, useRef, useEffect, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { POI, EnrichedData, SkipReason, TargetLanguage } from "../types";
import { buildGoogleMapsUrl } from "../lib/enrichment";
import { translateCategory, translatePoiName } from "../lib/i18n";
import { getAvailabilityTags } from "../lib/export";

/** Human-readable labels for skip reasons */
const SKIP_REASON_LABELS: Record<SkipReason, string> = {
  "unnamed": "Unnamed POI",
  "generic-name": "Generic name",
  "low-value-category": "Low-value category",
  "no-results": "No search results found",
  "rate-limited": "Rate limited",
  "cancelled": "Cancelled",
};

/** Format confidence as a label */
function confidenceLabel(c: number): string {
  if (c >= 0.6) return "high";
  if (c >= 0.3) return "medium";
  if (c > 0) return "low";
  return "none";
}

/** Sort mode for the POI list */
type SortMode = "distance" | "category" | "name";

const SORT_LABELS: Record<SortMode, string> = {
  distance: "Distance to route",
  category: "Category",
  name: "Name (A-Z)",
};

function sortPois(pois: POI[], mode: SortMode): POI[] {
  const sorted = [...pois];
  switch (mode) {
    case "distance":
      sorted.sort((a, b) => a.distanceToTrace - b.distanceToTrace);
      break;
    case "category":
      sorted.sort((a, b) => a.category.localeCompare(b.category) || a.distanceToTrace - b.distanceToTrace);
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

export function PoiList({ pois, enrichments, selectedPoiId, onSelectPoi, enrichingPoiIds, targetLanguage = "en" }: Props) {
  const [expandedSources, setExpandedSources] = useState<Set<string>>(new Set());
  const [sortMode, setSortMode] = useState<SortMode>("distance");
  const parentRef = useRef<HTMLDivElement>(null);

  const sortedPois = sortPois(pois, sortMode);

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

  if (pois.length === 0) return null;

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
        <span>POIs along route ({pois.length})</span>
        <button
          className="poi-sort-btn"
          onClick={cycleSortMode}
          title="Change sort order"
        >
          ↕ {SORT_LABELS[sortMode]}
        </button>
      </div>
      <div
        ref={parentRef}
        className="poi-list-scroll"
      >
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
                    {translateCategory(poi.category, targetLanguage)} &middot; km {(poi.alongTraceDistance / 1000).toFixed(1)} &middot; {Math.round(poi.distanceToTrace)}m
                    {poi.tags.opening_hours && ` · ${poi.tags.opening_hours}`}
                  </div>
                  {/* Availability tags from OSM hours (when no enrichment) */}
                  {(!enrichment || enrichment.status !== "done") && (() => {
                    const osmAvail = getAvailabilityTags(null, poi.tags.opening_hours, targetLanguage as "fr" | "en");
                    return osmAvail.length > 0 ? (
                      <div className="poi-enrichment-meta" style={{ color: "#16a34a", fontWeight: 600 }}>
                        {osmAvail.join(" · ")}
                      </div>
                    ) : null;
                  })()}

                  {/* In-progress enrichment indicator */}
                  {isEnriching && (!enrichment || enrichment.status !== "done") && (
                    <div className="poi-enrichment-meta poi-enriching-indicator">
                      <span className="spinner-sm" /> Searching...
                    </div>
                  )}

                  {/* Enrichment data */}
                  {enrichment && enrichment.status === "done" && (
                    <>
                      <div className="poi-enrichment-meta">
                        {enrichment.rating != null && (
                          <span className="poi-rating">
                            {"★".repeat(Math.round(enrichment.rating))}
                            {"☆".repeat(5 - Math.round(enrichment.rating))}
                            {" "}
                            {enrichment.rating.toFixed(1)}
                          </span>
                        )}
                        {enrichment.reviewCount != null && (
                          <span> ({enrichment.reviewCount} reviews)</span>
                        )}
                        {enrichment.specialty && (
                          <span> · {enrichment.specialty}</span>
                        )}
                        {enrichment.priceLevel != null && (
                          <span>
                            {" · "}
                            {"$".repeat(enrichment.priceLevel)}
                          </span>
                        )}
                      </div>
                      {enrichment.hours && (
                        <div className="poi-enrichment-meta" style={{ whiteSpace: "pre-line" }}>
                          {enrichment.hours
                            .split(/[;\n]|(?:\s\/\s)/)
                            .map((s) => s.trim())
                            .filter((s) => s.length > 0)
                            .join("\n")}
                        </div>
                      )}
                      {(() => {
                        const avail = getAvailabilityTags(enrichment.hours, poi.tags.opening_hours, targetLanguage as "fr" | "en");
                        return avail.length > 0 ? (
                          <div className="poi-enrichment-meta" style={{ color: "#16a34a", fontWeight: 600 }}>
                            {avail.join(" · ")}
                          </div>
                        ) : null;
                      })()}
                      {(enrichment.essentials || enrichment.translatedSummary || enrichment.summary) && (
                        <div className="poi-enrichment-summary">
                          {enrichment.essentials ?? enrichment.translatedSummary ?? enrichment.summary}
                        </div>
                      )}

                      {/* Cautions & divergences (WS12) */}
                      {enrichment.structured?.divergences && enrichment.structured.divergences.length > 0 && (
                        <div className="poi-enrichment-meta poi-divergences">
                          {enrichment.structured.divergences.map((d, i) => (
                            <span key={`div-${i}`}>⚠ {d}</span>
                          ))}
                        </div>
                      )}
                      {enrichment.structured?.cautions && enrichment.structured.cautions.length > 0 && (
                        <div className="poi-enrichment-meta poi-cautions">
                          {enrichment.structured.cautions.slice(0, 2).map((c, i) => (
                            <span key={`caut-${i}`}>{c}</span>
                          ))}
                        </div>
                      )}

                      {/* Confidence + sources */}
                      {enrichment.sourceCount > 0 && (
                        <div className="poi-confidence-row">
                          <span className={`poi-confidence poi-confidence-${confidenceLabel(enrichment.confidence)}`}>
                            {confidenceLabel(enrichment.confidence)}
                          </span>
                          <button
                            className="poi-sources-toggle"
                            onClick={(e) => toggleSources(e, poi.id)}
                          >
                            {enrichment.sourceCount} source{enrichment.sourceCount > 1 ? "s" : ""}
                            {" "}
                            {showSources ? "▲" : "▼"}
                          </button>
                        </div>
                      )}

                      {/* Sources disclosure */}
                      {showSources && enrichment.sourceUrls.length > 0 && (
                        <div className="poi-sources-list">
                          {enrichment.sourceUrls.map((url, idx) => (
                            <a
                              key={idx}
                              href={url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="poi-source-link"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {new URL(url).hostname}
                            </a>
                          ))}
                        </div>
                      )}
                    </>
                  )}

                  {/* Skip reason */}
                  {enrichment && enrichment.status === "skipped" && enrichment.skipReason && (
                    <div className="poi-skip-reason">
                      {SKIP_REASON_LABELS[enrichment.skipReason]}
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
