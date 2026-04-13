# Task: WS1 (legacy cleanup) + WS9 (review semantics)
Started: 2026-04-12
Status: done

## Steps
- [x] Delete all Python legacy files (main.py, run.py, app_frontend.py, services/, utils/, etc.)
- [x] Delete historical root files (requirements.txt, config.yaml, CONTEXT.md, TODO.md)
- [x] Delete stages/ directory entirely
- [x] Delete dockerfile.backend, dockerfile.frontend
- [x] Rewrite .gitignore (185→50 lines, web+MemPalace only)
- [x] Rewrite .dockerignore and .rsyncignore for web project
- [x] Update AGENTS.md: remove Python refs, add WebLLM/Firefox constraints
- [x] Update root README.md: remove legacy refs
- [x] Update skills/add-poi-workflow.md: reference poi-config.ts
- [x] Update skills/architecture-review.md: rewrite for web-only
- [x] Update web/docs/architecture.md: remove config.yaml provenance
- [x] Update web/docs/poi-categories.md: remove Python provenance
- [x] WS9: Update EnrichedData JSDoc (rating/reviewCount = extracted not aggregated)
- [x] WS9: Harden LLM prompt (never guess ratings from sentiment)
- [x] WS9: Update web/README.md (add rating semantics section)
- [x] Verify: tsc --noEmit passes
- [x] Verify: 121 tests pass
- [x] Commit all changes

## Decisions
- Ratings are extractions from search snippets, not aggregations
- LLM must never estimate a rating from sentiment — prefer null
- .gitignore `lib/` → `/lib/` fix was critical (was blocking web/client/src/lib/)
