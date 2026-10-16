// --- UI preferences and selection state ---

import { atom } from "jotai";
import { atomWithStorage, createJSONStorage } from "jotai/utils";
import type { TargetLanguage } from "../types";

type StringStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const noStorage: StringStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

/** Node 22+ ships a localStorage stub without getItem (vitest): fall back to nothing */
function localStorageOrNone(): StringStorage {
  try {
    const s = window.localStorage;
    return typeof s?.getItem === "function" ? s : noStorage;
  } catch {
    return noStorage;
  }
}

/** Persisted theme; defaults to the OS preference on first visit */
export const themeAtom = atomWithStorage<"light" | "dark">(
  "ravitools.theme",
  window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light",
  createJSONStorage(localStorageOrNone),
);

/** Persisted UI language; defaults to the browser language on first visit */
export const targetLanguageAtom = atomWithStorage<TargetLanguage>(
  "ravitools.lang",
  navigator.language?.toLowerCase().startsWith("fr") ? "fr" : "en",
  createJSONStorage(localStorageOrNone),
);

export const enrichAllAtom = atom(false);
export const selectedPoiIdAtom = atom<string | null>(null);
/** Position hovered on the elevation profile, mirrored as a marker on the map */
export const profileHoverAtom = atom<{ lat: number; lon: number } | null>(null);
/** Position hovered on a map trace, mirrored as a cursor on the profile */
export const mapTraceHoverAtom = atom<{ traceId: string; dist: number } | null>(null);
export const showResumePromptAtom = atom(false);
/** Mobile only: the sidebar is a bottom sheet, peeking (false) or raised (true) */
export const sheetOpenAtom = atom(false);
/** Ravito-gap alert threshold in km (not persisted on purpose) */
export const gapThresholdKmAtom = atom(25);

export interface MapViewBounds {
  south: number;
  west: number;
  north: number;
  east: number;
}
/** Current map viewport: the elevation profile windows itself to it */
export const mapViewBoundsAtom = atom<MapViewBounds | null>(null);

/** One-shot zoom request (profile cluster click → map fitBounds, then reset) */
export const mapFocusAtom = atom<MapViewBounds | null>(null);
