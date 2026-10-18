# AGENTS.md - Ravitools Development Instructions

## Project Context

You are working on **Ravitools**: a web app that enriches a cycling GPX trace with useful OpenStreetMap POIs (water, food, sleep, repair...) and exports them for offline use on GPS units, phones and web maps.

The core value is relevance: POIs along the actual route, with low noise, not everything in a wide radius. The GPX file never leaves the browser.

### Reference Documents

- `CONTRIBUTING.md`: setup, verification, where things live, how to add a POI category
- `web/docs/architecture.md`: pipeline, what runs where, file map, server endpoints
- `web/docs/poi-categories.md`: the 18 categories and their OSM tags
- `web/docs/deployment.md`: GitHub Pages demo and VPS deployment
- `tasks/`: active work tracking (see below)

This file is the single source of agent instructions. Do not add a `CLAUDE.md`.

---

## ABSOLUTE Rules

| Constraint                        | Reason                                                        |
| --------------------------------- | ------------------------------------------------------------- |
| Ask for clarification if in doubt | Avoid unnecessary work                                        |
| Read files before modification    | Understand the context                                        |
| **Committing**                    | User manages git, not you. If asked: one-line message, no body |
| **Bun only**                      | Runtime, package manager, scripts. Never `npm`, never `node`  |
| **just**                          | Task runner; `just check` is the definition of done           |
| **Zero warning**                  | Every warning is an error, enforced by the tools (see below)  |
| **Dependencies up to date**       | `just update` every session; majors one at a time             |
| **Jotai**                         | All app state lives in atoms under `web/client/src/state/`    |
| **No new dependency**             | Without explicit approval; a few lines beat a package         |
| **GPX stays in the browser**      | Privacy by design; the server only proxies OSM/search/geocode |
| **No dead code**                  | What you replace, you drop                                    |
| **Minimal diff**                  | Smallest correct change, fewest files touched                 |

## Typography

**Never use em-dashes (U+2014) anywhere**: not in code comments, doc comments,
UI strings, log messages, Markdown, or reports, in English or in French.
Use the appropriate standard punctuation instead: a colon to introduce an
explanation, a semicolon or comma to join clauses, parentheses for asides.
For empty table cells or missing values, use a plain hyphen `-`.
(In French, keep the space before the colon: ` : `.)

En-dashes are allowed only inside numeric ranges (`0–3`, `9h00–18h00`).

## Fundamental Principles

### DRY - Don't Repeat Yourself

**Never duplicate logic or values.**

- A constant (URL, threshold, tag list) = ONE place only
- Business logic = ONE function only
- If you modify the same thing in multiple places, it's WRONG

**Concrete examples:**

```typescript
// BAD: the threshold typed again in a component, a visible string inline
if (poi.distanceToTrace > 1500) { ... }
<span>POIs enriched</span>

// GOOD: read the one setting that owns it, one string table
const { maxDistanceM } = useAtomValue(routeSettingsAtom); // state/route.ts, default 1500
<span>{t("enrich.poisEnriched", targetLanguage)}</span>   // lib/i18n.ts, fr + en
```

- POI categories, OSM tags, OsmAnd mappings, enrichment contracts: `web/client/src/lib/poi-config.ts`
- Every user-visible string: `t(key, lang)` in `web/client/src/lib/i18n.ts`, fr + en
- Export formats share `lib/export/shared.ts`, `description.ts`, `hours.ts`; never re-implement a formatter per format

### KISS - Keep It Simple, Stupid

**The simplest solution is always the best.**

- No premature abstraction
- No over-engineering
- If it's complicated, it's probably wrong
- One change = minimum files modified

**Before coding, ask yourself:**

1. Can I make it simpler?
2. Am I modifying the right place (the most centralized)?
3. Would someone else understand in 5 seconds?

### No shortcuts

**Even if something is simpler, think about edge cases before doing the "simple thing"**: multi-GPX traces, a trace crossing a big city (POI density), Overpass rate limits, no WebGPU, no server (static GitHub Pages build), restored sessions without raw Overpass elements.

---

## Tech Stack

### Frontend (`web/client`)

```
Runtime: Bun 1.x
Framework: React 19 + TypeScript 7 strict + Vite 8 (Rolldown)
UI: Tailwind v4 + plain CSS tokens (neobrutalist "carnet de route", dark theme via tokens)
State: Jotai (atoms + action atoms in src/state/)
Map: Leaflet 1.9 via react-leaflet 5
Enrichment: @mlc-ai/web-llm (WebGPU, Qwen2.5-3B), SearXNG + Nominatim through the server proxy
Tests: vitest (+ jsdom per file), Playwright e2e (desktop + Pixel 7)
```

### Backend (`web/server`)

```
Runtime: Bun (bun src/index.ts, no build step)
Framework: Express 5 (helmet, compression, express-rate-limit), in-memory TTL caches
DB: Postgres + PostGIS, optional shared enrichment cache (proxy-only mode without DATABASE_URL)
Scraping: Playwright (Google Maps fallback), SSRF-guarded fetch-page
Tests: vitest + supertest
```

### Tooling

```
Lint/format: biome (zero warnings)
Task runner: just (justfile at repo root)
CI: GitHub Actions (typecheck, test, lint on both packages; Pages deploy of the static client), Dependabot weekly updates
```

### Data Model

Do not duplicate schemas here. Source of truth:

- Domain types: `web/client/src/types/index.ts` (TracePoint, TraceData, POI, PoiCategoryConfig, EnrichedData, EnrichmentJobState)
- Server cache table `poi_enrichment`: `web/server/migrations/001_init.sql`, keyed by (osm_type, osm_id), PostGIS point, JSONB enrichment

---

## Patterns to Follow

### State Management (Jotai)

```typescript
// Pattern: derived state is an atom, never recomputed in components
// filteredPoisAtom derives from poisAtom + activeCategoriesAtom + routeSettingsAtom

// Pattern: pipelines are action atoms (atom(null, async (get, set, ...) => ...))
// processFilesAtom, retryQueryAtom, startEnrichmentAtom live in src/state/, not in components

// Pattern: components read atoms and dispatch action atoms; no business logic in JSX
```

### Pure Libraries

```typescript
// lib/ is pure: no React, no DOM except gpx-parser (DOMParser) and export (Blob)
// Everything testable in vitest without a browser
```

### Components

```typescript
// Pattern: one component per tab (TabPanel in Sheet.tsx wraps it), explicit props
// Pattern: shared rendering extracted once (Icon draws a lucide icon for React, iconSvg for Leaflet divIcons)
```

### Timers (strict)

**NEVER use `setTimeout`, `setInterval`, debounce, throttle, rAF (requestAnimationFrame) or `queueMicrotask`** without explicit permission from the master. These techniques cause visual desynchronizations and are very hard to debug. If you think one is necessary, ASK FIRST.

Already approved, do not add to this list without asking:

- UI: `CategoryFilter` slider commit (150 ms), `EnrichmentPanel` scraper job-stats polling, `RouteMap` hover grace
- Async sleeps for retry/backoff/stagger/cooldown: `lib/overpass.ts`, `lib/enrichment/search.ts`, `run-concurrent.ts`, `google-fallback.ts`, `state/enrichment.ts`, server `browser.ts` and `routes/overpass.ts`

---

## Development Workflow

### Before coding

1. **Ask for clarification** if something is unclear
2. **Announce what you're going to do** before starting
3. Create `tasks/tasks_{id}.md` for any substantial session (format below)

### During dev

1. **One feature at a time** - no parallel changes
2. **Tests at the same time** as the code
3. **Run `just check`** before moving on

### After dev

1. **Update the task file** (steps, decisions, blockers)
2. **Summarize what was done**
3. Mark the task `done` and move it to `tasks_archive/` (local only, not tracked by git)

### Task file format

```markdown
# Task: {title}
Started: {date}
Status: in-progress | done | blocked | abandoned

## Steps
- [x] Step completed
- [ ] Step pending

## Decisions
- {decision and why}

## Blockers
- {if any}
```

---

## Critical Features to Understand

### POI pipeline

```
GPX upload (browser)
    ↓ parse + resample to ~500 m
Overpass query by chunks (50 pts per trace, 3 pts overlap, around:1000; failed chunks retry for up to 8 min with no click, a timed-out one is split in four)
    ↓ via server proxy, or directly in the static build (VITE_STANDALONE)
Tag matching → 18 categories
    ↓ perpendicular distance to trace (< maxDistanceM), dedup 50 m same category, sort along trace
Map + list + elevation profile (gaps without water/food)
    ↓ optional enrichment: geocode → official site (+1 hop, evidence windows) → SearXNG in the country's language → WebLLM synthesis, deterministic fallback
Export: GPX, KML, GeoJSON, OsmAnd GPX, KMZ, plan file (.ravitools.json)
```

### Multi-GPX

Several traces at once; each POI carries the id of its nearest trace (`POI.traceId`, set by `lib/poi-processor.ts`). Distance filtering is the minimum over all traces.

### Session restore

Restored sessions have no raw Overpass elements: re-filter from the restored POI superset, never re-query silently.

### Enrichment trust

Every enriched POI carries confidence, provenance and `synthesisSource` (AI / AI-repaired / deterministic). Surface it; never present LLM output as fact.

---

## Expected Quality

### TypeScript

- `strict: true`
- No `any`
- No `@ts-ignore`
- `biome-ignore` only with a reason and explicit approval
- Explicit types for props and returns

### Tests

- A bug fix starts with a failing regression test
- GPX-parsing tests need `// @vitest-environment jsdom` (no `DOMParser` in Node)
- Any POI-logic change is also checked on a real GPX from `web/examples/`

---

## Mandatory Linting

### Absolute Rule

**You MUST run the linter after every code modification and fix errors BEFORE moving on.**

### Warnings are errors, in the tools

A warning that does not fail `just check` is a warning nobody reads. The tools enforce it:

- biome: `biome check --error-on-warnings .` over the whole package (`src`, tests, e2e, config files), not just `src`
- TypeScript: `strict`, `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch` in both packages
- vitest: `expect.requireAssertions` in both packages (a test without an assertion fails)
- Any other tool that prints warnings (vite build, vitest, playwright, bun install): fix the cause, or ask

Never lower a rule's severity, never add `biome-ignore`, `@ts-expect-error` or an exclude to get green without explicit approval. When you add a tool, configure it so its warnings fail.

### Commands

```bash
just check        # typecheck + tests + lint, client and server, zero warning
just typecheck
just test         # or just test-client / just test-server
just lint
just format
just test-e2e     # Playwright (client)
just test-live    # live contract checks against the real sources (network, not part of check)
just outdated     # outdated dependencies, all workspaces
just update       # in-range updates (semver ranges of package.json), then just check
```

### Dependency updates

1. Start of every session: `just outdated`, then `just update`. A broken update is fixed before any feature work.
2. Major versions: one package per change, never bundled with a feature. Read the changelog/migration guide, apply it, `just check` plus `CI=1 just test-e2e` (Playwright starts a fresh dev server; a running one still serves the old pre-bundled deps), then report what changed.
3. Keep the tooling in step: bump `biome.json`'s `$schema` with biome (`biome migrate`), and the stack versions listed in this file.
4. A dependency the stdlib or the platform now covers gets removed rather than updated.
5. Dependabot (`.github/dependabot.yml`) opens weekly PRs for bun and GitHub Actions: minor and patch grouped in one PR, each major alone. CI checks them; a major PR still follows step 2 (changelog, `CI=1 just test-e2e`) before merging.

### Workflow

1. Modify code
2. **Run `just check`**
3. Fix reported errors
4. Re-run until 0 errors and 0 warnings
5. Only then, consider the task complete

**NEVER ignore linter warnings.** If a warning seems incorrect, ask for confirmation before ignoring it.

---

## Product Decisions

- Personal, single-user deployment: no multi-tenant hardening, no heavy observability
- Languages: FR + EN (UI and enrichment output)
- Export targets: generic GPX viewers, OsmAnd, Garmin, Wahoo, COROS (GPX waypoints through the COROS app, fewer than 200 per route recommended; see `web/docs/research/device-poi-transfer.md`)
- Offline boundary: exports and an already-loaded session work offline; discovery (Overpass) and enrichment need network
- Data: no user route stored server-side; caches Overpass 24 h, search 7 d, geocode 30 d, PostGIS enrichment 90 d
- License MIT; OpenStreetMap ODbL attribution on the map and in exports

## Known Constraints

- Tailwind v4 does not support `@apply` on custom classes defined in the same CSS file: use plain CSS
- `DOMParser` does not exist in Node: GPX-parsing tests need `// @vitest-environment jsdom`
- Example GPX files live in `web/examples/`
- The WebLLM chunk is ~6 MB (WASM runtime); dynamic import is code-split but Vite still bundles it. Cosmetic
- Firefox has no WebGPU by default: LLM enrichment needs Chrome/Edge/Safari
- TypeScript 7 (native compiler) ships no JS API until 7.1: a tool that imports `typescript` needs the `@typescript/typescript6` alias
- MemPalace must run with the repo's Python 3.12 venv, not Python 3.14

## MemPalace

- Local env: `./.tools/mempalace-py312`
- Local palace: `./.mempalace/palace`
- Config: `mempalace.yaml`

```bash
./.tools/mempalace-py312/bin/mempalace --palace ./.mempalace/palace status
./.tools/mempalace-py312/bin/mempalace --palace ./.mempalace/palace search "query"
./.tools/mempalace-py312/bin/mempalace --palace ./.mempalace/palace wake-up
```
