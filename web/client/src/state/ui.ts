// ---------------------------------------------------------------------------
// UI preferences and selection state
// ---------------------------------------------------------------------------

import { atom } from "jotai";
import type { TargetLanguage } from "../types";

export const targetLanguageAtom = atom<TargetLanguage>("en");
export const enrichAllAtom = atom(false);
export const selectedPoiIdAtom = atom<string | null>(null);
/** Position hovered on the elevation profile, mirrored as a marker on the map */
export const profileHoverAtom = atom<{ lat: number; lon: number } | null>(null);
export const showResumePromptAtom = atom(false);
