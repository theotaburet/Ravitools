// ---------------------------------------------------------------------------
// POI list component (neobrutalist) – virtualized, with enrichment + selection
// ---------------------------------------------------------------------------

import { useState, useRef, useEffect, useCallback } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { POI, EnrichedData, SkipReason } from "../types";
import { buildGoogleMapsUrl } from "../lib/enrichment";

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
}

export function PoiList({ pois, enrichments, selectedPoiId, onSelectPoi }: Props) {
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
                  <div className="poi-list-name">{poi.name}</div>
                  <div className="poi-list-meta">
                    {poi.category} &middot; {Math.round(poi.distanceToTrace)}m
                    {poi.tags.opening_hours && ` · ${poi.tags.opening_hours}`}
                  </div>

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
                        <div className="poi-enrichment-meta">
                          {enrichment.hours}
                        </div>
                      )}
                      {(enrichment.translatedSummary || enrichment.summary) && (
                        <div className="poi-enrichment-summary">
                          {enrichment.translatedSummary ?? enrichment.summary}
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
