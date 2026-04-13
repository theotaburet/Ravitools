// ---------------------------------------------------------------------------
// Category filter panel (neobrutalist)
// Shows essential (default-on) and optional (default-off) categories.
// Visible both before upload (to choose what to query) and after (to filter).
// Sticky header + collapsible body to stay accessible in long sidebars.
// ---------------------------------------------------------------------------

import { useState } from "react";
import type { PoiCategory, POI, TargetLanguage } from "../types";
import { POI_CATEGORIES } from "../lib/poi-config";
import { translateCategory } from "../lib/i18n";

interface Props {
  activeCategories: Set<PoiCategory>;
  onToggle: (cat: PoiCategory) => void;
  onSelectAll: (on: boolean) => void;
  maxDistanceM: number;
  onMaxDistanceChange: (distanceM: number) => void;
  /** Pass pois only after query is done; empty array before upload */
  pois: POI[];
  /** When true, shows counts next to each category */
  showCounts?: boolean;
  /** Target language for i18n */
  targetLanguage?: TargetLanguage;
}

const essentialCats = POI_CATEGORIES.filter((c) => c.defaultEnabled !== false);
const optionalCats = POI_CATEGORIES.filter((c) => c.defaultEnabled === false);

export function CategoryFilter({
  activeCategories,
  onToggle,
  onSelectAll,
  maxDistanceM,
  onMaxDistanceChange,
  pois,
  showCounts = false,
  targetLanguage = "en",
}: Props) {
  const [collapsed, setCollapsed] = useState(false);

  const counts = new Map<PoiCategory, number>();
  if (showCounts) {
    for (const poi of pois) {
      counts.set(poi.category, (counts.get(poi.category) ?? 0) + 1);
    }
  }

  const allOn = activeCategories.size === POI_CATEGORIES.length;
  const activeCount = activeCategories.size;

  return (
    <div className="neo-box overflow-hidden filter-panel">
      <div
        className="filter-header"
        onClick={() => setCollapsed((c) => !c)}
        style={{ cursor: "pointer" }}
      >
        <span className="flex items-center gap-2">
          <span className="filter-collapse-icon">{collapsed ? "+" : "\u2212"}</span>
          {showCounts ? "Filter POIs" : "Categories to search"}
          {collapsed && (
            <span className="filter-collapsed-count">{activeCount}/{POI_CATEGORIES.length}</span>
          )}
        </span>
        <button
          className="neo-btn-sm neo-btn-secondary"
          onClick={(e) => {
            e.stopPropagation();
            onSelectAll(!allOn);
          }}
        >
          {allOn ? "None" : "All"}
        </button>
      </div>
      {!collapsed && (
        <div className="filter-body">
          <div className="px-4 py-3 border-b-2 border-black bg-white">
            <div className="flex items-center justify-between gap-3 text-sm font-black uppercase tracking-tight">
              <span>Max distance to route</span>
              <span>{maxDistanceM}m</span>
            </div>
            <input
              type="range"
              min={300}
              max={3000}
              step={100}
              value={maxDistanceM}
              onChange={(e) => onMaxDistanceChange(Number(e.target.value))}
              className="mt-3 w-full"
            />
            <p className="mt-2 text-xs text-muted">
              Narrow for fewer urban POIs, wider for sparse rural routes.
            </p>
          </div>

          {/* Essential categories */}
          <div className="filter-section-label">Essential</div>
          {essentialCats.map((cat) => (
            <CategoryRow
              key={cat.category}
              cat={cat}
              active={activeCategories.has(cat.category)}
              count={showCounts ? (counts.get(cat.category) ?? 0) : undefined}
              onToggle={onToggle}
              targetLanguage={targetLanguage}
            />
          ))}

          {/* Optional categories */}
          <div className="filter-section-label">Optional</div>
          {optionalCats.map((cat) => (
            <CategoryRow
              key={cat.category}
              cat={cat}
              active={activeCategories.has(cat.category)}
              count={showCounts ? (counts.get(cat.category) ?? 0) : undefined}
              onToggle={onToggle}
              targetLanguage={targetLanguage}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryRow({
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
  return (
    <label className="filter-item">
      <input
        type="checkbox"
        checked={active}
        onChange={() => onToggle(cat.category)}
      />
      <span
        className="filter-dot"
        style={{ backgroundColor: cat.style.backgroundColor }}
      />
      <span className={`flex-1 ${active ? "font-bold" : ""}`}>
        {translateCategory(cat.category, targetLanguage)}
      </span>
      {count !== undefined && <span className="filter-count">{count}</span>}
    </label>
  );
}
