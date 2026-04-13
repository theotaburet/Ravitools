// ---------------------------------------------------------------------------
// DebugPanel – collapsible log viewer for pipeline diagnostics
// ---------------------------------------------------------------------------

import { useState, useEffect, useRef, useCallback } from "react";
import {
  type LogEntry,
  onLog,
  getLogEntries,
  clearLog,
  setDebugEnabled,
  isDebugEnabled,
} from "../lib/debug-log";

const LEVEL_COLORS: Record<string, string> = {
  debug: "#6b6b6b",
  info: "#2563eb",
  warn: "#f59e0b",
  error: "#ef4444",
};

export function DebugPanel() {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(isDebugEnabled);
  const [entries, setEntries] = useState<readonly LogEntry[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);

  // Sync enabled state
  const toggleEnabled = useCallback(() => {
    const next = !enabled;
    setEnabled(next);
    setDebugEnabled(next);
    if (next) {
      setEntries([...getLogEntries()]);
    }
  }, [enabled]);

  // Subscribe to log entries
  useEffect(() => {
    if (!enabled) return;
    // Seed with existing entries
    setEntries([...getLogEntries()]);

    const unsub = onLog(() => {
      setEntries([...getLogEntries()]);
    });
    return unsub;
  }, [enabled]);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (autoScrollRef.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    autoScrollRef.current = scrollHeight - scrollTop - clientHeight < 40;
  }, []);

  const handleClear = useCallback(() => {
    clearLog();
    setEntries([]);
  }, []);

  return (
    <div className="debug-panel">
      <button
        className="debug-panel-toggle"
        onClick={() => { setOpen(!open); if (!open && !enabled) toggleEnabled(); }}
      >
        <span className="debug-panel-icon">{open ? "▼" : "▶"}</span>
        <span>Debug</span>
        {enabled && entries.length > 0 && (
          <span className="debug-panel-count">{entries.length}</span>
        )}
      </button>

      {open && (
        <div className="debug-panel-body">
          <div className="debug-panel-toolbar">
            <label className="debug-panel-label">
              <input
                type="checkbox"
                checked={enabled}
                onChange={toggleEnabled}
                className="neo-checkbox"
              />
              Logging
            </label>
            <button
              className="neo-btn-sm neo-btn-secondary"
              onClick={handleClear}
              disabled={entries.length === 0}
            >
              Clear
            </button>
          </div>
          <div
            className="debug-panel-log"
            ref={scrollRef}
            onScroll={handleScroll}
          >
            {entries.length === 0 && (
              <div className="debug-panel-empty">
                {enabled
                  ? "No log entries yet. Upload a GPX to see pipeline logs."
                  : "Enable logging to start capturing."}
              </div>
            )}
            {entries.map((e) => (
              <div key={e.seq} className="debug-log-line">
                <span className="debug-log-ts">
                  {e.isoTs.slice(11, 23)}
                </span>
                <span
                  className="debug-log-level"
                  style={{ color: LEVEL_COLORS[e.level] || "#000" }}
                >
                  {e.level.toUpperCase().padEnd(5)}
                </span>
                <span className="debug-log-source">[{e.source}]</span>
                <span className="debug-log-msg">{e.message}</span>
                {e.data && (
                  <span className="debug-log-data">
                    {Object.entries(e.data)
                      .map(([k, v]) => `${k}=${v}`)
                      .join(" ")}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
