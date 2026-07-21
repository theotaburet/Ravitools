# Déserts de ravito + export session + roadbook — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Livrer les trois features de la spec `docs/superpowers/specs/2026-07-20-gaps-session-roadbook-design.md` : alertes de segments sans eau/nourriture sur le profil, export/import du plan en `.ravitools.json`, roadbook imprimable.

**Architecture:** Chaque feature est une unité isolée : (1) fonction pure `findGaps` + intégration `ElevationProfile` via un helper d'attribution nearest-trace extrait ; (2) `serializeSession`/`parseSession` extraits de `session.ts` et réutilisés par localStorage, `ExportPanel` (download) et `GpxUpload` (import) ; (3) composant `Roadbook` lazy en portal, imprimé via `@media print`.

**Tech Stack:** React 19 + jotai + vitest 4 + biome, zéro dépendance nouvelle.

## Global Constraints

- `just check` vert (typecheck + tests + lint, zéro warning) avant chaque commit.
- Un commit par feature (3 commits), messages terminés par `Claude-Session: https://claude.ai/code/session_01RVtS7vkzQNrkoaKgVVR6Zv`.
- Toute chaîne visible passe par `t(key, lang)` dans `web/client/src/lib/i18n.ts` (fr + en).
- Aucune nouvelle dépendance npm. Pas de `git push`.
- Gaps lus depuis `poisAtom` (non filtré), jamais `filteredPoisAtom`.
- POI pile au seuil = pas d'alerte (comparaison stricte `>`).

---

### Task 1: `findGaps` (lib pure, TDD)

**Files:**
- Create: `web/client/src/lib/gaps.ts`
- Test: `web/client/src/__tests__/gaps.test.ts`

**Interfaces:**
- Produces: `interface Gap { startM: number; endM: number }` et `findGaps(distancesM: number[], totalDistM: number, thresholdM: number): Gap[]` — consommés par Task 2.

- [ ] **Step 1: Write the failing test**

```ts
// ---------------------------------------------------------------------------
// findGaps – intervalles > seuil sans POI le long d'une trace (bords inclus)
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import { findGaps } from "../lib/gaps";

describe("findGaps", () => {
  it("returns one full-length gap when there is no POI", () => {
    expect(findGaps([], 30000, 25000)).toEqual([{ startM: 0, endM: 30000 }]);
  });

  it("returns no gap when the trace is shorter than the threshold", () => {
    expect(findGaps([], 20000, 25000)).toEqual([]);
  });

  it("does not alert when the interval equals the threshold exactly", () => {
    expect(findGaps([25000], 50000, 25000)).toEqual([]);
  });

  it("detects edge gaps before the first and after the last POI", () => {
    expect(findGaps([30000], 70000, 25000)).toEqual([
      { startM: 0, endM: 30000 },
      { startM: 30000, endM: 70000 },
    ]);
  });

  it("handles unsorted input and threshold changes", () => {
    const d = [40000, 10000];
    expect(findGaps(d, 50000, 25000)).toEqual([{ startM: 10000, endM: 40000 }]);
    expect(findGaps(d, 50000, 8000)).toEqual([
      { startM: 0, endM: 10000 },
      { startM: 10000, endM: 40000 },
      { startM: 40000, endM: 50000 },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd web/client && bunx vitest run src/__tests__/gaps.test.ts`
Expected: FAIL — `Cannot find module '../lib/gaps'`

- [ ] **Step 3: Write the implementation**

```ts
// ---------------------------------------------------------------------------
// Ravito gaps – segments of a trace longer than a threshold without a POI
// ---------------------------------------------------------------------------

export interface Gap {
  startM: number;
  endM: number;
}

/**
 * Intervals of [0, totalDistM] strictly longer than thresholdM with no POI.
 * Edges count: start → first POI and last POI → end are intervals too.
 */
export function findGaps(distancesM: number[], totalDistM: number, thresholdM: number): Gap[] {
  const sorted = [...distancesM].sort((a, b) => a - b);
  const gaps: Gap[] = [];
  let prev = 0;
  for (const d of [...sorted, totalDistM]) {
    if (d - prev > thresholdM) gaps.push({ startM: prev, endM: d });
    prev = Math.max(prev, d);
  }
  return gaps;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd web/client && bunx vitest run src/__tests__/gaps.test.ts`
Expected: PASS (5 tests)

---

### Task 2: Intégration profil (bandes + seuil + résumé) — fin feature 1

**Files:**
- Create: `web/client/src/lib/trace-attribution.ts`
- Modify: `web/client/src/components/ElevationProfile.tsx`
- Modify: `web/client/src/state/ui.ts`
- Modify: `web/client/src/lib/i18n.ts` (table `UI`)
- Modify: `web/client/src/index.css` (append)

**Interfaces:**
- Consumes: `findGaps`/`Gap` (Task 1).
- Produces: `poisForTrace(pois: POI[], traces: TraceData[], trace: TraceData): POI[]` (réutilisé Task 5) ; `gapThresholdKmAtom: atom<number>` dans `state/ui.ts`.

- [ ] **Step 1: Extraire l'attribution nearest-trace**

Créer `web/client/src/lib/trace-attribution.ts` (logique déplacée du memo `tracePois` d'`ElevationProfile.tsx:39-56`) :

```ts
// ---------------------------------------------------------------------------
// Nearest-trace POI attribution — shared by ElevationProfile and Roadbook
// ---------------------------------------------------------------------------

import type { POI, TraceData } from "../types";
import { TraceIndex } from "./gpx-parser";

/** POIs belonging to `trace`: each POI is attributed to its nearest trace. */
export function poisForTrace(pois: POI[], traces: TraceData[], trace: TraceData): POI[] {
  if (traces.length === 1) return pois;
  const indices = traces.map((tr) => new TraceIndex(tr.original));
  const selectedIdx = traces.indexOf(trace);
  return pois.filter((poi) => {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < indices.length; i++) {
      const d = indices[i].distanceTo(poi);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best === selectedIdx;
  });
}
```

- [ ] **Step 2: Atom du seuil (non persisté)**

Dans `web/client/src/state/ui.ts`, ajouter :

```ts
/** Ravito-gap alert threshold in km (not persisted on purpose) */
export const gapThresholdKmAtom = atom(25);
```

- [ ] **Step 3: Clés i18n**

Dans la table `UI` de `web/client/src/lib/i18n.ts`, après `"profile.title"` :

```ts
  "profile.gapThreshold": {
    en: "Ravito gap alert threshold (km)",
    fr: "Seuil d'alerte désert de ravito (km)",
  },
  "profile.without": { en: "without", fr: "sans" },
```

- [ ] **Step 4: Modifier `ElevationProfile.tsx`**

Imports : ajouter `useAtom` à l'import jotai, puis

```ts
import { findGaps } from "../lib/gaps";
import { poisForTrace } from "../lib/trace-attribution";
import { filteredPoisAtom, poisAtom, tracesAtom } from "../state/route";
import { gapThresholdKmAtom, profileHoverAtom, selectedPoiIdAtom, targetLanguageAtom } from "../state/ui";
```

Dans le composant, après `const pois = useAtomValue(filteredPoisAtom);` :

```ts
  const allPois = useAtomValue(poisAtom);
  const [gapThresholdKm, setGapThresholdKm] = useAtom(gapThresholdKmAtom);
```

Remplacer le memo `tracePois` (lignes 39-56) par :

```ts
  // Attribute each POI to its nearest trace so dots land on the right profile
  const tracePois = useMemo(
    () => (trace ? poisForTrace(pois, traces, trace) : []),
    [trace, traces, pois],
  );

  // Ravito gaps — computed from ALL POIs (unfiltered): unchecking a category
  // in the filter must not turn the trace into a fake desert.
  const { waterGaps, foodGaps } = useMemo(() => {
    if (!trace) return { waterGaps: [], foodGaps: [] };
    const mine = poisForTrace(allPois, traces, trace);
    const thresholdM = gapThresholdKm * 1000;
    const water = mine.filter((p) => p.category === "Water").map((p) => p.alongTraceDistance);
    const food = mine
      .filter((p) => p.category === "Food shop" || p.category === "Restaurant or Bar")
      .map((p) => p.alongTraceDistance);
    return {
      waterGaps: findGaps(water, trace.totalDistanceM, thresholdM),
      foodGaps: findGaps(food, trace.totalDistanceM, thresholdM),
    };
  }, [trace, traces, allPois, gapThresholdKm]);
```

Dans le header, juste après le `<span className="elevation-stats">…</span>` :

```tsx
        <span className="gap-controls">
          <label className="gap-threshold">
            &gt;
            <input
              type="number"
              min={1}
              value={gapThresholdKm}
              aria-label={t("profile.gapThreshold", targetLanguage)}
              onChange={(e) => setGapThresholdKm(Math.max(1, Number(e.target.value) || 1))}
            />
            km
          </label>
          {(waterGaps.length > 0 || foodGaps.length > 0) && (
            <span className="gap-summary" role="status">
              ⚠{" "}
              {[
                waterGaps.length > 0 &&
                  `${waterGaps.length} × >${gapThresholdKm} km ${t("profile.without", targetLanguage)} 💧`,
                foodGaps.length > 0 &&
                  `${foodGaps.length} × >${gapThresholdKm} km ${t("profile.without", targetLanguage)} 🛒`,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
          )}
        </span>
```

(Note : la spec montre « 1 × sans 🛒 » sans re-préciser le seuil ; on répète `>X km` dans chaque segment — plus clair, code plus simple.)

Dans le SVG, entre la `<path className="elevation-line">` et le bloc `{hoverX != null && …}` :

```tsx
            {waterGaps.map((g) => (
              <rect
                key={`w${g.startM}`}
                x={x(g.startM)}
                y={0}
                width={Math.min(VIEW_W, x(g.endM)) - x(g.startM)}
                height={VIEW_H}
                className="gap-band-water"
              />
            ))}
            {foodGaps.map((g) => (
              <rect
                key={`f${g.startM}`}
                x={x(g.startM)}
                y={0}
                width={Math.min(VIEW_W, x(g.endM)) - x(g.startM)}
                height={VIEW_H}
                className="gap-band-food"
              />
            ))}
```

- [ ] **Step 5: CSS**

Appendre à `web/client/src/index.css` :

```css
/* --- Ravito gaps (déserts de ravito) --- */
.gap-band-water {
  fill: rgba(37, 99, 235, 0.18);
}
.gap-band-food {
  fill: rgba(234, 88, 12, 0.18);
}
.gap-controls {
  display: inline-flex;
  align-items: center;
  gap: 0.5rem;
  font-size: 0.75rem;
}
.gap-threshold {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
}
.gap-threshold input {
  width: 3.25rem;
  border: 2px solid black;
  padding: 0 0.25rem;
  font: inherit;
  background: white;
}
.gap-summary {
  font-weight: 700;
}
```

- [ ] **Step 6: `just check` vert**

Run: `just check` (racine du repo)
Expected: typecheck + tests + lint PASS, zéro warning. Si biome râle sur le format : `cd web/client && bunx biome check --write src`.

- [ ] **Step 7: Commit feature 1**

```bash
git add web/client/src/lib/gaps.ts web/client/src/lib/trace-attribution.ts web/client/src/__tests__/gaps.test.ts web/client/src/components/ElevationProfile.tsx web/client/src/state/ui.ts web/client/src/lib/i18n.ts web/client/src/index.css
git commit -m "feat: déserts de ravito — alertes >X km sans eau/nourriture sur le profil

Claude-Session: https://claude.ai/code/session_01RVtS7vkzQNrkoaKgVVR6Zv"
```

---

### Task 3: `serializeSession` / `parseSession` (refactor TDD)

**Files:**
- Modify: `web/client/src/lib/session.ts`
- Test: `web/client/src/__tests__/session.test.ts` (append)

**Interfaces:**
- Produces: `serializeSession(snapshot: Omit<SessionSnapshot, "savedAt">): string` et `parseSession(json: string): SessionSnapshot | null` — consommés par Task 4. `saveSession`/`loadSession` gardent leur signature et leur comportement (clearSession sur payload invalide).

- [ ] **Step 1: Write the failing tests**

Dans `session.test.ts`, étendre l'import : `import { clearSession, hasSession, loadSession, parseSession, saveSession, serializeSession } from "../lib/session";` puis appendre :

```ts
describe("plan file serialize/parse", () => {
  function snapshot() {
    return {
      activeCategories: new Set(["Water"] as PoiCategory[]),
      traces: [],
      pois: [makePoi("a")],
      enrichments: new Map<string, EnrichedData>([["a", makeEnrichment()]]),
      targetLanguage: "fr" as const,
      enrichAll: true,
      routeSettings: { maxDistanceM: 900 },
    };
  }

  it("round-trips serialize → parse", () => {
    const parsed = parseSession(serializeSession(snapshot()));
    expect(parsed).not.toBeNull();
    expect(parsed?.pois[0].id).toBe("a");
    expect(parsed?.enrichments.get("a")?.rating).toBe(4.2);
    expect(parsed?.activeCategories.has("Water")).toBe(true);
    expect(parsed?.targetLanguage).toBe("fr");
    expect(parsed?.routeSettings.maxDistanceM).toBe(900);
  });

  it("rejects an unknown schema version", () => {
    const data = JSON.parse(serializeSession(snapshot()));
    data.version = 999;
    expect(parseSession(JSON.stringify(data))).toBeNull();
  });

  it("rejects corrupt JSON", () => {
    expect(parseSession("not-json{{{")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd web/client && bunx vitest run src/__tests__/session.test.ts`
Expected: FAIL — `parseSession`/`serializeSession` not exported

- [ ] **Step 3: Refactor `session.ts`**

Remplacer `saveSession` et `loadSession` (lignes 61-152) par :

```ts
/** Serialize a snapshot to the versioned wire format (localStorage + .ravitools.json). */
export function serializeSession(snapshot: Omit<SessionSnapshot, "savedAt">): string {
  const data: PersistedSession = {
    version: SCHEMA_VERSION,
    savedAt: new Date().toISOString(),
    activeCategories: [...snapshot.activeCategories],
    traces: snapshot.traces,
    pois: snapshot.pois,
    enrichments: [...snapshot.enrichments.entries()],
    targetLanguage: snapshot.targetLanguage,
    enrichAll: snapshot.enrichAll,
    routeSettings: snapshot.routeSettings,
  };
  return JSON.stringify(data);
}

/**
 * Parse + validate the wire format. Returns null on version mismatch or
 * corrupt payload (same per-element validation as before — AUDIT C6).
 */
export function parseSession(json: string): SessionSnapshot | null {
  try {
    const data: PersistedSession = JSON.parse(json);

    // Version gate
    if (data.version !== SCHEMA_VERSION) return null;

    // Basic shape validation
    if (
      !Array.isArray(data.pois) ||
      !Array.isArray(data.enrichments) ||
      !Array.isArray(data.traces)
    ) {
      return null;
    }

    // Per-element validation — a partially-corrupt or older payload can pass the array
    // checks above yet still crash downstream when fields are missing (AUDIT C6).
    const tracesOk = data.traces.every(
      (t) =>
        !!t &&
        Array.isArray((t as { original?: unknown }).original) &&
        Array.isArray((t as { simplified?: unknown }).simplified),
    );
    const poisOk = data.pois.every(
      (p) =>
        !!p &&
        typeof (p as { lat?: unknown }).lat === "number" &&
        typeof (p as { lon?: unknown }).lon === "number" &&
        (p as { category?: unknown }).category != null,
    );
    if (!tracesOk || !poisOk) return null;

    return {
      activeCategories: new Set(data.activeCategories),
      traces: data.traces,
      pois: data.pois,
      enrichments: new Map(data.enrichments),
      targetLanguage: data.targetLanguage ?? "en",
      enrichAll: data.enrichAll ?? false,
      routeSettings: data.routeSettings ?? { maxDistanceM: 1500 },
      savedAt: data.savedAt,
    };
  } catch {
    return null;
  }
}

/**
 * Save current session state to localStorage.
 * Returns false (and warns) if the write fails — e.g. quota exceeded — so callers
 * can tell the user that "resume session" won't work, instead of failing silently
 * (AUDIT §5). A visible toast is deferred until a notification surface exists (M3).
 */
export function saveSession(snapshot: Omit<SessionSnapshot, "savedAt">): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, serializeSession(snapshot));
    return true;
  } catch (err) {
    console.warn(
      "Ravitools: session save failed (localStorage full or unavailable); resume won't work this session.",
      err,
    );
    return false;
  }
}

/**
 * Load a previously saved session from localStorage.
 * Returns null if no session exists, version mismatch, or data is corrupt.
 */
export function loadSession(): SessionSnapshot | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = parseSession(raw);
    if (!parsed) clearSession();
    return parsed;
  } catch {
    clearSession();
    return null;
  }
}
```

`hasSession`/`clearSession` inchangés.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd web/client && bunx vitest run src/__tests__/session.test.ts`
Expected: PASS — les 3 nouveaux + les 10 anciens (le comportement clearSession-sur-invalide est couvert par les tests existants).

---

### Task 4: Boutons export + import dans l'UI — fin feature 2

**Files:**
- Modify: `web/client/src/components/ExportPanel.tsx`
- Modify: `web/client/src/components/GpxUpload.tsx`
- Modify: `web/client/src/lib/i18n.ts`
- Test: `web/client/src/__tests__/GpxUpload.test.tsx` (append)

**Interfaces:**
- Consumes: `serializeSession`/`parseSession` (Task 3), `downloadFile(content, filename, mimeType)` de `lib/export/shared.ts`, `restoreRouteAtom` (`{traces, pois, activeCategories, routeSettings}`), `restoreEnrichmentsAtom` (`Map<string, EnrichedData>`).

- [ ] **Step 1: Clés i18n**

Dans la table `UI` de `i18n.ts`, après `"export.enrichedBody"` :

```ts
  "export.plan": { en: "Plan file", fr: "Fichier de plan" },
  "export.savePlan": { en: "Save plan (.ravitools.json)", fr: "Sauvegarder le plan (.ravitools.json)" },
  "export.planBody": {
    en: "Reload it later or share it — traces, POIs and enrichments included.",
    fr: "Rechargez-le plus tard ou partagez-le — traces, POI et enrichissements inclus.",
  },
  "upload.plan": {
    en: "…or a .ravitools.json plan to reload",
    fr: "…ou un plan .ravitools.json à recharger",
  },
  "upload.badPlan": {
    en: "Invalid or incompatible plan file (.ravitools.json)",
    fr: "Fichier de plan invalide ou incompatible (.ravitools.json)",
  },
```

- [ ] **Step 2: Bouton « Sauvegarder le plan » dans `ExportPanel.tsx`**

Imports à ajouter :

```ts
import { downloadFile } from "../lib/export/shared";
import { serializeSession } from "../lib/session";
import { activeCategoriesAtom, filteredPoisAtom, poisAtom, routeSettingsAtom, stageAtom, tracesAtom } from "../state/route";
import { enrichAllAtom, targetLanguageAtom } from "../state/ui";
```

Dans le composant, après les `useAtomValue` existants :

```ts
  const allPois = useAtomValue(poisAtom);
  const activeCategories = useAtomValue(activeCategoriesAtom);
  const routeSettings = useAtomValue(routeSettingsAtom);
  const stage = useAtomValue(stageAtom);
  const enrichAll = useAtomValue(enrichAllAtom);
```

Après le bloc smartphone (avant le `<p className="text-xs text-muted mt-3 …">` final) :

```tsx
      {/* Plan file — full session as .ravitools.json */}
      <div className="export-divider" />
      <h3>{t("export.plan", targetLanguage)}</h3>
      <p className="text-xs text-muted font-mono mb-3">{t("export.planBody", targetLanguage)}</p>
      <button
        type="button"
        className="neo-btn-secondary w-full"
        disabled={stage !== "done"}
        onClick={() =>
          downloadFile(
            serializeSession({
              activeCategories,
              traces,
              pois: allPois,
              enrichments,
              targetLanguage,
              enrichAll,
              routeSettings,
            }),
            firstName
              ? `${firstName.replace(/\s+/g, "-").toLowerCase()}.ravitools.json`
              : "plan.ravitools.json",
            "application/json",
          )
        }
      >
        {t("export.savePlan", targetLanguage)}
      </button>
```

On exporte `allPois` (superset non filtré) : le plan rechargé doit garder les POI des catégories décochées, comme le localStorage.

- [ ] **Step 3: Import `.json` dans `GpxUpload.tsx`**

Imports à ajouter :

```ts
import { parseSession } from "../lib/session";
import { isProcessingAtom, processFilesAtom, restoreRouteAtom, routeErrorAtom } from "../state/route";
import { restoreEnrichmentsAtom } from "../state/enrichment";
import { enrichAllAtom, targetLanguageAtom } from "../state/ui";
```

Dans le composant :

```ts
  const restoreRoute = useSetAtom(restoreRouteAtom);
  const restoreEnrichments = useSetAtom(restoreEnrichmentsAtom);
  const setTargetLanguage = useSetAtom(targetLanguageAtom);
  const setEnrichAll = useSetAtom(enrichAllAtom);
  const setRouteError = useSetAtom(routeErrorAtom);

  const importPlan = useCallback(
    async (file: File) => {
      const session = parseSession(await file.text());
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
      if (gpxFiles.length > 0) onFiles(gpxFiles);
    },
    [importPlan, onFiles],
  );
```

`handleDrop` et `handleChange` délèguent à `handleFiles` :

```ts
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
      if (files && files.length > 0) handleFiles(Array.from(files));
    },
    [handleFiles],
  );
```

Dans le JSX : `accept=".gpx,.json"` sur l'input (garder `aria-label="Upload GPX files"` — le test existant s'y accroche), et après la ligne `upload.browse` :

```tsx
      <p className="text-xs text-muted font-mono">{t("upload.plan", lang)}</p>
```

- [ ] **Step 4: Tests d'import dans `GpxUpload.test.tsx`**

Imports à ajouter en tête de fichier :

```ts
import { serializeSession } from "../lib/session";
import { routeErrorAtom, stageAtom } from "../state/route";
```

(`stageAtom` est déjà importé — étendre la ligne existante.) Appendre au `describe` :

```tsx
  it("imports a .ravitools.json plan instead of running the pipeline", async () => {
    const store = createStore();
    const { container } = render(
      <Provider store={store}>
        <GpxUpload />
      </Provider>,
    );
    const zone = container.querySelector(".upload-zone") as HTMLElement;
    const plan = new File(
      [
        serializeSession({
          activeCategories: new Set(),
          traces: [
            {
              id: "trace_1",
              original: [
                { lat: 47.0, lon: 0.6 },
                { lat: 47.1, lon: 0.7 },
              ],
              simplified: [{ lat: 47.0, lon: 0.6 }],
              totalDistanceM: 12345,
              elevationGainM: 500,
              elevationLossM: 300,
              name: "Test Route",
              color: "#1a1a1a",
            },
          ],
          pois: [],
          enrichments: new Map(),
          targetLanguage: "en",
          enrichAll: false,
          routeSettings: { maxDistanceM: 1500 },
        }),
      ],
      "plan.ravitools.json",
    );

    fireEvent.drop(zone, { dataTransfer: { files: [plan] } });

    await vi.waitFor(() => expect(store.get(stageAtom)).toBe("done"));
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("shows an error for a corrupt plan file", async () => {
    const store = createStore();
    const { container } = render(
      <Provider store={store}>
        <GpxUpload />
      </Provider>,
    );
    const zone = container.querySelector(".upload-zone") as HTMLElement;

    fireEvent.drop(zone, { dataTransfer: { files: [new File(["nope{{{"], "bad.json")] } });

    await vi.waitFor(() => expect(store.get(routeErrorAtom)).toBeTruthy());
    expect(onFiles).not.toHaveBeenCalled();
  });
```

- [ ] **Step 5: Run tests**

Run: `cd web/client && bunx vitest run src/__tests__/GpxUpload.test.tsx src/__tests__/session.test.ts`
Expected: PASS (anciens + nouveaux)

- [ ] **Step 6: `just check` vert**

Run: `just check`
Expected: PASS, zéro warning.

- [ ] **Step 7: Commit feature 2**

```bash
git add web/client/src/lib/session.ts web/client/src/components/ExportPanel.tsx web/client/src/components/GpxUpload.tsx web/client/src/lib/i18n.ts web/client/src/__tests__/session.test.ts web/client/src/__tests__/GpxUpload.test.tsx
git commit -m "feat: export/import du plan de session (.ravitools.json)

Claude-Session: https://claude.ai/code/session_01RVtS7vkzQNrkoaKgVVR6Zv"
```

---

### Task 5: Roadbook imprimable — fin feature 3

**Files:**
- Create: `web/client/src/components/Roadbook.tsx`
- Modify: `web/client/src/components/ExportPanel.tsx` (bouton + lazy)
- Modify: `web/client/src/lib/i18n.ts`
- Modify: `web/client/src/index.css` (append)
- Test: `web/client/src/__tests__/Roadbook.test.tsx`

**Interfaces:**
- Consumes: `poisForTrace` (Task 2), `buildProfile`/`downsampleProfile` (`lib/elevation`), `splitHoursLines` (`lib/export/hours`), `translateCategory`/`translatePoiName` (`lib/i18n`), `CATEGORY_EMOJI` (`lib/poi-config`).
- Produces: `Roadbook({ onClose }: { onClose: () => void })`, export nommé, chargé en lazy depuis `ExportPanel`.

- [ ] **Step 1: Clés i18n**

Dans la table `UI` de `i18n.ts` :

```ts
  "roadbook.title": { en: "Roadbook", fr: "Roadbook" },
  "roadbook.open": { en: "Open the roadbook", fr: "Ouvrir le roadbook" },
  "roadbook.body": {
    en: "Printable route sheet: profile + POI table per trace.",
    fr: "Feuille de route imprimable : profil + tableau des POI par trace.",
  },
  "roadbook.print": { en: "Print", fr: "Imprimer" },
  "roadbook.close": { en: "Close", fr: "Fermer" },
  "roadbook.km": { en: "km", fr: "km" },
  "roadbook.category": { en: "Category", fr: "Catégorie" },
  "roadbook.name": { en: "Name", fr: "Nom" },
  "roadbook.hours": { en: "Hours", fr: "Horaires" },
```

- [ ] **Step 2: Composant `Roadbook.tsx`**

```tsx
// ---------------------------------------------------------------------------
// Roadbook – printable route sheet: per-trace header, elevation SVG, POI table.
// Fullscreen overlay rendered in a portal; @media print hides the rest of the app.
// ---------------------------------------------------------------------------

import { useAtomValue } from "jotai";
import { createPortal } from "react-dom";
import { buildProfile, downsampleProfile } from "../lib/elevation";
import { splitHoursLines } from "../lib/export/hours";
import { t, translateCategory, translatePoiName } from "../lib/i18n";
import { CATEGORY_EMOJI } from "../lib/poi-config";
import { poisForTrace } from "../lib/trace-attribution";
import { enrichmentsAtom } from "../state/enrichment";
import { filteredPoisAtom, tracesAtom } from "../state/route";
import { targetLanguageAtom } from "../state/ui";
import type { TraceData } from "../types";

const VIEW_W = 1000;
const VIEW_H = 120;
const PAD_Y = 10;

function profilePath(trace: TraceData): string | null {
  const profile = downsampleProfile(buildProfile(trace.original) ?? []);
  if (profile.length === 0) return null;
  let minEle = Infinity;
  let maxEle = -Infinity;
  for (const p of profile) {
    if (p.ele < minEle) minEle = p.ele;
    if (p.ele > maxEle) maxEle = p.ele;
  }
  const total = profile[profile.length - 1].dist;
  return profile
    .map(
      (p, i) =>
        `${i === 0 ? "M" : "L"}${((p.dist / total) * VIEW_W).toFixed(1)},${(
          VIEW_H - PAD_Y - ((p.ele - minEle) / (maxEle - minEle)) * (VIEW_H - 2 * PAD_Y)
        ).toFixed(1)}`,
    )
    .join(" ");
}

export function Roadbook({ onClose }: { onClose: () => void }) {
  const traces = useAtomValue(tracesAtom);
  const pois = useAtomValue(filteredPoisAtom);
  const enrichments = useAtomValue(enrichmentsAtom);
  const lang = useAtomValue(targetLanguageAtom);

  return createPortal(
    <div className="roadbook-overlay">
      <div className="roadbook-toolbar">
        <h2>{t("roadbook.title", lang)}</h2>
        <button type="button" className="neo-btn-lime" onClick={() => window.print()}>
          {t("roadbook.print", lang)}
        </button>
        <button type="button" className="neo-btn-secondary" onClick={onClose}>
          {t("roadbook.close", lang)}
        </button>
      </div>
      {traces.map((trace) => {
        const path = profilePath(trace);
        const tracePois = poisForTrace(pois, traces, trace).toSorted(
          (a, b) => a.alongTraceDistance - b.alongTraceDistance,
        );
        return (
          <section key={trace.id} className="roadbook-trace">
            <h3>
              {trace.name ?? trace.id} · {(trace.totalDistanceM / 1000).toFixed(1)} km · ↑
              {trace.elevationGainM}m ↓{trace.elevationLossM}m
            </h3>
            {path && (
              <svg
                className="roadbook-profile"
                viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
                preserveAspectRatio="none"
                role="img"
                aria-label={t("profile.title", lang)}
              >
                <path d={path} fill="none" stroke="black" vectorEffect="non-scaling-stroke" />
              </svg>
            )}
            <table className="roadbook-table">
              <thead>
                <tr>
                  <th>{t("roadbook.km", lang)}</th>
                  <th>{t("roadbook.category", lang)}</th>
                  <th>{t("roadbook.name", lang)}</th>
                  <th>{t("roadbook.hours", lang)}</th>
                </tr>
              </thead>
              <tbody>
                {tracePois.map((poi) => {
                  const rawHours = enrichments.get(poi.id)?.hours ?? poi.tags.opening_hours ?? "";
                  return (
                    <tr key={poi.id}>
                      <td>{(poi.alongTraceDistance / 1000).toFixed(1)}</td>
                      <td>
                        {CATEGORY_EMOJI[poi.category] ?? "📍"} {translateCategory(poi.category, lang)}
                      </td>
                      <td>{poi.name ? translatePoiName(poi.name, lang) : "—"}</td>
                      <td>{splitHoursLines(rawHours).join(" · ")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </section>
        );
      })}
    </div>,
    document.body,
  );
}
```

- [ ] **Step 3: Bouton dans `ExportPanel.tsx`**

En tête de fichier :

```ts
import { lazy, Suspense, useState } from "react";

const Roadbook = lazy(() => import("./Roadbook").then((m) => ({ default: m.Roadbook })));
```

Dans le composant : `const [roadbookOpen, setRoadbookOpen] = useState(false);` puis, après le bouton « Sauvegarder le plan » (Task 4) :

```tsx
      {/* Roadbook */}
      <div className="export-divider" />
      <h3>{t("roadbook.title", targetLanguage)}</h3>
      <p className="text-xs text-muted font-mono mb-3">{t("roadbook.body", targetLanguage)}</p>
      <button
        type="button"
        className="neo-btn-secondary w-full"
        disabled={stage !== "done"}
        onClick={() => setRoadbookOpen(true)}
      >
        {t("roadbook.open", targetLanguage)}
      </button>
      {roadbookOpen && (
        <Suspense fallback={null}>
          <Roadbook onClose={() => setRoadbookOpen(false)} />
        </Suspense>
      )}
```

- [ ] **Step 4: CSS**

Appendre à `web/client/src/index.css` :

```css
/* --- Roadbook --- */
.roadbook-overlay {
  position: fixed;
  inset: 0;
  z-index: 2000;
  background: white;
  color: black;
  overflow-y: auto;
  padding: 1.5rem;
}
.roadbook-toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  margin-bottom: 1rem;
}
.roadbook-toolbar h2 {
  flex: 1;
  font-weight: 900;
  text-transform: uppercase;
}
.roadbook-trace {
  margin-bottom: 2rem;
}
.roadbook-trace h3 {
  font-weight: 700;
  margin-bottom: 0.5rem;
}
.roadbook-profile {
  width: 100%;
  height: 90px;
  border: 1px solid black;
  margin-bottom: 0.5rem;
}
.roadbook-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.8rem;
}
.roadbook-table th,
.roadbook-table td {
  border: 1px solid black;
  padding: 0.25rem 0.5rem;
  text-align: left;
}

@media print {
  body:has(.roadbook-overlay) > *:not(.roadbook-overlay) {
    display: none !important;
  }
  .roadbook-overlay {
    position: static;
    overflow: visible;
    padding: 0;
  }
  .roadbook-toolbar {
    display: none;
  }
  .roadbook-trace {
    break-after: page;
  }
}
```

- [ ] **Step 5: Smoke test `Roadbook.test.tsx`**

```tsx
// ---------------------------------------------------------------------------
// Roadbook smoke test — renders one section per trace with the POI table.
// The paper output is checked by eye (spec).
// ---------------------------------------------------------------------------

import { cleanup, render, screen } from "@testing-library/react";
import { createStore, Provider } from "jotai";
import { afterEach, describe, expect, it } from "vitest";
import { Roadbook } from "../components/Roadbook";
import { activeCategoriesAtom, poisAtom, tracesAtom } from "../state/route";
import type { POI, PoiCategory, TraceData } from "../types";

afterEach(cleanup);

const trace: TraceData = {
  id: "trace_1",
  original: [
    { lat: 45.0, lon: 5, ele: 100 },
    { lat: 45.01, lon: 5, ele: 200 },
  ],
  simplified: [{ lat: 45.0, lon: 5 }],
  totalDistanceM: 1112,
  elevationGainM: 100,
  elevationLossM: 0,
  name: "Col du Test",
  color: "#1a1a1a",
};

const poi: POI = {
  id: "a",
  lat: 45.005,
  lon: 5,
  category: "Water",
  name: "Fontaine du col",
  icon: "faucet-drip",
  distanceToTrace: 10,
  alongTraceDistance: 500,
  tags: { opening_hours: "Mo-Su 08:00-19:00" },
  style: {
    iconShape: "circle",
    borderColor: "#FFFFFF",
    borderWidth: "2",
    textColor: "#FFFFFF",
    backgroundColor: "#3B82F6",
  },
};

describe("Roadbook", () => {
  it("renders the trace header, profile and POI table", () => {
    const store = createStore();
    store.set(tracesAtom, [trace]);
    store.set(poisAtom, [poi]);
    store.set(activeCategoriesAtom, new Set(["Water"] as PoiCategory[]));

    render(
      <Provider store={store}>
        <Roadbook onClose={() => {}} />
      </Provider>,
    );

    expect(screen.getByText(/Col du Test/)).toBeTruthy();
    expect(screen.getByText("Fontaine du col")).toBeTruthy();
    expect(screen.getByText(/08:00-19:00/)).toBeTruthy();
    expect(screen.getByText("0.5")).toBeTruthy();
  });
});
```

- [ ] **Step 6: Run test**

Run: `cd web/client && bunx vitest run src/__tests__/Roadbook.test.tsx`
Expected: PASS

- [ ] **Step 7: `just check` vert + vérif visuelle**

Run: `just check` → PASS zéro warning. Vérif à l'œil (dev server) : ouverture du roadbook, aperçu d'impression sobre N&B — le rendu papier se vérifie visuellement (spec).

- [ ] **Step 8: Commit feature 3**

```bash
git add web/client/src/components/Roadbook.tsx web/client/src/components/ExportPanel.tsx web/client/src/lib/i18n.ts web/client/src/index.css web/client/src/__tests__/Roadbook.test.tsx
git commit -m "feat: roadbook imprimable — profil + tableau des POI par trace

Claude-Session: https://claude.ai/code/session_01RVtS7vkzQNrkoaKgVVR6Zv"
```
