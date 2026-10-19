// Category filter (design.md 7, 02 POI): the family toggles, always in sight; the distance
// slider, the hours filters and the category chips one tap away, so the list starts high in the sheet.
// Each chip wraps a real checkbox (screen readers, tests); the chip is the control.

import { useAtomValue, useSetAtom } from "jotai";
import { useEffect, useRef, useState } from "react";
import { t, translateCategory } from "../lib/i18n";
import { ALL_CATEGORIES, CORRIDOR_M, FAMILY_COLORS, POI_FAMILIES } from "../lib/poi-config";
import {
  activeCategoriesAtom,
  type HoursFilter,
  hoursFiltersAtom,
  poisAtom,
  routeSettingsAtom,
  setCategoriesAtom,
  setMaxDistanceAtom,
  toggleCategoryAtom,
  toggleHoursFilterAtom,
} from "../state/route";
import { paletteAtom, targetLanguageAtom } from "../state/ui";
import type { PoiCategory } from "../types";
import { Icon } from "./Icon";

export function CategoryFilter() {
  const activeCategories = useAtomValue(activeCategoriesAtom);
  const pois = useAtomValue(poisAtom);
  const maxDistanceM = useAtomValue(routeSettingsAtom).maxDistanceM;
  const targetLanguage = useAtomValue(targetLanguageAtom);
  const palette = useAtomValue(paletteAtom);
  const onToggle = useSetAtom(toggleCategoryAtom);
  const hours = useAtomValue(hoursFiltersAtom);
  const onToggleHours = useSetAtom(toggleHoursFilterAtom);
  const setCategories = useSetAtom(setCategoriesAtom);
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
  for (const poi of pois) counts.set(poi.category, (counts.get(poi.category) ?? 0) + 1);

  // One tap clears everything (then pick a family); from nothing, one tap brings it all back
  const noneOn = activeCategories.size === 0;

  return (
    <div className="filter-panel">
      <div className="family-row">
        {POI_FAMILIES.map(({ family, categories }) => {
          const on = categories.filter((c) => activeCategories.has(c.category)).length;
          const familyCount = categories.reduce((n, c) => n + (counts.get(c.category) ?? 0), 0);
          const { fill, glyph } = FAMILY_COLORS[palette][family];
          return (
            <button
              key={family}
              type="button"
              className="chip family-toggle"
              aria-pressed={on === categories.length ? true : on > 0 ? "mixed" : false}
              onClick={() =>
                setCategories(
                  categories.map((c) => c.category),
                  on < categories.length,
                )
              }
            >
              <span className="pastille pastille-sm" style={{ background: fill, color: glyph }}>
                <Icon node={categories[0].glyph} size={12} />
              </span>
              {t(`family.${family}`, targetLanguage)}
              {showCounts && <span className="micro">{familyCount}</span>}
            </button>
          );
        })}
        <button
          type="button"
          className="btn btn-quiet btn-sm"
          onClick={() => setCategories(ALL_CATEGORIES, noneOn)}
        >
          {noneOn ? t("filter.all", targetLanguage) : t("filter.none", targetLanguage)}
        </button>
      </div>

      <details className="filter-more">
        <summary className="micro">
          {t("filter.more", targetLanguage, {
            m: displayDist,
            on: activeCategories.size,
            all: ALL_CATEGORIES.length,
            h: hours.size,
          })}
        </summary>
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
        <div className="chip-row">
          {(["sunday", "evening"] as HoursFilter[]).map((h) => (
            <label key={h} className="chip">
              <input type="checkbox" checked={hours.has(h)} onChange={() => onToggleHours(h)} />
              {t(`avail.${h}`, targetLanguage)}
            </label>
          ))}
        </div>
        <p className="hint">{t("filter.hoursHint", targetLanguage)}</p>
        {POI_FAMILIES.map(({ family, categories }) => (
          <div key={family} className="chip-row">
            {categories.map((cat) => (
              <label key={cat.category} className="chip">
                <input
                  type="checkbox"
                  checked={activeCategories.has(cat.category)}
                  onChange={() => onToggle(cat.category)}
                />
                <span className="chip-dot" style={{ color: FAMILY_COLORS[palette][family].fill }} />
                {translateCategory(cat.category, targetLanguage)}
                {showCounts && <span className="micro">{counts.get(cat.category) ?? 0}</span>}
              </label>
            ))}
          </div>
        ))}
      </details>
    </div>
  );
}
