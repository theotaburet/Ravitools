// ---------------------------------------------------------------------------
// Session persistence – save/restore app state to localStorage
// ---------------------------------------------------------------------------

import type {
  POI,
  PoiCategory,
  TraceData,
  EnrichedData,
  TargetLanguage,
} from "../types";

// ---------------------------------------------------------------------------
// Schema versioning
// ---------------------------------------------------------------------------

/** Bump this when the persisted shape changes in a breaking way */
const SCHEMA_VERSION = 1;

const STORAGE_KEY = "ravitools_session";

// ---------------------------------------------------------------------------
// Persisted shape (subset of app state, JSON-serializable)
// ---------------------------------------------------------------------------

interface PersistedSession {
  version: number;
  savedAt: string; // ISO timestamp
  /** Active category names */
  activeCategories: PoiCategory[];
  /** Trace metadata (not the full point arrays) */
  trace: TraceData | null;
  /** Found POIs */
  pois: POI[];
  /** Enrichment results: stored as [id, data][] for JSON compat */
  enrichments: [string, EnrichedData][];
  /** User preferences */
  targetLanguage: TargetLanguage;
  enrichAll: boolean;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface SessionSnapshot {
  activeCategories: Set<PoiCategory>;
  trace: TraceData | null;
  pois: POI[];
  enrichments: Map<string, EnrichedData>;
  targetLanguage: TargetLanguage;
  enrichAll: boolean;
  savedAt: string;
}

/**
 * Save current session state to localStorage.
 * Silently no-ops if localStorage is unavailable.
 */
export function saveSession(snapshot: Omit<SessionSnapshot, "savedAt">): void {
  try {
    const data: PersistedSession = {
      version: SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      activeCategories: [...snapshot.activeCategories],
      trace: snapshot.trace,
      pois: snapshot.pois,
      enrichments: [...snapshot.enrichments.entries()],
      targetLanguage: snapshot.targetLanguage,
      enrichAll: snapshot.enrichAll,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // localStorage full or unavailable — silently skip
  }
}

/**
 * Load a previously saved session from localStorage.
 * Returns null if no session exists, version mismatch, or data is corrupt.
 */
export function loadSession(): SessionSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const data: PersistedSession = JSON.parse(raw);

    // Version gate
    if (data.version !== SCHEMA_VERSION) {
      clearSession();
      return null;
    }

    // Basic shape validation
    if (!Array.isArray(data.pois) || !Array.isArray(data.enrichments)) {
      clearSession();
      return null;
    }

    return {
      activeCategories: new Set(data.activeCategories),
      trace: data.trace,
      pois: data.pois,
      enrichments: new Map(data.enrichments),
      targetLanguage: data.targetLanguage ?? "en",
      enrichAll: data.enrichAll ?? false,
      savedAt: data.savedAt,
    };
  } catch {
    clearSession();
    return null;
  }
}

/**
 * Check if a saved session exists (without parsing it).
 */
export function hasSession(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== null;
  } catch {
    return false;
  }
}

/**
 * Clear saved session from localStorage.
 */
export function clearSession(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // silently skip
  }
}
