// ---------------------------------------------------------------------------
// Debug logger – client-side structured logging with circular buffer
// ---------------------------------------------------------------------------

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface LogEntry {
  /** Auto-incremented sequence number */
  seq: number;
  /** Millisecond timestamp (performance.now for precision, Date for display) */
  ts: number;
  /** ISO timestamp for display */
  isoTs: string;
  /** Log level */
  level: LogLevel;
  /** Source module (e.g. "overpass", "parser", "pipeline") */
  source: string;
  /** Human-readable message */
  message: string;
  /** Optional structured data */
  data?: Record<string, unknown>;
}

type LogListener = (entry: LogEntry) => void;

const MAX_ENTRIES = 500;
const buffer: LogEntry[] = [];
const listeners = new Set<LogListener>();
let seq = 0;
let enabled = false;

/** Enable or disable debug logging globally */
export function setDebugEnabled(on: boolean): void {
  enabled = on;
  if (on && buffer.length === 0) {
    emit("info", "debug", "Debug logging enabled");
  }
}

export function isDebugEnabled(): boolean {
  return enabled;
}

function emit(
  level: LogLevel,
  source: string,
  message: string,
  data?: Record<string, unknown>,
): void {
  const entry: LogEntry = {
    seq: seq++,
    ts: performance.now(),
    isoTs: new Date().toISOString(),
    level,
    source,
    message,
    data,
  };
  buffer.push(entry);
  if (buffer.length > MAX_ENTRIES) buffer.shift();
  for (const fn of listeners) {
    try {
      fn(entry);
    } catch {
      // never let a listener crash the pipeline
    }
  }
}

/** Subscribe to new log entries. Returns unsubscribe function. */
export function onLog(fn: LogListener): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Get a snapshot of the current buffer */
export function getLogEntries(): readonly LogEntry[] {
  return buffer;
}

/** Clear the buffer */
export function clearLog(): void {
  buffer.length = 0;
}

// ---------------------------------------------------------------------------
// Scoped logger factory – call dlog("overpass") to get a logger for that module
// ---------------------------------------------------------------------------

export interface ScopedLogger {
  debug(msg: string, data?: Record<string, unknown>): void;
  info(msg: string, data?: Record<string, unknown>): void;
  warn(msg: string, data?: Record<string, unknown>): void;
  error(msg: string, data?: Record<string, unknown>): void;
  /** Start a timer, returns a function that logs elapsed time */
  time(label: string): () => number;
}

export function dlog(source: string): ScopedLogger {
  const log = (level: LogLevel, msg: string, data?: Record<string, unknown>) => {
    if (!enabled && level !== "error" && level !== "warn") return;
    emit(level, source, msg, data);
  };

  return {
    debug: (msg, data) => log("debug", msg, data),
    info: (msg, data) => log("info", msg, data),
    warn: (msg, data) => log("warn", msg, data),
    error: (msg, data) => log("error", msg, data),
    time(label: string) {
      const t0 = performance.now();
      log("debug", `${label} started`);
      return () => {
        const elapsed = performance.now() - t0;
        log("info", `${label} completed`, { elapsedMs: Math.round(elapsed) });
        return elapsed;
      };
    },
  };
}
