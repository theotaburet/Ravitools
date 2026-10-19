# Design system: "Field instrument"

Status: direction approved 2026-10-17, implemented on branch `designV2`. It replaces the neobrutalist "carnet de route".

This file is both the spec of the redesign and the living reference. When code and this file disagree, one of them is wrong: fix it in the same change.

## 1. Intent

Ravitools is used to **prepare** a ride and to **check it while riding**, mostly on a mid-range Android phone, sometimes in full sun, on a handlebar mount.

Success means:

- everything works one-handed on a phone, with the thumb;
- the key numbers read at arm's length in under a second;
- no step waits on a click the app could make itself;
- color is never the only signal;
- desktop keeps the same model, just anchored differently.

References:

- **Structure**: [replayapp.dev](https://replayapp.dev). Full-bleed map, a bottom sheet with detents, floating pill tabs, floating round controls.
- **Surface**: a technical archive poster. Grained off-white paper, condensed grotesque numerals, small mono uppercase labels, hairlines, outline pill badges, sky-blue cyan.
- **Tactile touches**: pressed buttons, switches, and a bike-computer screen for the key numbers.

## 2. UX principles

1. **Essential first, detail one tap away.** Breakdowns and long notes go behind `<details>` or into the POI detail. Warnings that need action stay visible.
2. **The app recovers by itself.** Transient failures (Overpass chunk, search, geocode) retry automatically with backoff. Partial results show immediately and fill in as retries land. A button appears only when the user has a real choice to make. Today, Overpass stops on a "retry chunks" button after 3 rounds: see E5.
3. **One source of truth per selection.** The selected trace, selected POI, active tab, sheet detent and palette are atoms in `state/ui.ts`, read everywhere and never mirrored in local state.
4. **Color is never alone.** Every pastille has a glyph, the list and the POI detail show names, and states carry a label or an icon.
5. **Thumb zone.** On mobile, frequent actions (tabs, prev/next, primary buttons) sit in the bottom half.
6. **Readable at arm's length.** Key numbers are at least 32 px condensed. Mobile body text is at least 16 px. Touch targets are at least 44 × 44 px.
7. **Map first.** Nothing covers the map that the user did not ask for: no header bar, no legend overlay, no popups.

## 3. Tokens

UI colors are CSS custom properties in `web/client/src/index.css`, with dark overrides under `[data-theme="dark"]` and colour-blind overrides under `[data-palette="cvd"]`.

Family colors are the one exception. They live in `lib/poi-config.ts`, because exports need them too. They reach the DOM as an inline custom property on the element (`style="--fam: …"`) and are never typed in CSS.

Every contrast ratio below was measured (WCAG 2 formula). The E3 test re-checks them.

### 3.1 Surfaces and ink

| Token                  | Light     | Dark      | Role                                             |
| ---------------------- | --------- | --------- | ------------------------------------------------ |
| `--color-paper`        | `#F3F0E8` | `#131518` | Sheet, panel, app background                     |
| `--color-paper-raised` | `#FBF9F4` | `#1C1F23` | Cards, POI detail, pressed list rows              |
| `--color-paper-sunk`   | `#E8E4DA` | `#0E1013` | Inputs, wells, segmented-control tracks          |
| `--color-ink`          | `#16181C` | `#ECE9E1` | Text and icons (15.6:1 / 15.1:1 on paper)        |
| `--color-ink-muted`    | `#5B5F66` | `#9A9EA6` | Secondary text, micro labels (5.6:1 / 6.8:1)     |
| `--color-hairline`     | ink 14 %  | ink 14 %  | 1 px rules and outlines (`color-mix` of ink)     |
| `--color-screen`       | `#0E1114` | `#0E1114` | Counter screen (same in both themes)             |
| `--color-screen-ink`   | `#FFFFFF` | `#FFFFFF` | Counter numerals (18.9:1; cyan lost in the sun, E2) |
| `--color-screen-label` | `#7D8590` | `#7D8590` | Counter labels (5.1:1)                           |

### 3.2 Accent

| Token                 | Light     | Dark      | Role                                                                     |
| --------------------- | --------- | --------- | ------------------------------------------------------------------------ |
| `--color-accent`      | `#2CB5FC` | `#2CB5FC` | **Fills only**: primary button, active tab, traces, selection ring, progress |
| `--color-accent-ink`  | `#16181C` | `#16181C` | Label on an accent fill (7.7:1)                                          |
| `--color-accent-text` | `#0A6FA8` | `#5CC8FF` | Links and accent text on paper (4.8:1 / 9.7:1)                           |

The accent is never used as text on light paper, where it only reaches 2.0:1.

### 3.3 States

Each state has a fill (bars, dots, icons) and a text color (at least 4.5:1 on `paper` and `paper-raised`). The soft background of a notice is `color-mix(in oklab, var(--color-<state>) 12%, var(--color-paper))`.

| State   | Default fill / text (light) | Default (dark) | Colour-blind fill | Colour-blind text (light / dark) |
| ------- | --------------------------- | -------------- | ----------------- | -------------------------------- |
| success | `#1A7335`                   | `#4ADE80`      | `#0072B2`         | `#0072B2` / `#398FBD`            |
| warning | `#995400`                   | `#FBBF24`      | `#E69F00`         | `#8F660C` / `#E69F00`            |
| danger  | `#C62828`                   | `#F87171`      | `#D55E00`         | `#B35105` / `#D6650B`            |

Colour-blind text is the fill mixed toward ink (light) or paper-ink (dark) until it reaches 4.5:1 on both papers (E3).

The three-zone enrichment bar (done / skipped / remaining) uses success fill, warning fill and hairline.

### 3.4 POI families

The 18 categories are grouped into 7 families (new `family` field in `poi-config.ts`). On the map, the color says the family and the glyph says the category. Sky blue never denotes a family: it belongs to the accent and the traces.

| Family     | Categories                            |
| ---------- | ------------------------------------- |
| Water      | Water, Restroom                       |
| Food       | Food shop, Restaurant or Bar, Picnic  |
| Sleep      | Sleeping place, Shelter               |
| Mechanics  | Gears, DIY, Charging                  |
| Health     | Medical, Pharmacy                     |
| Services   | Bank & ATM, Post office, Laundry, Wifi |
| Discovery  | Viewpoint, Tourist info               |

Two palettes, both in `poi-config.ts`. The glyph is white or ink, whichever contrasts more (always at least 3:1):

| Family    | Default   | Glyph | Ratio | Colour-blind (Okabe-Ito) | Glyph | Ratio |
| --------- | --------- | ----- | ----- | ------------------------ | ----- | ----- |
| Water     | `#1F5FBF` | white | 6.1   | `#0072B2`                | white | 5.2   |
| Food      | `#E8711A` | ink   | 5.8   | `#E69F00`                | ink   | 7.9   |
| Sleep     | `#6E44C2` | white | 6.4   | `#CC79A7`                | ink   | 5.8   |
| Mechanics | `#4B5563` | white | 7.6   | `#3D434B`                | white | 10.0  |
| Health    | `#D32F2F` | white | 5.0   | `#D55E00`                | ink   | 4.6   |
| Services  | `#2E7D32` | white | 5.1   | `#009E73`                | ink   | 5.2   |
| Discovery | `#C9A227` | ink   | 7.4   | `#F0E442`                | ink   | 13.4  |

The default palette keeps the intuitive hues (red for health, green for services). Those two are exactly the pair a deuteranope confuses, which is why the colour-blind palette exists.

### 3.5 Typography

- **Archivo Variable** (wdth 62 to 125, wght 100 to 900), imported through `@fontsource-variable/archivo/wdth.css`. This replaces the weight-only import.
- **Mono**: `ui-monospace, "SF Mono", "Roboto Mono", Menlo, monospace`, the system font, so nothing to download.

| Role    | Font                       | Size / line  | Use                                                    |
| ------- | -------------------------- | ------------ | ------------------------------------------------------ |
| display | Archivo wdth 62, wght 800  | 40 / 1 (E2)  | Counter values, empty-state title, `RAVITOOLS` wordmark |
| title   | Archivo wdth 75, wght 700  | 20 / 1.2     | Tab and section titles, POI name in the POI detail       |
| body    | Archivo wdth 100, wght 400 | 16 / 1.45    | Everything else (600 for emphasis)                     |
| small   | Archivo wdth 100, wght 400 | 14 / 1.4     | Secondary lines                                        |
| micro   | mono, 12 px, uppercase, letter-spacing 0.08em, `ink-muted` | 12 / 1.2 | Km markers, coordinates, counts, tab numbers, badges |

All numbers use `font-variant-numeric: tabular-nums`. Text is in sentence case everywhere except micro labels and the wordmark.

### 3.6 Space, radius, elevation

- **Space** (4 px scale): `--space-1` 4, `-2` 8, `-3` 12, `-4` 16, `-6` 24, `-8` 32. Gutters are 16 px on mobile and 24 px on desktop.
- **Radius**: `--radius-sheet` 28 (top corners of the mobile sheet), `--radius-panel` 24, `--radius-card` 16, `--radius-control` 12, `--radius-pill` 999.
- **Elevation**:
  - `--elev-float`: `0 1px 2px rgb(16 18 22 / 0.08), 0 8px 24px rgb(16 18 22 / 0.14)`, with alpha around 0.4 in dark. For the sheet, panel, pill tabs, round buttons and pastilles.
  - `--elev-raised`: `inset 0 1px 0 rgb(255 255 255 / 0.6), 0 1px 2px rgb(16 18 22 / 0.12)`. For buttons and chips at rest, so they look pressable.
  - `--elev-pressed`: `inset 0 2px 4px rgb(16 18 22 / 0.2)`, plus `translateY(1px)`. For the pressed state and "on" toggles.
  - Cards sitting on paper get no shadow, only a hairline.

### 3.7 Materials

- **Paper**: `--color-paper` plus a static grain, an inline SVG `feTurbulence` data URI at about 4 % opacity (6 % in dark). Only on large surfaces (sheet, panel). Cards stay plain `paper-raised`.
- **Glass**: only on the round floating buttons. `background: color-mix(in oklab, var(--color-paper) 70%, transparent); backdrop-filter: blur(12px) saturate(1.4);` with an opaque paper fallback under `@supports not (backdrop-filter: blur(1px))`. Never on large surfaces: it costs too much on Android and loses contrast in the sun (E1).
- **Screen** (counter): `--color-screen` with `inset 0 2px 6px rgb(0 0 0 / 0.6)` and a 1 px highlight underneath, so it reads as set into the paper. Values in display font with `screen-ink`, labels in micro with `screen-label`. Identical in both themes.
- **Pixel**: progress bars fill in 6 px square steps (a CSS mask), echoing the poster's pixel route. Only on progress bars.
- **Registration marks** (`+`, decorative coordinates, `01 02 03 04` ruler): only on the empty first-launch state.

### 3.8 Icons

- `lucide` (ISC) is the only new dependency. Stroke width 2, 20 px in the UI, 16 px glyph inside a 28 px pastille.
- One small helper turns a lucide icon node into either a React element (UI) or an SVG string (Leaflet `divIcon`).
- Each category has a `glyph` (a lucide icon, imported so unused ones are tree-shaken) in `poi-config.ts`; a few tags override it through their icon name (`ICON_GLYPHS`, like `ICON_EMOJI`), and `poiGlyph(poi)` resolves both. Within a family, glyphs differ.
- Emojis remain only where exports use them (OsmAnd descriptions).

### 3.9 Motion

- The sheet snaps between detents by animating `transform` (240 ms, `cubic-bezier(0.2, 0.8, 0.2, 1)`). While dragging, it follows the finger 1:1 through pointer events, with no timer.
- Presses take 80 ms. Tab content swaps without animation.
- Under `prefers-reduced-motion`, there are no transitions.

## 4. Primitives

These replace every `neo-*` class. Step 3 brought what the shell uses (`.micro`, `.btn`, `.fab`, `.segmented`, `.switch`); each other primitive comes with the step that first uses it.

| Class                 | What                                    | Notes                                                                   |
| --------------------- | --------------------------------------- | ----------------------------------------------------------------------- |
| `.btn`                | Base button                             | `paper-raised`, `elev-raised`, radius-control, 44 px min height. Pressed: `elev-pressed` |
| `.btn-primary`        | Main action                             | Accent fill, `accent-ink` label                                         |
| `.btn-quiet`          | Secondary action                        | No fill, hairline, no shadow                                            |
| `.btn-sm`             | Compact variant                         | Still 44 px tall on `pointer: coarse`                                   |
| `.fab`                | Round floating map button               | 44 px, glass, `elev-float`, lucide icon, `aria-label`                   |
| `.chip`               | Pill toggle (filters)                   | Off: `paper-sunk` and hairline. On: `paper-raised`, `elev-raised`, filled family dot. A checkbox label, or a button with `aria-pressed` (family toggle; `mixed` adds a dashed ring) |
| `.switch`             | Tactile switch                          | Native `<input type="checkbox" role="switch">`, styled                  |
| `.segmented`          | Exclusive choice (FR/EN, light/dark)    | `paper-sunk` track, raised thumb                                        |
| `.badge`              | Outline pill with micro text            | Trust (AI / AI repaired / deterministic), confidence, state             |
| `.card`               | Grouping                                | `paper-raised`, hairline, radius-card                                   |
| `.pastille`           | Family circle with glyph                | 2 px paper ring, `elev-float`. 20 px (list), 28 px (map), 36 px (selected, POI detail) |
| `.micro`              | Mono label                              | See 3.5                                                                 |
| `.counter`            | Screen with 2 to 4 cells                | Value plus micro label per cell                                         |
| `.progress`           | Pixel bar                               | `.progress-segmented` for done / skipped / remaining                    |
| `.field`              | Input, select                           | `paper-sunk`, radius-control, 44 px min height, 16 px text (no iOS zoom) |
| `.dock`               | Main action docked above the tabs       | `position: sticky`, `elev-float` and a paper margin; the content scrolls under it (E7's friction check looks above it, E6 wants every tab's primary button in sight) |
| `.notice`             | State message                           | Soft background, icon in the state color, ink text (the state text colors fall to 3.97 to 4.43 on the soft background in light), optional action |

## 5. Layout shell

UI state lives in atoms in `state/ui.ts`: `sheetDetentAtom` (`"low" | "mid" | "full"`, replaces `sheetOpenAtom`), `activeTabAtom`, `selectedTraceIdAtom`, `selectedPoiIdAtom` and `paletteAtom` (persisted).

### 5.1 Mobile (< 768 px)

```
 low                     mid                      full
┌──────────────────┐    ┌──────────────────┐     ┌──────────────────┐
│(⚙)          (⤢) │    │(⚙)          (⤢) │     │ map strip (64px) │
│                  │    │       map        │     ├──────────────────┤
│       map        │    ├──────────────────┤     │ ▔▔ handle        │
│                  │    │ ▔▔ handle        │     │ profile + counter│
│                  │    │ profile + counter│     │ tab content      │
├──────────────────┤    │ tab content      │     │ (scrolls)        │
│ ▔▔ handle        │    │                  │     │                  │
│ profile + counter│    │                  │     │                  │
│ ( 01  02  03  04)│    │ ( 01  02  03  04)│     │ ( 01  02  03  04)│
└──────────────────┘    └──────────────────┘     └──────────────────┘
```

- **Map**: full bleed, `100dvh`, `viewport-fit=cover`. Round buttons, sheet and pill tabs respect `env(safe-area-inset-*)`.
- **Round buttons**: settings at the top left, "fit to route" at the top right. No zoom buttons on `pointer: coarse` (you pinch). The map attribution sits in micro text under the top-right button.
- **Sheet**: paper with grain, 28 px top corners, `elev-float`.
  - Detents: **low** (handle, header strip, pill tabs, about 196 px plus the bottom safe area), **mid** (52 dvh), **full** (100 dvh minus a 64 px map strip; tapping the strip goes back to mid).
  - The handle can be dragged, or tapped to move low → mid → full → low.
  - At full, the round buttons hide.
- **Header strip** (`HeaderStrip.tsx`, 72 px): the counter (`KM`, `D+`, `POI`; KM without its tenth past 100 km) and the compact elevation profile, both for the selected trace (`selectedTraceIdAtom`, else the first). It is the top of the sheet, so it stays visible at every detent. The profile always shows the whole trace: a slope-coloured silhouette, two thin rails under it for the stretches without water (bottom) and without food (in the family colours; tab 01 says it in words), and the part outside the map's view dimmed. A transparent native slider covers it: a tap, a drag or the arrow keys centre the map on that kilometre, zoom kept (`mapCenterAtom`). A hover on desktop moves a marker on the map, and a hover on a map trace moves the profile's cursor. POI dots, slope legend, flags, off-screen labels, tooltip and the trace chips are gone (the user's choice, "Minimal"); the alert threshold lives in tab 01.
- **Pill tabs**: floating over the bottom of the sheet in opaque `paper-raised` with `elev-float` (no blur). The content gets bottom padding equal to the pill height. Each tab shows a lucide icon and a micro label: `01 TRACE`, `02 POI`, `03 ENRICH` (absent from the static build), `04 EXPORT`. Tab widths follow their labels, so `03 ENRICHIR` fits down to 360 px.
- **Rules**:
  - tapping a tab while at low opens mid;
  - tapping the active tab collapses to low;
  - when processing finishes with POIs and no failed chunk, switch to 02 at mid; with 0 POI, failed chunks or an error, show 01 at mid, where the message and the retry are;
  - `03` and `04` are disabled (`lockedTabsAtom`) while the pipeline runs and whenever no POI passes the filters;
  - tapping a marker selects the POI and opens 02, POI detail, at mid;
  - tapping the profile leaves the detent unchanged.
- **Viewport-aware camera**: `fitBounds` and `flyTo` pad by the height of the sheet at its current detent, so the target is never hidden behind it.

### 5.2 Desktop and tablet (≥ 768 px)

- Full-bleed map.
- **Panel** floating on the left: 16 px inset, width `clamp(340px, 34vw, 420px)`, radius-panel, paper with grain, `elev-float`.
  - Header: the `RAVITOOLS` wordmark (display) and the settings button.
  - Body: the tab content. Footer: the pill tabs.
  - Collapsed state: only the pill tabs remain.
- **Header strip**: the same component as on mobile, floating at the bottom of the map, from the panel's edge + 16 px to the right edge − 16 px. Counter on the left, profile on the right.
- **Round buttons**: "fit to route" at the top right, zoom at the bottom right, beside the strip (the strip stops short of it).
- Hovering a marker shows its name in a tooltip.

### 5.3 Settings

The settings button opens a native popover (`popover` attribute, no JS state) with:

- language (`.segmented` FR/EN);
- theme (`.segmented` light/dark);
- colour-blind palette (`.switch`);
- Debug, which opens the debug view in the sheet or panel.

## 6. Map

- **Tiles**: OpenStreetMap standard (light) and the same tiles under the CSS invert filter (dark), attribution "© OpenStreetMap contributors (ODbL)". The planned CARTO Voyager and Dark Matter need an API key since 25 September 2026 (keyless requests get an "API KEY REQUIRED" tile); E4 then measured the keyless sources and kept OSM (see Results).
- **Traces**: all in accent cyan over a paper casing (two polylines: an 8 px paper casing under a 4 px line).
  - The selected trace is 6 px on an 11 px casing, drawn on top. The others are at 50 % opacity.
  - Tapping a trace selects it (`selectedTraceIdAtom`); tapping it again clears the selection. A 20 px invisible line takes the tap and, on desktop, the hover that moves the profile cursor.
  - Start and finish are small ink pastilles with lucide glyphs (`Play`, `Flag`). The direction arrows stay.
  - Decorative markers (start, finish, arrows) are out of the tab order (`keyboard={false}`).
- **POI markers**: 28 px pastilles inside a 44 px target. The selected one is 36 px with a 3 px accent ring, drawn on top. A dashed accent ring marks a POI being enriched. Dense cells keep their count bubbles (paper, ink ring, mono count), also on a 44 px target.
- **No popup**: a tap on a pastille selects the POI, flies to it and opens the POI tab on its row.
- **Deleted**: Leaflet popups (and the "open popup after `flyTo`" delay), the trace legend overlay, emoji markers.

## 7. Tab content

### 01 Trace

- **Empty (first launch)**: the sheet at mid shows a drop-zone card ("Load a GPX", multiple files allowed), the resume-session notice when there is a saved session, and the poster marks (`+`, the map centre coordinates in micro text, the `01 02 03 04` ruler). The map is zoomed out to the whole world.
- **Loaded**:
  - One card per trace, acting as legend and selector: name, micro `248 KM · 3120 M D+ · 64 POI`, accent bar on the selected one.
  - "Add a GPX".
  - The pipeline status: pixel progress bar and notices.

### 02 POI

- **Filters**: the family toggles first, always in sight: one `.chip` per family (pastille, name, count; a family partly on is raised on a dashed ring, `aria-pressed="mixed"`), then All/None (None while anything is on, so "only water" is two taps). The distance slider (keeping its approved 150 ms commit) and one row of category chips per family sit behind a `<details>` whose summary reads `DISTANCE 1500 M · CATEGORIES 9/18`. A first version showed every family with its chips: at mid the list started 1 400 px down, under the slider alone.
- **List**: virtualized, one compact row per POI: 20 px pastille, name, micro `KM 142 · +240 M`, trailing chevron. Enrichment shows only as a small badge (a spinner while searching). Rows are in route order, the order ◀ ▶ walk (the old sort by distance, category or name is gone), and scroll with the tab panel (no nested scroller).
- **POI detail** (`PoiDetail.tsx`, open while `selectedPoiIdAtom` is set): it replaces the list and its filters, which stay mounted underneath, and is the only place the detail appears. A top bar holds the back button, the position (`12 / 64`) and **◀ ▶**, so they are in sight at mid. Then:
  1. pastille, name, category;
  2. micro `KM 142.3 · 240 M FROM ROUTE`;
  3. useful state: the availability tags (open on Sunday, in the evening) plus OSM facts (drinking water, etc.). "Open, closes at 19:00" needs an `opening_hours` evaluator: not done;
  4. trust badge (AI / AI repaired / deterministic) and the enriched description;
  5. behind `<details>`: full hours (OSM ones when the enrichment brought none), sources, divergences, cautions, confidence;
  6. the Google Maps link.

  **◀ ▶** move to the previous or next POI **in the current filtered list, in route order**. Filtering to Water makes ◀ ▶ walk the water points.

### 03 Enrich and 04 Export

Same features, rebuilt from the primitives. The roadbook and print styles move to the new tokens.

- **03 Enrich**: the local-model check is a card with a state dot, the switches are `.switch`, warnings and errors `.notice`, progress the pixel `.progress`, the done / skipped / remaining tally a `.progress-segmented` (success, warning, hairline). The action of the moment (enrich, continue, resume, retry) is docked above the tabs.
- **04 Export**: the formats are radio cards (FIT first, the only one with typed alerts; then GPX, GPX OsmAnd, KMZ, KML, GeoJSON) and one "Download FIT" button, docked above the tabs (`.dock`): at mid the six cards run past the fold, and the button below them was out of sight. The plan file and the roadbook are quiet buttons; what each one is goes in "Which format?". KML, KMZ and OsmAnd GPX write the family fill of the current palette; the per-category colours they used to write (different from the map) are gone.

## 8. Colour-blind mode

- A switch in the settings, persisted (`atomWithStorage("ravitools.palette")`), off by default. It sets `data-palette="cvd"` on `<html>`.
- It changes:
  - the family palette everywhere (map, list, POI detail, filters);
  - the state colors and the enrichment bar;
  - the **exports** (KML, OsmAnd GPX and any other format that writes a color), through a palette parameter on the export functions.
- It never changes the accent, the traces, ink or paper.

## 9. Accessibility

- **Contrast**: text at least 4.5:1. Large text, glyphs, focus ring and other graphical marks at least 3:1. Pastilles stand off the map through their paper ring.
- **Focus**: visible, 2 px `accent-text` outline, 2 px offset.
- **Tabs**: `role="tablist"`, `tab` and `tabpanel`, arrow-key navigation.
- **Sheet handle**: a button with an `aria-label` that names the current detent. Enter cycles the detents.
- **POI detail**: focus moves to its heading when it opens; the back button returns focus to the row.
- Reduced motion is honored, and touch targets are at least 44 × 44 px.

## 10. Experiments

Minimal experiments that check and improve the decisions above. Each one runs **without user input**: simulated device, scripted journeys, objective metrics, and a screenshot review against this file. Throwaway code lives in the scratchpad, never in the repo. Experiments marked *permanent* leave a check behind in `just check` or `just test-e2e`.

Shared setup:

- **Simulated mid-range Android**: Playwright Chromium, Pixel 7 emulation (412 × 915, DPR 2.625, touch), CPU throttled ×4 through CDP (`Emulation.setCPUThrottlingRate`, Lighthouse's mid-tier mobile reference).
- **Desktop**: 1440 × 900.
- **Data**: the GPX files in `web/examples/`, Overpass answered by recorded fixtures (live runs only in E5).

| Id | Question | Protocol | Pass criterion | Decides |
| -- | -------- | -------- | -------------- | ------- |
| E1 | Is the shell smooth on a mid-range Android? | Simulated Android. Scripted handle drag through the three detents and a map pan, with 300 pastilles on the map. Frame intervals and long animation frames recorded in the page by the test harness. Variants: `transform` vs `height`, blur on/off on the round buttons, SVG vs CSS-glyph pastilles. | p95 frame interval ≤ 33 ms; no long animation frame over 100 ms. | Animated property, blur, marker technique. |
| E2 | Can the key numbers be read in the sun, at handlebar distance? | Sunlight model on every key pair (counter value, pastille glyph, list name): luminance = relative luminance × 800 cd/m² (display peak) + 400 cd/m² reflected (sunny outdoor, ~4 % screen reflectance); effective contrast = (L₁ + R) / (L₂ + R). Visual angle of the cap height at 70 cm on a Pixel 7 (1 CSS px ≈ 0.16 mm). Variants: dark counter screen vs ink on paper; 32 / 40 / 48 px; wdth 62 / 75. | Counter: effective contrast ≥ 3:1 and cap height ≥ 20 arcmin. Pastille glyph: ≥ 2:1. | Counter polarity, size and width; pastille size. |
| E3 | Are the palettes distinguishable and contrasted? *Permanent vitest.* | Simulate deuteranopia, protanopia and tritanopia (Machado 2009, severity 1) on the colour-blind palette and check the OKLab distance of every family pair. Check glyph contrast (both palettes) and state text contrast (both themes, both palettes). | Every pair above a threshold set from the measured spread, then frozen: 0.07 in OKLab (closest pair, Sleep/Services under deuteranopia, 0.076). Glyphs ≥ 3:1, state text ≥ 4.5:1. | Final hex values, including the darkened colour-blind state text. |
| E4 | Which base map makes the trace and pastilles stand out? | Screenshots of `web/examples/2026-04-13_…_de Hasparren à Baztan.gpx` and `paris-urban-short.gpx` with pastilles, on Voyager, Positron and OSM standard (light), Dark Matter and inverted OSM (dark), at zoom 11 and 15. On each PNG: OKLab contrast between the trace stroke and a 12 px band of map around it, pastille-to-background contrast, and clutter as the edge density of the background. Then a visual review of the screenshots. | The highest trace and pastille contrast with the lowest clutter wins, in both themes. | Tile provider. |
| E5 | Why do Overpass chunks still fail after 3 rounds, and which policy gets them through with no click? | (a) Live runs on the long example GPX and `paris-urban-short.gpx`, 3 each, spaced out to respect the Overpass usage policy: log status code, mirror, duration and round per chunk. (b) *Permanent vitest*: fault injection replaying the observed patterns (429 with `Retry-After`, 504, timeout, one mirror down) through a fake `fetch`. | (a) every live run completes with zero clicks; (b) every injected scenario completes with no user action and never exceeds the retry budget. | Retry policy (backoff honoring `Retry-After`, mirror rotation, continuing in the background). The "retry chunks" button goes away. |
| E6 | Are targets big enough and within thumb reach? *Permanent e2e.* | Simulated Android: walk every tab and every view; collect visible interactive elements. | Every element ≥ 44 × 44 px; tabs, ◀ ▶ and primary buttons centered in the lower 55 % of the viewport. | Sizes and placement of the primitives. |
| E7 | Where is the friction? *Permanent e2e, plus a screenshot review.* | Journeys on simulated Android and desktop: load a GPX, POI tab, filter Water, open a POI, ▶ next, export GPX; also resume a session and add a second GPX. Overpass fixtures inject one failing chunk. Each step records: taps, visible retry prompts, interactive elements covered by something else (`elementFromPoint` at their center), horizontal overflow, clipped text without ellipsis, layout shift, time from file chosen to first POI on screen. Screenshots in light, dark, colour-blind, FR and EN, reviewed against this file. | ≤ 8 taps on mobile; zero retry prompt; zero covered element; zero overflow or clipped text; CLS ≤ 0.1; review checklist clean. | Run after every migration step, fix, run again: this is the iteration loop. |
| E8 | Does it hold on the edge cases? | Same harness on: 360 px wide Android, 3 traces, long trace and POI names, 0 POI, a dense city (1 500 POIs), Overpass hard failure, restored session without raw elements, static build (`VITE_STANDALONE`, no tab 03), no WebGPU. | Same metrics as E7; nothing overlaps or overflows; every state has a clear message and no dead end. | Fixes before a step is called done. |

### Results

- **E1** (2026-10-18, throwaway prototype with the real pastilles, 300 markers, Pixel 7 emulation): every variant passes with a wide margin. p95 frame interval 16.8 ms in all 8 variants (`transform`/`height` × blur on/off × SVG/CSS glyph), even with the CPU throttled ×24; the worst long animation frame grows with the throttle (≈ 55 ms at ×16, 85 ms at ×24) the same way in every variant. With no measured difference, the defaults stand: `transform` (compositor only, and it never re-lays out the virtualized POI list during a drag), blur on the round buttons, SVG glyphs (the `iconSvg` helper, no generated stylesheet). Limit: CDP throttles the main thread only, so GPU cost (the blur) is not measured; check it on a real phone.
- **E2** (2026-10-19, throwaway script: the sunlight model on the tokens, Archivo measured in Chromium). The model's ceiling is 3.00 (pure white on pure black), so the 3:1 counter criterion only says "as close to the ceiling as the palette allows":

  | Counter pair | WCAG | In the sun |
  | ------------ | ---- | ---------- |
  | cyan `#2CB5FC` on screen (planned) | 8.2 | 1.79 |
  | white on screen | 18.9 | **2.97** |
  | ink on raised paper (light) | 16.9 | 2.84 |
  | ink on paper (light / dark) | 15.6 / 15.1 | 2.70 / 2.59 |

  Archivo's cap height is 0.687 em: 32 px gives 17.3 arcmin (fails), 40 px 21.6 (passes), 48 px 25.9. At 40 px, `248.3` is 77 px wide at wdth 62, 89 at 75, 113 at 100. Decision: the counter keeps its dark screen with **white** numerals (`--color-screen-ink`), 40 px, wdth 62; a vitest pins the pair at 2.9 or more in the sun. Pastille glyphs: any fill whose luminance lies between 0.25 and 0.52 stays under 2:1 with either glyph, which catches Food and Discovery (default) and Food, Sleep, Health and Services (colour-blind), all still 4.6:1 or more in WCAG. Kept as they are (the user's call, 2026-10-19): in the sun the fill carries the family and the glyph is secondary; reworking them would reopen the palettes and E3. List names, ink on paper, are 2.70 / 2.59.
- **E4** (2026-10-19, throwaway Leaflet page, 600 × 600 at DPR 2): CARTO now answers every keyless request with an "API KEY REQUIRED" tile, so the planned Voyager and Dark Matter were out. Measured instead: OSM standard, CyclOSM, Humanitarian (HOT) and Esri Light Gray Canvas (light); inverted OSM, inverted HOT and Esri Dark Gray Canvas (dark). Hasparren with synthetic pastilles, Paris with the recorded Overpass answer; at zoom 11 the 3 000 Paris pastilles cover the trace band, so its trace contrast is left out. Mean over both routes and both zooms, OKLab:

  | Base map | Trace vs map (median) | Pastille vs map (p10) | Clutter (edge share) |
  | -------- | --------------------- | --------------------- | -------------------- |
  | OSM | 0.24 | 0.17 | 0.074 |
  | CyclOSM | 0.22 | 0.15 | 0.174 |
  | HOT | 0.24 | 0.15 | 0.064 |
  | Esri Light Gray | 0.26 | 0.28 | 0.017 |
  | OSM inverted | 0.47 | 0.16 | 0.081 |
  | HOT inverted | 0.48 | 0.16 | 0.069 |
  | Esri Dark Gray | 0.37 | 0.10 | 0.020 |

  Esri Light Gray wins the light theme on every metric, but its legacy service is in mature support until it retires in December 2029, stops at zoom 16 and has unclear terms for keyless use: the CARTO trap again. Among the keyless OpenStreetMap sources, OSM and HOT tie and OSM has the steadier servers. Muted filters on OSM (saturate 0.5 or 0.25, a grey inversion) move every metric by less than 0.02, which is noise. Decision: tiles unchanged, OSM in light, inverted OSM in dark. CARTO with a free key (non-commercial, 5 M tiles a month) remains possible if the user registers one; it was not measurable without it.
- **E6** is `web/client/e2e/targets.spec.ts` (Pixel 7 project). Map markers joined it in step 4 (44 px targets); it found the start and finish markers in the tab order with no action, now fixed. The header strip joined it in step 6.
- **E7** is `web/client/e2e/journey.spec.ts` (both projects). ◀ ▶ joined the journey in step 5, with a long-list case (210 POIs: open a row deep in the list, back gives it the focus), which found a render loop the 3-POI stub could not show. "Add a second GPX" joins with step 7. Step 3 run: 6 taps on mobile, no retry prompt, no covered control, no overflow, CLS within 0.1.
- **E8** (step 3, throwaway, 360 px Android): dense city (3 000 POIs), 3 traces, long names, 0 POI, Overpass hard failure, no WebGPU and the static build all end with no covered control, no overflow and a message. Fixed on the way: the trace legend hid under the sheet (moved under the round buttons until step 4), and `03 ENRICHIR` spilled onto `04 EXPORT` at 360 px (E7 now flags a label wider than its button).

## 11. Out of scope

- **Ride mode**: geolocation and "next water in X km" get their own spec later. It reuses the counter as is.
- Marker clustering, offline tiles, new export formats.

## 12. Migration order

Each step ends with `just check` and an E6 to E8 pass (fix, re-run, until clean). It is committed on `designV2` only when the user asks.

0. Session routine: `just outdated`, then `just update`.
1. Overpass recovery (E5 first, then a failing regression test, then the fix).
2. Foundations:
   - color tokens, Archivo `wdth`, `lucide`, the icon helper (`components/Icon.tsx`); the old token names become aliases until step 8. Space, radius and elevation tokens come with the primitives in step 3;
   - `family`, `glyph` and the two palettes in `poi-config.ts`, `paletteAtom`;
   - E3.
3. Shell (after E1): sheet with detents, pill tabs, round buttons, settings popover, desktop panel, Pixel 7 Playwright project, E6.
4. Map (after E4): tiles, pastilles, traces and selection; popups and legend deleted.
5. POI tab: family filters, compact list, POI detail with ◀ ▶.
6. Header strip (after E2): compact profile with tap-to-centre, counter; the profile's own trace selector deleted.
7. Tabs 01, 03, 04; exports take the palette.
8. Cleanup: dead CSS and `neo-*`, `--shadow-hard`. Update `AGENTS.md` (stack line; the popup delay already left the approved timer list in step 4), `CONTRIBUTING.md`, `architecture.md` and `poi-categories.md` (families).
