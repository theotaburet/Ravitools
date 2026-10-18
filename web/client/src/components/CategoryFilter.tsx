// Category filter: max distance slider + a grid of category chips.
// Visible both before upload (to choose what to query) and after (to filter).
// Each chip wraps a real checkbox (screen readers, tests); the chip is the control.

import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { t, translateCategory } from "../lib/i18n";
import { CORRIDOR_M, POI_CATEGORIES } from "../lib/poi-config";
import {
  activeCategoriesAtom,
  poisAtom,
  routeSettingsAtom,
  setAllCategoriesAtom,
  setMaxDistanceAtom,
  toggleCategoryAtom,
} from "../state/route";
import { targetLanguageAtom } from "../state/ui";
import type { PoiCategory, TargetLanguage } from "../types";

const essentialCats = POI_CATEGORIES.filter((c) => c.defaultEnabled !== false);
const optionalCats = POI_CATEGORIES.filter((c) => c.defaultEnabled === false);

export function CategoryFilter() {
  const activeCategories = useAtomValue(activeCategoriesAtom);
  const pois = useAtomValue(poisAtom);
  const maxDistanceM = useAtomValue(routeSettingsAtom).maxDistanceM;
  const targetLanguage = useAtomValue(targetLanguageAtom);
  const onToggle = useSetAtom(toggleCategoryAtom);
  const onSelectAll = useSetAtom(setAllCategoriesAtom);
  const onMaxDistanceChange = useSetAtom(setMaxDistanceAtom);
  const showCounts = pois.length > 0;

  // Keep the slider snappy but only re-process POIs ~once per 150ms,
  // instead of on every pixel of drag.
  const [displayDist, setDisplayDist] = useState(maxDistanceM);
  const commitTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => setDisplayDist(maxDistanceM), [maxDistanceM]);
  const handleDistChange = (v: number) => {
    setDisplayDist(v);
    if (commitTimer.current) clearTimeout(commitTimer.current);
    commitTimer.current = setTimeout(() => onMaxDistanceChange(v), 150);
  };

  const counts = new Map<PoiCategory, number>();
  if (showCounts) {
    for (const poi of pois) {
      counts.set(poi.category, (counts.get(poi.category) ?? 0) + 1);
    }
  }

  const allOn = activeCategories.size === POI_CATEGORIES.length;
  const chip = (cat: (typeof POI_CATEGORIES)[number]) => (
    <CategoryChip
      key={cat.category}
      cat={cat}
      active={activeCategories.has(cat.category)}
      count={showCounts ? (counts.get(cat.category) ?? 0) : undefined}
      onToggle={onToggle}
      targetLanguage={targetLanguage}
    />
  );

  return (
    <div className="filter-panel">
      <div className="filter-distance">
        <div className="filter-distance-row">
          <span>{t("filter.maxDistance", targetLanguage)}</span>
          <span className="filter-distance-value">{displayDist} m</span>
        </div>
        <input
          type="range"
          min={300}
          max={CORRIDOR_M}
          step={100}
          value={displayDist}
          onChange={(e) => handleDistChange(Number(e.target.value))}
          aria-label={t("filter.maxDistance", targetLanguage)}
        />
        <p className="hint">{t("filter.distanceHint", targetLanguage)}</p>
      </div>

      <div className="filter-toolbar">
        <span className="filter-section-label">{t("filter.essential", targetLanguage)}</span>
        <button
          type="button"
          className="neo-btn-ghost neo-btn-sm"
          onClick={() => onSelectAll(!allOn)}
        >
          {allOn ? t("filter.none", targetLanguage) : t("filter.all", targetLanguage)}
        </button>
      </div>
      <div className="filter-grid">{essentialCats.map(chip)}</div>

      <span className="filter-section-label">{t("filter.optional", targetLanguage)}</span>
      <div className="filter-grid">{optionalCats.map(chip)}</div>
    </div>
  );
}

function CategoryChip({
  cat,
  active,
  count,
  onToggle,
  targetLanguage = "en",
}: {
  cat: (typeof POI_CATEGORIES)[number];
  active: boolean;
  count?: number;
  onToggle: (cat: PoiCategory) => void;
  targetLanguage?: TargetLanguage;
}) {
  const name = translateCategory(cat.category, targetLanguage);
  return (
    <label className="filter-chip" title={name}>
      <input type="checkbox" checked={active} onChange={() => onToggle(cat.category)} />
      <span className="filter-dot" style={{ backgroundColor: cat.color }} />
      <span className="filter-chip-name">{name}</span>
      {count !== undefined && <span className="filter-count">{count}</span>}
    </label>
  );
}
