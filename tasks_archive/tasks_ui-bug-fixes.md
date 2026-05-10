# Task: UI & enrichment pipeline bug fixes
Started: 2026-04-14
Status: done

## Problem
Multiple silent bugs identified by analysing UI behaviour and code review:
1. CAPTCHA-pause safety flow never triggered (logic inversion)
2. Badge "AI" absent du batch (synthesisSource manquant dans enrichBatch LLM path)
3. Description/review/rating vides pour tous les POI sans WebLLM (no-LLM path incomplet)
4. Crash potentiel au render si une URL source est invalide (new URL non protégé)
5. Faux positifs de rejet LLM pour le français ("restaurant", "open", "good" rejetés à tort)

## Steps
- [x] Bug 6: Corriger logique inversée dans areAllEnginesSuspended() — search.ts
- [x] Bug 1: Ajouter synthesisSource/synthesisReason dans enrichBatch LLM path — enricher.ts
- [x] Bug 2: Aligner le no-LLM path de enrichBatch sur enrichPoi (rating, reviewCount, description, review, synthesisSource, synthesisReason) — enricher.ts
- [x] Bug 4: Protéger new URL(url).hostname dans PoiList.tsx avec try/catch
- [x] Bug 5: Restreindre looksLikeTargetLanguage aux patterns anglais non ambigus (éviter restaurant/open/good) — llm.ts
- [x] tsc --noEmit: clean
- [x] npm test: 455/455

## Decisions
- areAllEnginesSuspended: supprimer le court-circuit basé sur la comparaison de string (getHealthyEngineList() === SEARXNG_ENGINES est un faux indicateur). Utiliser directement engineFailureState.
- no-LLM path: copier exactement le même pattern que enrichPoi (deterministicRating, deterministicReviewCount, buildDeterministicShortDescription, buildDeterministicShortReview, synthesisSource: "deterministic").
- looksLikeTargetLanguage (fr): garder uniquement les phrases multi-mots exclusivement anglaises ("opening hours", "closed on", "reviews", "rated X", "worth a visit", etc.) — jamais de mots ambigus comme "restaurant" ou "open".

## Blockers
- None

## Files modified
- web/client/src/lib/enrichment/search.ts — areAllEnginesSuspended()
- web/client/src/lib/enrichment/enricher.ts — enrichBatch LLM path + no-LLM path
- web/client/src/components/PoiList.tsx — new URL() guard
- web/client/src/lib/enrichment/llm.ts — looksLikeTargetLanguage()
