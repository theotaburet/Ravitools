# Task: Repository audit remediation roadmap
Started: 2026-04-13
Status: done

## Steps
- [x] Convert the repository audit into actionable workstreams
- [x] Prioritize work by impact, risk, and implementation cost
- [x] Attach concrete file targets and validation criteria
- [x] Capture the reasoning behind each recommendation

## Context
- The repository is globally healthy: client and server builds pass, typecheck passes, and automated tests pass.
- The audit did not reveal a blocking defect.
- The main needs are product hardening, performance control, and medium-term maintainability.

## Workstreams

### 1. Reduce client bundle cost from WebLLM

- [ ] Measure the exact composition of the production bundle and identify what still lands in the large `index-BINDwMoN.js` chunk.
  Files: `web/client/vite.config.ts`, `web/client/src/lib/enrichment/llm.ts`, build output under `web/client/dist/`
  Why: the current build emits a ~6 MB minified chunk and Vite warns about oversized chunks. This is the most concrete performance issue found during the audit.
  Done when: a bundle analysis is captured and the heavy chunk has an identified cause.

- [ ] Ensure WebLLM is isolated behind a truly lazy path and does not degrade the initial route for users who never use enrichment.
  Files: `web/client/src/lib/enrichment/llm.ts`, `web/client/src/hooks/useEnrichment.ts`, `web/client/src/components/EnrichmentPanel.tsx`
  Why: enrichment is optional, so its runtime cost should not dominate the first load of the core GPX -> POI workflow.
  Done when: the main application chunk is materially smaller or the remaining large chunk is explicitly justified and documented.

- [ ] Document the chosen tradeoff for WebLLM bundling in repo docs.
  Files: `web/README.md`, `web/docs/architecture.md`
  Why: the current limitation is known but still operationally important for contributors and deployment decisions.
  Done when: docs state what is bundled, when it loads, and what remains as an accepted limitation.

### 2. Harden server production defaults

- [ ] Replace permissive production behavior around CORS with an explicit environment-aware policy.
  Files: `web/server/src/index.ts`
  Why: `CORS_ORIGIN` currently falls back to `*`, which is fine for local development but too permissive as a default security posture.
  Done when: local development stays simple, but production defaults require an explicit origin or an explicit opt-in to wildcard behavior.

- [ ] Centralize server configuration parsing and validation instead of reading env vars inline at module top level.
  Files: `web/server/src/index.ts`, new config module if needed under `web/server/src/`
  Why: configuration is currently readable, but it is growing and mixing boot logic with runtime behavior.
  Done when: config values are parsed in one place, invalid values fail clearly, and the main server entrypoint becomes easier to scan.

- [ ] Add explicit documentation for safe production configuration.
  Files: `web/README.md`, `web/docs/deployment.md`
  Why: the docs already mention a secure `CORS_ORIGIN`, but the runtime defaults still deserve stronger operational guidance.
  Done when: deployment docs clearly describe minimum recommended hardening settings.

### 3. Bound and harden local session persistence

- [ ] Define a persistence budget and retention rule for saved sessions.
  Files: `web/client/src/lib/session.ts`, `web/README.md`
  Why: the app currently saves trace data, POIs, and enrichments to `localStorage` with no explicit size or age policy.
  Done when: the code and docs state what is persisted, how large it may get, and when it should be discarded.

- [ ] Add defensive guards for oversized session payloads and optionally drop the least critical data first.
  Files: `web/client/src/lib/session.ts`
  Why: long traces and large enrichment payloads can exceed `localStorage` limits or create slow restore/save behavior.
  Done when: session writes are bounded and failure behavior is explicit instead of silently relying on browser quota limits.

- [ ] Reassess whether full raw enrichment payloads need to be persisted, or whether a smaller serialized form is enough.
  Files: `web/client/src/lib/session.ts`, `web/client/src/types/index.ts`
  Why: `rawSnippets`, full traces, and large POI arrays are the most obvious payload growth drivers.
  Done when: persisted shape reflects actual resume needs rather than full in-memory state mirroring.

### 4. Reduce future maintenance cost in oversized modules

- [ ] Split `export.ts` by responsibility without changing export behavior.
  Files: `web/client/src/lib/export.ts`
  Why: one file currently owns five export formats, text/HTML description shaping, XML helpers, and ZIP building.
  Done when: format builders and low-level helpers are easier to locate and modify independently.

- [ ] Split `enricher.ts` into smaller units around policy, orchestration, and confidence/utility helpers.
  Files: `web/client/src/lib/enrichment/enricher.ts`
  Why: the file currently mixes skip policy, staged concurrency, progress reporting, synthesis flow, and confidence scoring.
  Done when: a contributor can change one concern without re-reading the whole enrichment pipeline.

- [ ] Extract server boot/config/middleware/route logic into smaller server modules if the endpoint surface keeps growing.
  Files: `web/server/src/index.ts`
  Why: the current single-file server is still manageable, but it is already large enough to slow future hardening and testing work.
  Done when: route handlers and infrastructure concerns are separated enough to be testable and readable in isolation.

### 5. Tighten export sanitation and trust boundaries

- [ ] Review all export string builders for externally sourced text and URL injection behavior.
  Files: `web/client/src/lib/export.ts`
  Why: the app exports user-facing GPX/KML/GeoJSON built partly from OSM and search-derived data, so sanitation should be explicit and not accidental.
  Done when: all text and URL fields included in exports have a deliberate escaping/sanitation policy.

- [ ] Decide whether KML HTML descriptions should keep rich links or prefer stricter plain-text formatting.
  Files: `web/client/src/lib/export.ts`
  Why: richer descriptions improve UX, but they also widen the formatting and trust surface for downstream consumers.
  Done when: the project has a conscious, documented export trust model.

- [ ] Add regression tests for export sanitation edge cases.
  Files: `web/client/src/__tests__/export.test.ts`
  Why: the current export tests are strong on functionality but should also protect against malformed or dangerous content regressions.
  Done when: suspicious characters and untrusted URLs are covered by tests.

### 6. Improve performance behavior on large traces

- [ ] Benchmark large GPX processing and identify UI-thread hotspots.
  Files: `web/client/src/lib/gpx-parser.ts`, `web/client/src/lib/poi-processor.ts`, `web/client/src/hooks/useRavitools.ts`
  Why: parsing, simplification, and distance-to-trace calculations all run on the main thread.
  Done when: there is a concrete threshold for when current behavior becomes uncomfortable.

- [ ] Decide whether worker offloading is required now or should stay a documented future step.
  Files: `web/client/src/lib/gpx-parser.ts`, `web/client/src/hooks/useRavitools.ts`, `web/README.md`
  Why: the architecture already acknowledges this as a likely future need for very large files.
  Done when: the repo contains either an implementation plan or an explicit non-goal with measured justification.

- [ ] Add at least one performance-oriented non-functional test or benchmark note for large traces.
  Files: `web/client/e2e/smoke.spec.ts`, `web/README.md`, or a dedicated benchmark note under `web/docs/`
  Why: current tests validate correctness well, but not runtime behavior under heavier input sizes.
  Done when: contributors can check that performance has not obviously regressed on a representative large file.

### 7. Align documentation with the current codebase state

- [ ] Remove stale statements in docs that no longer match the implementation.
  Files: `web/README.md`
  Why: the README still mentions missing session persistence and missing server tests even though both now exist.
  Done when: docs describe the repo as it is today, not as it was a few iterations ago.

- [ ] Reconcile reported test counts and coverage claims with actual automated test output.
  Files: `web/README.md`
  Why: test volume has grown, and the README should not drift from the real CI-like state of the repo.
  Done when: the documented counts and scope match the current suite or are rewritten in non-brittle terms.

- [ ] Keep architecture and deployment docs synchronized with the operational decisions made in the hardening tasks above.
  Files: `web/docs/architecture.md`, `web/docs/deployment.md`
  Why: these docs are already useful and should remain the source of truth for contributors.
  Done when: changes in bundle strategy, persistence, and server hardening are reflected in the docs.

### 8. Add light engineering guardrails

- [ ] Introduce a linting/formatting baseline if the project wants stronger consistency guarantees.
  Files: `web/client/package.json`, `web/server/package.json`, config files as needed
  Why: TypeScript strictness is already good, but the repo currently lacks visible lint/format guardrails in its package scripts.
  Done when: contributors have a repeatable local quality command beyond tests and build.

- [ ] Decide whether CI should enforce typecheck, unit tests, server tests, and client build on every change.
  Files: repo CI config if added later, `README.md` if documented
  Why: the repository quality is already strong enough that automation would protect it effectively.
  Done when: the expected verification path is explicit and preferably automated.

### 9. Add multi-GPX route loading and map highlighting

- [ ] Redefine the client route model so the app can hold multiple uploaded GPX files at once instead of a single `trace` object.
  Files: `web/client/src/types/index.ts`, `web/client/src/hooks/useRavitools.ts`, `web/client/src/App.tsx`, `web/client/src/lib/session.ts`
  Why: the current application state is built around a single active route, which blocks any real multi-file workflow.
  Done when: application state can represent multiple named traces without breaking the existing POI pipeline.

- [ ] Update GPX upload flow to accept and process multiple files in one action.
  Files: `web/client/src/components/GpxUpload.tsx`, `web/client/src/hooks/useRavitools.ts`
  Why: multi-trace support starts at input handling; the UI and pipeline must stop assuming exactly one uploaded file.
  Done when: the upload control accepts several GPX files and triggers processing for all of them.

- [ ] Decide and implement the product semantics for POI processing with multiple traces.
  Files: `web/client/src/hooks/useRavitools.ts`, `web/client/src/lib/overpass.ts`, `web/client/src/lib/poi-processor.ts`, `web/client/src/types/index.ts`, `web/README.md`
  Why: the repository currently queries and filters POIs against one simplified trace. Multi-GPX support requires a clear rule: independent POI sets per route, merged POIs across all routes, or another explicit model.
  Done when: the chosen behavior is implemented and documented, with no ambiguity about how POIs relate to several traces.

- [ ] Render each GPX as a distinct trace on the map with a visible label derived from the GPX name.
  Files: `web/client/src/components/RouteMap.tsx`, `web/client/src/App.tsx`, `web/client/src/types/index.ts`
  Why: the user explicitly wants separate visual traces, not a merged polyline.
  Done when: each uploaded GPX appears as its own map line and is identifiable by name in the UI.

- [ ] Add hover interaction so hovering a route label or its trace visually highlights the associated trace.
  Files: `web/client/src/components/RouteMap.tsx`, likely supporting UI in `web/client/src/App.tsx` or a route legend component
  Why: without linked hover state, multiple traces quickly become hard to distinguish in dense map views.
  Done when: hovering either the label or the map trace strengthens the same route's visual styling and de-emphasizes the rest if needed.

- [ ] Add a route legend or route list that exposes the labels used for hover/highlight interactions.
  Files: `web/client/src/App.tsx`, new component under `web/client/src/components/` if needed
  Why: labels must exist in a stable, discoverable UI element, not only as map annotations.
  Done when: users can identify every uploaded route by name and use the labels to trigger hover highlighting.

- [ ] Extend session persistence to save and restore multiple routes cleanly.
  Files: `web/client/src/lib/session.ts`, `web/client/src/App.tsx`, `web/client/src/hooks/useRavitools.ts`
  Why: session persistence currently mirrors a single-route application model.
  Done when: a saved session restores all uploaded GPX traces and their associated state consistently.

- [ ] Add tests for multi-file upload, multi-trace rendering semantics, and hover/highlight behavior.
  Files: `web/client/src/__tests__/session.test.ts`, new or existing client tests under `web/client/src/__tests__/`, `web/client/e2e/smoke.spec.ts`
  Why: this feature changes the core route model and should be protected by both state-level and user-visible tests.
  Done when: the app has automated coverage for loading several GPX files and distinguishing/highlighting them correctly.

## Prioritization

### P0 - Highest impact now

- [ ] Workstream 1: Reduce client bundle cost from WebLLM
- [ ] Workstream 2: Harden server production defaults
- [ ] Workstream 7: Align documentation with the current codebase state

### P1 - Important next

- [ ] Workstream 3: Bound and harden local session persistence
- [ ] Workstream 5: Tighten export sanitation and trust boundaries
- [ ] Workstream 6: Improve performance behavior on large traces
- [ ] Workstream 9: Add multi-GPX route loading and map highlighting

### P2 - Structural improvements

- [ ] Workstream 4: Reduce future maintenance cost in oversized modules
- [ ] Workstream 8: Add light engineering guardrails

## Validation
- [ ] `cd web/client && npx tsc --noEmit`
- [ ] `cd web/client && npm test`
- [ ] `cd web/client && npm run build`
- [ ] `cd web/server && npm test`
- [ ] `cd web/server && npm run build`

## Decisions
- No emergency remediation task is needed because the repository is currently functioning correctly.
- The first remediation priority is performance, because the oversized WebLLM-related bundle is the only problem directly reproduced during verification.
- Security hardening should focus on safe defaults and explicit trust boundaries rather than on adding heavyweight infrastructure.
- Refactors should stay incremental and behavior-preserving; the repository does not justify a broad rewrite.

## Blockers
- None
