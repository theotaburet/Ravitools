// GPX Upload component: drag & drop, file picker, or the bundled example route, on the poster's
// registration marks (design.md 3.7, first launch only).
// Supports multiple GPX files simultaneously. With `append`, a button that adds GPX files to the
// loaded traces ("Add a GPX", tab 01).

import { useAtomValue, useSetAtom } from "jotai";
import { Plus, Upload } from "lucide";
import { useCallback, useRef, useState } from "react";
import { t } from "../lib/i18n";
import { parseSession } from "../lib/session";
import { isProcessingAtom, processFilesAtom, routeErrorAtom } from "../state/route";
import { restoreSessionAtom } from "../state/session";
import { mapViewBoundsAtom, targetLanguageAtom } from "../state/ui";
import { Icon } from "./Icon";

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

/** The map centre as a poster coordinate: "45.06° N · 6.41° E" */
function centreLabel(b: { south: number; west: number; north: number; east: number }): string {
  const lat = (b.south + b.north) / 2;
  const lon = (((b.west + b.east) / 2 + 540) % 360) - 180; // the map wraps around
  return `${Math.abs(lat).toFixed(2)}° ${lat < 0 ? "S" : "N"} · ${Math.abs(lon).toFixed(2)}° ${lon < 0 ? "W" : "E"}`;
}

export function GpxUpload({ append = false }: { append?: boolean }) {
  const onFiles = useSetAtom(processFilesAtom);
  const disabled = useAtomValue(isProcessingAtom);
  const lang = useAtomValue(targetLanguageAtom);
  const restoreSession = useSetAtom(restoreSessionAtom);
  const setRouteError = useSetAtom(routeErrorAtom);
  const bounds = useAtomValue(mapViewBoundsAtom);
  const [dragOver, setDragOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);

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
      // A plan replaces the route: not something to add to it
      const plan = !append && files.find((f) => f.name.toLowerCase().endsWith(".json"));
      if (plan) {
        void importPlan(plan);
        return;
      }
      const gpxFiles = files.filter((f) => f.name.toLowerCase().endsWith(".gpx"));
      if (gpxFiles.length > 0) onFiles(gpxFiles, append);
      else setRouteError(t("upload.unsupported", lang));
    },
    [importPlan, onFiles, setRouteError, lang, append],
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

  if (append) {
    return (
      <>
        <button
          type="button"
          className="btn"
          onClick={() => input.current?.click()}
          disabled={disabled}
        >
          <Icon node={Plus} />
          {t("upload.add", lang)}
        </button>
        <input
          ref={input}
          type="file"
          accept=".gpx"
          multiple
          hidden
          onChange={handleChange}
          aria-label={t("upload.add", lang)}
        />
      </>
    );
  }

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: drag-and-drop is a pointer-only enhancement: the overlaid file input is the accessible control
    <div
      className={`card upload-zone ${dragOver ? "drag-over" : ""} ${disabled ? "disabled" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <p className="micro poster-marks" aria-hidden="true">
        <span>+</span>
        {bounds && <span>{centreLabel(bounds)}</span>}
        <span>+</span>
      </p>
      <Icon node={Upload} size={32} />
      <p className="upload-title">{t("upload.drop", lang)}</p>
      <p className="hint">{t("upload.browse", lang)}</p>
      <p className="hint">{t("upload.plan", lang)}</p>

      <button
        type="button"
        className="btn btn-quiet btn-sm upload-example"
        onClick={loadExample}
        disabled={disabled}
      >
        {t("upload.example", lang)}
      </button>
      <p className="micro poster-marks" aria-hidden="true">
        <span>01</span>
        <span>02</span>
        <span>03</span>
        <span>04</span>
      </p>

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
