// --- Sheet: the bottom sheet with detents (mobile) or the floating panel (desktop), and the pill tabs ---

import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { Download, type IconNode, MapPin, Route, Sparkles } from "lucide";
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useRef,
  useSyncExternalStore,
} from "react";
import { t } from "../lib/i18n";
import { detentPx, nearestDetent, nextDetent } from "../lib/shell";
import {
  activeTabAtom,
  selectTabAtom,
  sheetDetentAtom,
  type Tab,
  targetLanguageAtom,
} from "../state/ui";
import { Icon } from "./Icon";

export type PillTab = Exclude<Tab, "debug">;

const TAB_MARKS: Record<PillTab, { num: string; icon: IconNode }> = {
  trace: { num: "01", icon: Route },
  poi: { num: "02", icon: MapPin },
  enrich: { num: "03", icon: Sparkles },
  export: { num: "04", icon: Download },
};

const onResize = (cb: () => void) => {
  window.addEventListener("resize", cb);
  return () => window.removeEventListener("resize", cb);
};
const viewportHeight = () => window.innerHeight;

export function Sheet({ strip, children }: { strip: ReactNode; children: ReactNode }) {
  const lang = useAtomValue(targetLanguageAtom);
  const [detent, setDetent] = useAtom(sheetDetentAtom);
  const vh = useSyncExternalStore(onResize, viewportHeight);
  const px = detentPx(detent, vh);

  // The drag lives in refs: the sheet follows the finger with no React render per move
  const sheetRef = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; px: number; moved: boolean } | null>(null);
  const dragged = useRef(false);
  const draggedPx = (y: number, from: { y: number; px: number }) =>
    Math.min(detentPx("full", vh), Math.max(detentPx("low", vh), from.px + from.y - y));
  const showPx = (h: number) => sheetRef.current?.style.setProperty("--sheet-h", `${h}px`);

  const onPointerDown = (e: PointerEvent<HTMLButtonElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { y: e.clientY, px, moved: false };
    dragged.current = false;
  };
  const onPointerMove = (e: PointerEvent<HTMLButtonElement>) => {
    const from = drag.current;
    if (!from || (!from.moved && Math.abs(e.clientY - from.y) < 8)) return;
    from.moved = true;
    sheetRef.current?.classList.add("is-dragging");
    showPx(draggedPx(e.clientY, from));
  };
  const onPointerUp = (e: PointerEvent<HTMLButtonElement>) => {
    const from = drag.current;
    drag.current = null;
    if (!from?.moved) return;
    dragged.current = true;
    sheetRef.current?.classList.remove("is-dragging");
    const next = nearestDetent(draggedPx(e.clientY, from), vh);
    showPx(detentPx(next, vh)); // React skips an unchanged style: settle by hand
    setDetent(next);
  };
  // A tap (or Enter) cycles the detents; the click that ends a drag does not
  const onClick = (e: MouseEvent) => {
    if (e.detail !== 0 && dragged.current) return;
    setDetent(nextDetent(detent));
  };

  return (
    <>
      {detent === "full" && (
        <button
          type="button"
          className="map-strip"
          aria-label={t("sheet.toMid", lang)}
          onClick={() => setDetent("mid")}
        />
      )}
      <section
        ref={sheetRef}
        className="sheet"
        data-detent={detent}
        style={{ "--sheet-h": `${px}px`, "--sheet-rest": `${px}px` } as CSSProperties}
      >
        <header className="panel-head">
          <h1 className="wordmark">Ravitools</h1>
        </header>
        <button
          type="button"
          className="sheet-handle"
          aria-label={t(`sheet.${detent}`, lang)}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onClick={onClick}
        >
          <span className="sheet-grip" aria-hidden="true" />
        </button>
        <div className="sheet-strip">{strip}</div>
        <div className="sheet-body">{children}</div>
      </section>
    </>
  );
}

/** One tab's content, its own scroller: every panel stays mounted (state, scroll, running jobs), only the active one shows */
export function TabPanel({ tab, children }: { tab: Tab; children: ReactNode }) {
  const lang = useAtomValue(targetLanguageAtom);
  const active = useAtomValue(activeTabAtom);
  return (
    <div
      role="tabpanel"
      id={`panel-${tab}`}
      className="tab-panel"
      hidden={tab !== active}
      aria-labelledby={tab === "debug" ? undefined : `tab-${tab}`}
      aria-label={tab === "debug" ? t("settings.debug", lang) : undefined}
    >
      {children}
    </div>
  );
}

/** The floating pill tabs: a tablist with arrow-key navigation */
export function TabBar({ tabs }: { tabs: PillTab[] }) {
  const lang = useAtomValue(targetLanguageAtom);
  const active = useAtomValue(activeTabAtom);
  const selectTab = useSetAtom(selectTabAtom);
  const setActive = useSetAtom(activeTabAtom);

  const onKeyDown = (e: KeyboardEvent, i: number) => {
    const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (step === 0) return;
    const next = tabs[(i + step + tabs.length) % tabs.length];
    setActive(next);
    document.getElementById(`tab-${next}`)?.focus();
  };

  return (
    <div className="tabs" role="tablist" aria-label={t("tabs.label", lang)}>
      {tabs.map((tab, i) => (
        <button
          key={tab}
          type="button"
          role="tab"
          id={`tab-${tab}`}
          aria-selected={tab === active}
          aria-controls={`panel-${tab}`}
          tabIndex={tab === active || (!tabs.includes(active as PillTab) && i === 0) ? 0 : -1}
          onClick={() => selectTab(tab)}
          onKeyDown={(e) => onKeyDown(e, i)}
        >
          <Icon node={TAB_MARKS[tab].icon} />
          <span className="micro">
            {TAB_MARKS[tab].num} {t(`tabs.${tab}`, lang)}
          </span>
        </button>
      ))}
    </div>
  );
}
