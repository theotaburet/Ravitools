// ---------------------------------------------------------------------------
// GPX Upload component – drag & drop or file picker (neobrutalist)
// Supports multiple GPX files simultaneously
// ---------------------------------------------------------------------------

import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useState } from "react";
import { t } from "../lib/i18n";
import { parseSession } from "../lib/session";
import { restoreEnrichmentsAtom } from "../state/enrichment";
import {
  isProcessingAtom,
  processFilesAtom,
  restoreRouteAtom,
  routeErrorAtom,
} from "../state/route";
import { enrichAllAtom, targetLanguageAtom } from "../state/ui";

// ponytail: FileReader instead of File.text() — jsdom (tests) doesn't implement the latter
function readText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsText(file);
  });
}

export function GpxUpload() {
  const onFiles = useSetAtom(processFilesAtom);
  const disabled = useAtomValue(isProcessingAtom);
  const lang = useAtomValue(targetLanguageAtom);
  const restoreRoute = useSetAtom(restoreRouteAtom);
  const restoreEnrichments = useSetAtom(restoreEnrichmentsAtom);
  const setTargetLanguage = useSetAtom(targetLanguageAtom);
  const setEnrichAll = useSetAtom(enrichAllAtom);
  const setRouteError = useSetAtom(routeErrorAtom);
  const [dragOver, setDragOver] = useState(false);

  const importPlan = useCallback(
    async (file: File) => {
      const session = parseSession(await readText(file));
      if (!session) {
        setRouteError(t("upload.badPlan", lang));
        return;
      }
      // Same restore path as the "Resume" prompt in App.tsx
      restoreRoute({
        traces: session.traces,
        pois: session.pois,
        activeCategories: session.activeCategories,
        routeSettings: session.routeSettings,
      });
      restoreEnrichments(session.enrichments);
      setTargetLanguage(session.targetLanguage);
      setEnrichAll(session.enrichAll);
    },
    [restoreRoute, restoreEnrichments, setTargetLanguage, setEnrichAll, setRouteError, lang],
  );

  const handleFiles = useCallback(
    (files: File[]) => {
      const plan = files.find((f) => f.name.toLowerCase().endsWith(".json"));
      if (plan) {
        void importPlan(plan);
        return;
      }
      const gpxFiles = files.filter((f) => f.name.toLowerCase().endsWith(".gpx"));
      if (gpxFiles.length > 0) {
        onFiles(gpxFiles);
      }
    },
    [importPlan, onFiles],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (disabled) return;
      handleFiles(Array.from(e.dataTransfer.files));
    },
    [handleFiles, disabled],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        handleFiles(Array.from(files));
      }
    },
    [handleFiles],
  );

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop is a pointer-only enhancement — the overlaid file input is the accessible control (AUDIT R34)
    <div
      className={`upload-zone ${dragOver ? "drag-over" : ""} ${disabled ? "disabled" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      {/* Big upload icon */}
      <svg
        width="56"
        height="56"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="text-black"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>

      <p className="text-lg font-black uppercase tracking-tight">{t("upload.drop", lang)}</p>
      <p className="text-sm text-muted font-mono">{t("upload.browse", lang)}</p>
      <p className="text-xs text-muted font-mono">{t("upload.plan", lang)}</p>

      <input
        type="file"
        accept=".gpx,.json"
        multiple
        onChange={handleChange}
        disabled={disabled}
        aria-label="Upload GPX files"
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
    </div>
  );
}
