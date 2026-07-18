// ---------------------------------------------------------------------------
// Step – one numbered section of the sidebar "carnet de route".
// The prep flow is a real sequence (load → refine → enrich → export), so the
// numbers encode progress. "todo" steps render header-only, dimmed.
// ---------------------------------------------------------------------------

import type { ReactNode } from "react";

export type StepState = "active" | "open" | "done" | "todo";

export function Step({
  num,
  title,
  state,
  doneLabel,
  children,
}: {
  num: number;
  title: string;
  state: StepState;
  doneLabel?: string;
  children?: ReactNode;
}) {
  return (
    <section
      className={`step step--${state}`}
      aria-current={state === "active" ? "step" : undefined}
    >
      <div className="step-header">
        <span className="step-num" aria-hidden="true">
          {state === "done" ? "✓" : String(num).padStart(2, "0")}
        </span>
        <h2 className="step-title">{title}</h2>
        {state === "done" && doneLabel && <span className="step-check">{doneLabel}</span>}
      </div>
      {state !== "todo" && children != null && <div className="step-body">{children}</div>}
    </section>
  );
}
