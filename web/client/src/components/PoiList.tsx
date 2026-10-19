// --- POI list component (neobrutalist): virtualized, with enrichment + selection ---

import { useVirtualizer } from "@tanstack/react-virtual";
import { useAtom, useAtomValue } from "jotai";
import { memo, useEffect, useMemo, useRef, useState } from "react";
import { osmFacts } from "../lib/enrichment/osm-facts";
import { getAvailabilityTags } from "../lib/export";
import { km } from "../lib/format";
import { t, translateCategory, translatePoiName } from "../lib/i18n";
import { CATEGORY_COLORS } from "../lib/poi-config";
import { enrichingPoiIdsAtom, enrichmentsAtom } from "../state/enrichment";
import { filteredPoisAtom } from "../state/route";
import { selectedPoiIdAtom, targetLanguageAtom } from "../state/ui";
import type { POI } from "../types";

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

function PoiListInner() {
  const pois = useAtomValue(filteredPoisAtom);
  const enrichments = useAtomValue(enrichmentsAtom);
  const [selectedPoiId, onSelectPoi] = useAtom(selectedPoiIdAtom);
  const enrichingPoiIds = useAtomValue(enrichingPoiIdsAtom);
  const targetLanguage = useAtomValue(targetLanguageAtom);
  const [sortMode, setSortMode] = useState<SortMode>("distance");
  const parentRef = useRef<HTMLDivElement>(null);

  const sortedPois = useMemo(() => sortPois(pois, sortMode), [pois, sortMode]);

  const virtualizer = useVirtualizer({
    count: sortedPois.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 80, // estimated row height in px
    overscan: 10,
  });

  // Back from the detail (the list was hidden meanwhile): the POI's row comes into view and
  // takes the focus, now if it is rendered, else as soon as the scroll renders it
  const lastSelected = useRef<string | null>(null);
  const focusWhenRendered = useRef<string | null>(null);
  useEffect(() => {
    if (selectedPoiId) {
      lastSelected.current = selectedPoiId;
      return;
    }
    const id = lastSelected.current;
    lastSelected.current = null;
    const idx = sortedPois.findIndex((p) => p.id === id);
    if (idx < 0) return;
    virtualizer.scrollToIndex(idx, { align: "center" });
    const row = parentRef.current?.querySelector<HTMLElement>(`[data-poi-id="${id}"]`);
    if (row) row.focus();
    else focusWhenRendered.current = id;
  }, [selectedPoiId, sortedPois, virtualizer]);

  if (pois.length === 0) {
    // Don't render nothing: tell the user why the list is empty.
    return <div className="neo-box poi-list-empty">{t("poi.empty", targetLanguage)}</div>;
  }

  // A row opens its POI detail, which replaces the list
  const handleRowClick = (poiId: string) => onSelectPoi(poiId);

  const cycleSortMode = () => {
    const modes: SortMode[] = ["distance", "category", "name"];
    const idx = modes.indexOf(sortMode);
    setSortMode(modes[(idx + 1) % modes.length]);
  };

  return (
    <div className="neo-box overflow-hidden">
      <div className="poi-list-header">
        <h3 className="poi-list-title">
          {t("poi.alongRoute", targetLanguage)}
          <small>{pois.length}</small>
        </h3>
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
            const facts = osmFacts(poi.tags, targetLanguage);
            const isSelected = selectedPoiId === poi.id;
            const isEnriching = enrichingPoiIds?.has(poi.id) ?? false;

            return (
              // biome-ignore lint/a11y/useSemanticElements: a real <button> cannot wrap the row: it contains nested buttons and links
              <div
                key={poi.id}
                data-index={virtualRow.index}
                data-poi-id={poi.id}
                ref={(el) => {
                  virtualizer.measureElement(el);
                  if (el && el.dataset.poiId === focusWhenRendered.current) {
                    focusWhenRendered.current = null;
                    el.focus();
                  }
                }}
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
                  style={{ backgroundColor: CATEGORY_COLORS[poi.category] }}
                />
                <div className="flex-1 min-w-0">
                  <div className="poi-list-name">{translatePoiName(poi.name, targetLanguage)}</div>
                  <div className="poi-list-meta">
                    {translateCategory(poi.category, targetLanguage)} &middot; km{" "}
                    {km(poi.alongTraceDistance)} &middot; {Math.round(poi.distanceToTrace)}m
                    {poi.tags.opening_hours && ` · ${poi.tags.opening_hours}`}
                  </div>
                  {facts.length > 0 && <div className="poi-list-meta">{facts.join(" · ")}</div>}
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
