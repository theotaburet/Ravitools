// ---------------------------------------------------------------------------
// POI list component (neobrutalist)
// ---------------------------------------------------------------------------

import type { POI } from "../types";

interface Props {
  pois: POI[];
}

export function PoiList({ pois }: Props) {
  if (pois.length === 0) return null;

  return (
    <div className="neo-box overflow-hidden">
      <div className="poi-list-header">
        POIs along route ({pois.length})
      </div>
      <div className="max-h-[400px] overflow-y-auto">
        {pois.slice(0, 200).map((poi) => (
          <div key={poi.id} className="poi-list-item">
            <span
              className="poi-list-dot"
              style={{ backgroundColor: poi.style.backgroundColor }}
            />
            <div className="flex-1 min-w-0">
              <div className="poi-list-name">{poi.name}</div>
              <div className="poi-list-meta">
                {poi.category} &middot; {Math.round(poi.distanceToTrace)}m
                {poi.tags.opening_hours && ` &middot; ${poi.tags.opening_hours}`}
              </div>
            </div>
          </div>
        ))}
        {pois.length > 200 && (
          <div className="px-3 py-2 text-center text-xs text-muted italic border-t border-black/15">
            ...and {pois.length - 200} more. Export to see all.
          </div>
        )}
      </div>
    </div>
  );
}
