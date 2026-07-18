// ---------------------------------------------------------------------------
// GPX Upload component – drag & drop or file picker (neobrutalist)
// Supports multiple GPX files simultaneously
// ---------------------------------------------------------------------------

import { useAtomValue, useSetAtom } from "jotai";
import { useCallback, useState } from "react";
import { t } from "../lib/i18n";
import { isProcessingAtom, processFilesAtom } from "../state/route";
import { targetLanguageAtom } from "../state/ui";

export function GpxUpload() {
  const onFiles = useSetAtom(processFilesAtom);
  const disabled = useAtomValue(isProcessingAtom);
  const lang = useAtomValue(targetLanguageAtom);
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      if (disabled) return;
      const gpxFiles = Array.from(e.dataTransfer.files).filter((f) =>
        f.name.toLowerCase().endsWith(".gpx"),
      );
      if (gpxFiles.length > 0) {
        onFiles(gpxFiles);
      }
    },
    [onFiles, disabled],
  );

  const handleChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (files && files.length > 0) {
        onFiles(Array.from(files));
      }
    },
    [onFiles],
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

      <input
        type="file"
        accept=".gpx"
        multiple
        onChange={handleChange}
        disabled={disabled}
        aria-label="Upload GPX files"
        className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
      />
    </div>
  );
}
