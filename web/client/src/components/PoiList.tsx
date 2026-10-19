// --- POI list (design.md 7, 02 POI): one compact row per POI, in route order (the order
// ◀ ▶ walk in the detail), virtualized inside the tab panel's own scroll ---

import { useVirtualizer } from "@tanstack/react-virtual";
import { useAtom, useAtomValue } from "jotai";
import { ChevronRight } from "lucide";
import { memo, useEffect, useRef, useState } from "react";
import { km } from "../lib/format";
import { t, translatePoiName } from "../lib/i18n";
import { CATEGORY_FAMILIES, FAMILY_COLORS, poiGlyph } from "../lib/poi-config";
import { enrichingPoiIdsAtom, enrichmentsAtom } from "../state/enrichment";
import { filteredPoisAtom } from "../state/route";
import { paletteAtom, selectedPoiIdAtom, targetLanguageAtom } from "../state/ui";
import { Icon } from "./Icon";

/** The list's top inside the panel's scrolled content: the virtualizer's scroll margin */
function offsetIn(panel: Element | null, el: HTMLElement | null): number {
  if (!panel || !el) return 0;
  return el.getBoundingClientRect().top - panel.getBoundingClientRect().top + panel.scrollTop;
}

function PoiListInner() {
  const pois = useAtomValue(filteredPoisAtom);
  const enrichments = useAtomValue(enrichmentsAtom);
  const [selectedPoiId, onSelectPoi] = useAtom(selectedPoiIdAtom);
  const enrichingPoiIds = useAtomValue(enrichingPoiIdsAtom);
  const palette = useAtomValue(paletteAtom);
  const targetLanguage = useAtomValue(targetLanguageAtom);
  const listRef = useRef<HTMLDivElement>(null);

  // No nested scroller: the rows scroll with the filters above them. No rows while the detail
  // hides the list: hidden rows measure 0 px, the virtualizer would scroll the panel to make up
  // for it, which moves the margin, which re-renders, without end
  const panel = listRef.current?.closest(".tab-panel") ?? null;
  const virtualizer = useVirtualizer({
    count: selectedPoiId ? 0 : pois.length,
    getScrollElement: () => listRef.current?.closest(".tab-panel") ?? null,
    estimateSize: () => 60,
    overscan: 10,
    scrollMargin: offsetIn(panel, listRef.current),
  });

  // Back from the detail: the list was hidden, so its offset in the panel is only right from
  // the next render. Scroll to the row then, and focus it now or as soon as it is rendered.
  const lastSelected = useRef<string | null>(null);
  const focusWhenRendered = useRef<string | null>(null);
  const [returnTo, setReturnTo] = useState<string | null>(null);
  useEffect(() => {
    if (selectedPoiId) lastSelected.current = selectedPoiId;
    else if (lastSelected.current) {
      setReturnTo(lastSelected.current);
      lastSelected.current = null;
    }
  }, [selectedPoiId]);
  useEffect(() => {
    if (!returnTo) return;
    setReturnTo(null);
    const idx = pois.findIndex((p) => p.id === returnTo);
    if (idx < 0) return;
    virtualizer.scrollToIndex(idx, { align: "center" });
    const row = listRef.current?.querySelector<HTMLElement>(`[data-poi-id="${returnTo}"]`);
    if (row) row.focus();
    else focusWhenRendered.current = returnTo;
  }, [returnTo, pois, virtualizer]);

  if (pois.length === 0) {
    // Don't render nothing: tell the user why the list is empty.
    return <p className="poi-list-empty">{t("poi.empty", targetLanguage)}</p>;
  }

  return (
    <section aria-labelledby="poi-list-title">
      <h3 id="poi-list-title" className="micro poi-list-title">
        {t("poi.alongRoute", targetLanguage)} · {pois.length}
      </h3>
      <div
        ref={listRef}
        style={{ height: `${virtualizer.getTotalSize()}px`, position: "relative" }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const poi = pois[virtualRow.index];
          const enrichment = enrichments.get(poi.id);
          const { fill, glyph } = FAMILY_COLORS[palette][CATEGORY_FAMILIES[poi.category]];
          return (
            <button
              type="button"
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
              className="poi-list-item"
              style={{
                transform: `translateY(${virtualRow.start - virtualizer.options.scrollMargin}px)`,
              }}
              onClick={() => onSelectPoi(poi.id)}
            >
              <span className="pastille pastille-sm" style={{ background: fill, color: glyph }}>
                <Icon node={poiGlyph(poi)} size={12} />
              </span>
              <span className="poi-list-text">
                <span className="poi-list-name">{translatePoiName(poi.name, targetLanguage)}</span>
                <span className="micro">
                  KM {km(poi.alongTraceDistance)} · +{Math.round(poi.distanceToTrace)} M
                </span>
              </span>
              {enrichingPoiIds?.has(poi.id) && enrichment?.status !== "done" ? (
                <span
                  className="spinner-sm"
                  role="img"
                  aria-label={t("poi.searching", targetLanguage)}
                />
              ) : (
                enrichment?.status === "done" && (
                  <span className="badge">{t("poi.enriched", targetLanguage)}</span>
                )
              )}
              <Icon node={ChevronRight} size={18} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

export const PoiList = memo(PoiListInner);
