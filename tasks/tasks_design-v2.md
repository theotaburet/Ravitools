# Task: Design V2 "Field instrument" (charter + mobile-first shell + migration)
Started: 2026-10-17
Status: in-progress

Spec and living reference: `web/docs/design.md`. Branch `designV2` (from `dev`, from `main`).

## Steps
- [x] 0. Session routine: `just outdated`, `just update` (@tanstack/react-virtual 3.14.21), `just check` green
- [x] 1. Overpass recovery: E5a live runs (0 failures, 3 of 4 mirrors 5xx at the time), E5b harness `overpass-faults.test.ts`, autoresearch track (3769 to 1534), server remark fix, retry button removed. Report in `xp/overpass.md`; merged into designV2 (fast-forward to 785d259)
- [x] 2. Foundations: color tokens (old names aliased), Archivo wdth, lucide 1.59 + `components/Icon.tsx`, family/glyph/`FAMILY_COLORS`/`poiGlyph` in poi-config, `paletteAtom` + `data-palette`, E3 `palettes.test.ts` (reads index.css through `?raw`, vitest `css.include`). Also: Overpass 504 overload fix (harness gap found live). Uncommitted
- [x] 3. Shell: E1 (all variants pass, defaults kept, see design.md 10 Results), `lib/shell.ts` detents, `Sheet.tsx` (drag 1:1 by pointer events, tap cycles, tab panels stay mounted and scroll on their own), `Settings.tsx` (native popover), pill tabs with arrow keys, round buttons (fit route, settings), desktop panel, sheet-aware camera (fitBounds padding, flyTo offset), Pixel 7 Playwright project, E6 `targets.spec.ts`, E7 `journey.spec.ts`, E8 throwaway pass. `Step.tsx`, the header bar and the map empty overlay deleted. Uncommitted
- [ ] 4. Map: E4, tiles, pastilles, traces + selection, popups and legend deleted
- [ ] 5. POI tab: family filters, compact list, POI detail with prev/next
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
- Overpass silent empty answer: overpass-api.de answered a dense Paris chunk with 200, `elements: []` and no remark (mail.ru: 3 219 elements for the same query), and the proxy cached it for 24 h, so that route shows 0 POI. Not fixed: needs its own failing test (a 200 with no elements is legitimate in a desert). Candidates: never cache an empty answer, try the next mirror on an empty answer
- Until step 6, the old elevation profile sits in the header strip: at low it runs under the pill tabs, and its controls are under 44 px (E6 skips `.sheet-strip`)
- The debug view no longer turns logging on by itself: tick "Logging" in it
- Blur cost on a real GPU unmeasured (E1 limit)

## Blockers
- none
