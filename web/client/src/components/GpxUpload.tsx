// GPX Upload component: drag & drop, file picker, or the bundled example route.
// Supports multiple GPX files simultaneously.

import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useState } from "react";
import { t } from "../lib/i18n";
import { parseSession } from "../lib/session";
import { isProcessingAtom, processFilesAtom, routeErrorAtom } from "../state/route";
import { restoreSessionAtom } from "../state/session";
import { targetLanguageAtom } from "../state/ui";

/** Served from public/, works on the GitHub Pages sub-path too */
const EXAMPLE_GPX = `${import.meta.env.BASE_URL}examples/galibier-climb.gpx`;

// FileReader instead of File.text(): jsdom (tests) doesn't implement the latter
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
  const restoreSession = useSetAtom(restoreSessionAtom);
  const setRouteError = useSetAtom(routeErrorAtom);
  const [dragOver, setDragOver] = useState(false);

  const importPlan = useCallback(
    async (file: File) => {
      const session = parseSession(await readText(file));
      if (!session) {
        setRouteError(t("upload.badPlan", lang));
        return;
      }
      restoreSession(session);
    },
    [restoreSession, setRouteError, lang],
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

  // The example goes through the exact same pipeline as a dropped file.
  const loadExample = useCallback(async () => {
    try {
      const res = await fetch(EXAMPLE_GPX);
      if (!res.ok) throw new Error(String(res.status));
      const text = await res.text();
      onFiles([new File([text], "galibier-climb.gpx", { type: "application/gpx+xml" })]);
    } catch {
      setRouteError(t("upload.exampleFailed", lang));
    }
  }, [onFiles, setRouteError, lang]);

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop is a pointer-only enhancement: the overlaid file input is the accessible control
    <div
      className={`upload-zone ${dragOver ? "drag-over" : ""} ${disabled ? "disabled" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
        <polyline points="17 8 12 3 7 8" />
        <line x1="12" y1="3" x2="12" y2="15" />
      </svg>

      <p className="upload-title">{t("upload.drop", lang)}</p>
      <p className="upload-hint">{t("upload.browse", lang)}</p>
      <p className="upload-hint">{t("upload.plan", lang)}</p>

      <button
        type="button"
        className="neo-btn-secondary neo-btn-sm upload-example"
        onClick={loadExample}
        disabled={disabled}
      >
        {t("upload.example", lang)}
      </button>

      <input
        type="file"
        accept=".gpx,.json"
        multiple
        onChange={handleChange}
        disabled={disabled}
        aria-label={t("upload.input", lang)}
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
    </div>
  );
}
