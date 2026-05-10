# Task: Price extraction from search snippets (deterministic, no LLM)
Started: 2026-04-14
Status: done

## Problem
`priceLevel` was only populated by the LLM (WebLLM/Qwen2.5). When the LLM was unavailable, failed, or returned `null` for price, the field stayed null — even when snippets contained obvious price signals like `€€€` or `"Menu: 35€"`.

## Steps
- [x] Implement `extractPriceLevel()` in `structured.ts`
- [x] Strategy 1: Repeated currency symbols (€€, $$$, £££) — most reliable, from review platforms
- [x] Strategy 2: Textual labels (Inexpensive, Moderate, Expensive, bon marché, cher, etc.)
- [x] Strategy 3: Numeric prices with currency symbols — bracket inference by category
- [x] Unicode-safe word boundaries for French patterns (bon marché, très cher, prix moyen)
- [x] Integrate into `enricher.ts`: LLM fallback (`synthesis.priceLevel ?? extractPriceLevel(...)`)
- [x] Integrate into `enricher.ts`: no-LLM path (deterministic extraction from snippets)
- [x] Both single-POI and batch enrichment paths updated
- [x] 40 unit tests for `extractPriceLevel` (repeated symbols, textual, numeric, priority, edge cases)
- [x] TypeScript type check clean
- [x] All 452 tests pass (412 existing + 40 new)
- [x] Production build succeeds

## Decisions
- **Require 2+ repeated symbols**: Single `€` in `15€` is a numeric price, not a price-level indicator. Only `€€`+ triggers Strategy 1.
- **Unicode-safe boundaries**: JS `\b` doesn't work with `é`, `è`, etc. Used `(?:^|[\s,;:!?.(])` / `(?=$|[\s,;:!?.)])` instead.
- **Category-aware numeric brackets**: Accommodation uses higher thresholds (30/70/150€) vs restaurant (8/20/45€).
- **Priority: symbols > textual > numeric**: Repeated symbols from review platforms are the most reliable signal.
- **LLM takes precedence**: `extractPriceLevel` is only used as fallback when LLM returns null.
- **Median aggregation**: When multiple snippets contain repeated symbols, take the median to reduce noise.

## Files modified
- `web/client/src/lib/enrichment/structured.ts` — `extractPriceLevel()` function + constants
- `web/client/src/lib/enrichment/enricher.ts` — import + integration in 4 code paths (single LLM, single no-LLM, batch LLM, batch no-LLM)
- `web/client/src/__tests__/price-extraction.test.ts` — 40 new tests
