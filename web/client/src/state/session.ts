// --- Session: the snapshot that is auto-saved, exported, resumed, imported and reset ---

import { atom } from "jotai";
import { clearSession, type SessionSnapshot } from "../lib/session";
import { resetEnrichmentAtom, restoreEnrichmentsAtom } from "./enrichment";
import {
  activeCategoriesAtom,
  enrichmentsAtom,
  poisAtom,
  resetRouteAtom,
  restoreRouteAtom,
  routeSettingsAtom,
  stageAtom,
  tracesAtom,
} from "./route";
import { enrichAllAtom, selectedPoiIdAtom, showTabAtom } from "./ui";

/** What a session holds (every POI, not just the shown ones); null until the pipeline is done */
export const sessionSnapshotAtom = atom((get): Omit<SessionSnapshot, "savedAt"> | null =>
  get(stageAtom) === "done"
    ? {
        activeCategories: get(activeCategoriesAtom),
        traces: get(tracesAtom),
        pois: get(poisAtom),
        enrichments: get(enrichmentsAtom),
        enrichAll: get(enrichAllAtom),
        routeSettings: get(routeSettingsAtom),
      }
    : null,
);

/** Bring a saved or imported session back */
export const restoreSessionAtom = atom(null, (_get, set, session: SessionSnapshot) => {
  set(restoreRouteAtom, {
    traces: session.traces,
    pois: session.pois,
    activeCategories: session.activeCategories,
    routeSettings: session.routeSettings,
  });
  set(restoreEnrichmentsAtom, session.enrichments);
  set(enrichAllAtom, session.enrichAll);
});

/** Start over: route, enrichment, selection and the saved session */
export const resetAllAtom = atom(null, (_get, set) => {
  set(resetRouteAtom);
  void set(resetEnrichmentAtom);
  set(selectedPoiIdAtom, null);
  set(showTabAtom, "trace");
  clearSession();
});
