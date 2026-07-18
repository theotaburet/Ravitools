// ---------------------------------------------------------------------------
// UI preferences and selection state
// ---------------------------------------------------------------------------

import { atom } from "jotai";
import type { TargetLanguage } from "../types";

export const targetLanguageAtom = atom<TargetLanguage>("en");
export const enrichAllAtom = atom(false);
export const selectedPoiIdAtom = atom<string | null>(null);
export const showResumePromptAtom = atom(false);
