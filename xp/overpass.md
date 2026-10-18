# Track overpass: report (2026-10-18)

Branch `autoresearch/overpass-oct18`, 14 experiments, score 3769 to 1534 (lower is better), all 10 E5b scenarios green.

| Scenario (proxy / static) | Baseline | Now |
|---|---|---|
| healthy | 47 s / 47 s | 47 s / 26 s |
| flaky (30 % of answers 5xx) | 49 s / 88 s | 49 s / 38 s |
| outage of 4 min | 399 s, 136 requests / **gave up at 208 s: click** | 287 s, 35 requests / 284 s, 23 requests |
| overpass-api.de down | 57 s / 83 s | 57 s / 38 s |
| dense city | **45 % of POIs silently lost** | 306 s / 156 s, nothing lost |

## Kept

1. A 200 carrying a `runtime error` remark is a failure (Overpass's answer to a timed-out query; it was taken as an empty result).
2. An 8-minute retry budget instead of 3 rounds: an outage passes with no click.
3. A timed-out chunk is split in four and retried at once, without backoff (too heavy, not a sick server).
4. Only a too-heavy failure (remark, 504) splits; a 5xx retries the same chunk.
5. Static build: stick to the mirror that answers.
6. Circuit breaker: the first server failure ends the round, the rest waits for the backoff.
7. Backoff 10, 20, then 30 s.
8. Static build: 2 chunks at a time (Overpass allows 2 slots per IP). Found two races on the way: double mirror rotation, silent abort.

## Discarded

Backoff from 5 s (worse), breaker after 2 failures (worse), halves instead of quarters (worse), 60-point chunks (a harness artifact: the chunk boundaries moved against the synthetic city).

## Merge-ready (outside the loop)

- Server: a runtime error remark becomes an uncached 504 (it was cached 24 h as a valid answer). Regression test in `server.test.ts`.
- UI: the "retry failed chunks" button is gone; the warning remains after 8 min of failure.
- Docs: AGENTS.md pipeline line, architecture.md.

## Not measured by this harness (next version)

The server's queue counts against its 180 s deadline (2 client requests in parallel through the proxy would 504); server-side mirror memory; a proxy-to-direct fallback when the server is down; cities at several offsets so chunk boundaries cannot game the score.
