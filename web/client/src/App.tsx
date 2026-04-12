// ---------------------------------------------------------------------------
// App – main application component (neobrutalist Tailwind)
// ---------------------------------------------------------------------------

import { useRavitools } from "./hooks/useRavitools";
import { GpxUpload } from "./components/GpxUpload";
import { RouteMap } from "./components/RouteMap";
import { CategoryFilter } from "./components/CategoryFilter";
import { ExportPanel } from "./components/ExportPanel";
import { PoiList } from "./components/PoiList";

export default function App() {
  const {
    state,
    filteredPois,
    processFile,
    reset,
    toggleCategory,
    setAllCategories,
  } = useRavitools();

  const isProcessing =
    state.stage === "parsing" ||
    state.stage === "simplifying" ||
    state.stage === "querying" ||
    state.stage === "processing";

  const hasPois = state.pois.length > 0;

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <header className="flex items-center gap-4 px-5 py-3 border-b-3 border-black bg-white shrink-0">
        <h1 className="text-2xl font-black uppercase tracking-tight">
          Ravitools
        </h1>
        <span className="neo-tag bg-lime">beta</span>
        <p className="text-sm text-muted hidden sm:block">
          Find useful POIs along your cycling route
        </p>
      </header>

      <div className="app-layout">
        {/* Sidebar */}
        <aside className="sidebar">
          {/* Category selector – always visible */}
          <CategoryFilter
            activeCategories={state.activeCategories}
            onToggle={toggleCategory}
            onSelectAll={setAllCategories}
            pois={state.pois}
            showCounts={hasPois}
          />

          {/* Upload area */}
          {(state.stage === "idle" || state.stage === "error") && (
            <GpxUpload onFile={processFile} disabled={isProcessing} />
          )}

          {/* Status / Progress */}
          {state.progress && (
            <div
              className={`status-bar ${state.stage === "error" ? "error" : ""}`}
            >
              {isProcessing && <span className="spinner" />}
              <span>{state.progress}</span>
            </div>
          )}

          {/* Error message */}
          {state.error && (
            <div className="error-box">
              <p>
                <span className="font-black uppercase">Error:</span>{" "}
                {state.error}
              </p>
              <button className="neo-btn-sm neo-btn-secondary" onClick={reset}>
                Try again
              </button>
            </div>
          )}

          {/* Export */}
          {state.stage === "done" && (
            <ExportPanel pois={filteredPois} trace={state.trace} />
          )}

          {/* Reset button */}
          {state.stage === "done" && (
            <button className="neo-btn-secondary w-full" onClick={reset}>
              Load another GPX
            </button>
          )}

          {/* POI list */}
          {state.stage === "done" && <PoiList pois={filteredPois} />}
        </aside>

        {/* Map */}
        <main className="map-container">
          <RouteMap trace={state.trace} pois={filteredPois} />
        </main>
      </div>
    </div>
  );
}
