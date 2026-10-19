# Task: Design V2 "Field instrument" (charter + mobile-first shell + migration)
Started: 2026-10-17
Status: in-progress

Spec and living reference: `web/docs/design.md`. Branch `designV2` (from `dev`, from `main`).

## Steps
- [x] 0. Session routine: `just outdated`, `just update` (@tanstack/react-virtual 3.14.21), `just check` green
- [x] 1. Overpass recovery: E5a live runs (0 failures, 3 of 4 mirrors 5xx at the time), E5b harness `overpass-faults.test.ts`, autoresearch track (3769 to 1534), server remark fix, retry button removed. Report in `xp/overpass.md`; merged into designV2 (fast-forward to 785d259)
- [x] 2. Foundations: color tokens (old names aliased), Archivo wdth, lucide 1.59 + `components/Icon.tsx`, family/glyph/`FAMILY_COLORS`/`poiGlyph` in poi-config, `paletteAtom` + `data-palette`, E3 `palettes.test.ts` (reads index.css through `?raw`, vitest `css.include`). Also: Overpass 504 overload fix (harness gap found live). Committed (93de564, a3d9af7)
- [x] 3. Shell: E1 (all variants pass, defaults kept, see design.md 10 Results), `lib/shell.ts` detents, `Sheet.tsx` (drag 1:1 by pointer events, tap cycles, tab panels stay mounted and scroll on their own), `Settings.tsx` (native popover), pill tabs with arrow keys, round buttons (fit route, settings), desktop panel, sheet-aware camera (fitBounds padding, flyTo offset), Pixel 7 Playwright project, E6 `targets.spec.ts`, E7 `journey.spec.ts`, E8 throwaway pass. `Step.tsx`, the header bar and the map empty overlay deleted. Committed (a3d9af7)
- [x] 4. Map: E4 (CARTO needs a key since 2026-09-25; keyless sources measured, OSM kept, see design.md 10 Results), family pastilles with lucide glyphs on 44 px targets, accent traces over a paper casing with tap selection (`selectedTraceIdAtom`), ink start/finish pastilles, count bubbles restyled, popups (and the open-popup delay), legend, antpath and emoji markers deleted; decorative markers out of the tab order (found by E6). E8 throwaway pass on Pixel 7 and desktop. Committed (6cfa405)
- [x] Missing POIs (user report 2026-10-19, "visible on the base map, not in Ravitools"): every category queried (turning one on used to show nothing), one corridor `CORRIDOR_M` = 1500 m for the query radius and the slider max (query was 1000 m, slider up to 3000 m; older sessions clamped), dedup fixed at 50 m (the adaptive radius merged 28 % of the Paris water points), new tags with an `only` condition carried into the query (water taps, springs, drinking fountains, wilderness huts, fuel, kiosks, markets, food/drink vending). Failing tests first. Paris answer: water 110 to 139, toilets 100 to 123. Live run pending (Overpass down). Committed (588d026)
- [x] Workflow dead ends (user report 2026-10-19, "passer à l'export alors qu'il y a 0 POIs"): 03 and 04 disabled by `lockedTabsAtom` until the run is done with a POI passing the filters (arrow keys skip them); every chunk failed is an error with its retry, not "done, 0 POI"; tab 02 opens only on a clean run with POIs, otherwise 01 shows the message; an error brings the user back to 01; the partial-failure warning gets a retry button; a dropped .fit/.tcx says what loads instead of doing nothing. Failing tests first; smoke e2e checks Export is disabled before upload. Committed (4ec695a)
- [ ] 5. POI tab: family filters, compact list, POI detail with prev/next
  - [x] 5a. Family filters: one `.chip` toggle per family (mixed = dashed ring), All/None (None while anything is on), distance and category chips behind a `<details>` (the first version, family rows with their chips, pushed the list 1 400 px down at mid). `setCategoriesAtom` replaces `setAllCategoriesAtom`; `POI_FAMILIES`; `.chip`, `.btn-quiet`, `.btn-sm`, `.pastille-sm`
  - [ ] 5b. Compact list
  - [ ] 5c. POI detail with prev/next
- [ ] 6. Header strip: E2, compact profile (tap to centre), counter, profile trace selector deleted
- [ ] 7. Tabs 01, 03, 04; exports take the palette
- [ ] 8. Cleanup: dead CSS, neo-*, docs (AGENTS.md, CONTRIBUTING.md, architecture.md, poi-categories.md)
- [ ] E7/E8 loop after each step (E7 permanent from step 3; E8 throwaway script pattern in the session scratchpad)
- [x] Research: `web/docs/research/similar-tools.md`, `device-poi-transfer.md` (COROS keeps GPX waypoints, under 200 recommended; Karoo drops every Ravitools GPX POI)
- [ ] Reverse COROS: **paused by the user (2026-10-18)**. When resumed: device test by the user first (250-waypoint GPX), then HAR, then APK

## Decisions
- Design decisions: see `web/docs/design.md` (grilling session 2026-10-16/17)
- One new dependency approved: `lucide`
- No separate plan document: this file is the plan, `design.md` section 12 the order
- autoresearch (2026-10-18): harness + `xp/program.md` first, Overpass track, UX track once the shell exists, research meanwhile. Commits and resets only on `autoresearch/<track>-<date>` branches from designV2, in a worktree. A track stops after 5 runs without a gain, with a report. Reverse: COROS, cloud/HAR first, then BLE/APK. Research: similar tools + device protocols, in `web/docs/research/`
- Installed with approval: openjdk + jadx (brew), REA 6.7.0 registered in the user MCP config. The user upgraded node to 26.12 (REA needs 22, 24 or 26+); the temporary node@24 and the simdjson workaround are gone

## Open findings (step 3)
- Overpass silent empty answer (overpass-api.de: 200, no elements, no remark on a dense Paris chunk; cached 24 h): fixed 2026-10-19, an empty answer without a remark is confirmed by one more mirror (proxy and static), regression tests in `server.test.ts`, `overpass.test.ts` and the `mirror0-empty` harness scenario
- Until step 6, the old elevation profile sits in the header strip: at low it runs under the pill tabs, and its controls are under 44 px (E6 skips `.sheet-strip`)
- The debug view no longer turns logging on by itself: tick "Logging" in it
- Blur cost on a real GPU unmeasured (E1 limit)

## Open findings (step 4)
- CARTO basemaps need an API key (free, non-commercial up to 5 M tiles a month): the user's call whether to register one; until then OSM stays
- Direction arrows clump into a dashed look at country zoom (3 traces far apart); pre-existing, the spec is silent on arrows
- Dense city: count bubbles overlap each other (pre-existing grid clustering, marker clustering is out of scope)

- Every category at 1500 m makes heavier Overpass queries: dense cities will split more often; check on a live run once Overpass is back

## Blockers
- none
