# Task: Enrichment hardening final
# Started: 2026-04-13
# Status: done

## Steps
- [x] Reassess current sandbox placement and hardening scope
- [x] Move sandbox out of the production flow
- [x] Harden the enrichment schema and deterministic normalization
- [x] Update UI consumption to use the hardened structure consistently
- [x] Verify with type-check, tests, and build
- [x] Align exports with the hardened structured enrichment fields

## Decisions
- The sandbox must stay available for testing, but not be shown in the normal product flow.
- Expose the sandbox only with `?sandbox` so it remains available without polluting the product UX.
- Make deterministic structured content the primary safety net, with the LLM acting as an optional enhancement rather than the sole source of quality.
- Keep legacy free-text fields for backward compatibility, but make `structured` the primary export/UI source of truth.

## Blockers
- None
