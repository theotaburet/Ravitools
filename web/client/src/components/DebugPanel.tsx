// --- DebugPanel: log viewer for pipeline diagnostics (the debug view, opened from the settings) ---

import { useAtomValue, useSetAtom } from "jotai";
import { ChevronLeft } from "lucide";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  clearLog,
  getLogEntries,
  isDebugEnabled,
  type LogEntry,
  onLog,
  setDebugEnabled,
} from "../lib/debug-log";
import { t } from "../lib/i18n";
import { showDebugAtom, targetLanguageAtom } from "../state/ui";
import { Icon } from "./Icon";

export function DebugPanel() {
  const lang = useAtomValue(targetLanguageAtom);
  const showDebug = useSetAtom(showDebugAtom);
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
  // biome-ignore lint/correctness/useExhaustiveDependencies: `entries` is the intentional trigger: the effect scrolls when the log grows
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
      <div className="debug-head">
        <button type="button" className="btn btn-quiet btn-sm" onClick={() => showDebug(false)}>
          <Icon node={ChevronLeft} />
          {t("action.back", lang)}
        </button>
        <h2 className="micro">{t("settings.debug", lang)}</h2>
      </div>
      <div className="debug-panel-body">
        <div className="debug-panel-toolbar">
          <label className="switch">
            <input
              type="checkbox"
              role="switch"
              aria-checked={enabled}
              checked={enabled}
              onChange={toggleEnabled}
            />
            Logging
          </label>
          <button
            type="button"
            className="btn btn-sm"
            onClick={handleClear}
            disabled={entries.length === 0}
          >
            Clear
          </button>
        </div>
        <div className="debug-panel-log" ref={scrollRef} onScroll={handleScroll}>
          {entries.length === 0 && (
            <div className="debug-panel-empty">
              {enabled
                ? "No log entries yet. Upload a GPX to see pipeline logs."
                : "Enable logging to start capturing."}
            </div>
          )}
          {entries.map((e) => (
            <div key={e.seq} className="debug-log-line">
              <span className="debug-log-ts">{e.isoTs.slice(11, 23)}</span>
              <span className={`debug-log-level debug-log-level-${e.level}`}>
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
    </div>
  );
}
