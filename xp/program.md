# autoresearch: Ravitools

Adapted from [karpathy/autoresearch](https://github.com/karpathy/autoresearch): a read-only harness, one editable surface, a scalar score, short runs, keep or discard.

## Setup

- Branch `autoresearch/<track>-<date>` from `designV2`, checked out in a git worktree so resets never touch the main checkout. Never commit to `designV2`, `dev` or `main`.
- `results.tsv` at the worktree root, untracked, tab-separated: `commit	score	status	description`.

## Tracks

| Track | Harness (read-only) | Editable surface | Score (lower is better) |
|---|---|---|---|
| overpass | `web/client/src/__tests__/overpass-faults.test.ts` | `web/client/src/lib/overpass.ts` | Sum over runs of virtual seconds + 900 × missing POI fraction + 2 × upstream requests |
| ux | after the designV2 shell exists (E6 to E8) | `index.css`, shell components | friction score |

Run (overpass): `cd web/client && VITE_XP_SCORE=1 bunx vitest run src/__tests__/overpass-faults.test.ts > ../../run.log 2>&1; grep "^xp_" ../../run.log`

## Loop

1. One idea, edited in the surface only.
2. `git commit -m "xp: <idea>"`.
3. Run, read `xp_score`. A crash or a typecheck/lint error is a `crash` row.
4. Keep when the score drops and typecheck, lint and the other tests stay green (the harness's own assertions may still fail while scenarios do). Otherwise `git reset --hard HEAD~1`.
5. Log the row either way.

Stop a track after 5 consecutive runs without a gain, then write `xp/<track>.md`: kept commits, what failed, what to merge.

## Rules

AGENTS.md applies in full: no new dependency, no `biome-ignore`, zero warning, no em-dashes, the only timers are the approved async sleeps of `lib/overpass.ts`. Simplicity wins ties: an equal score with less code is a keep, a tiny gain that adds ugly code is a discard.
