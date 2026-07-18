// ---------------------------------------------------------------------------
// Concurrent queue with stagger
// ---------------------------------------------------------------------------

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Run async tasks with controlled concurrency and stagger delay.
 * Each new task launch is staggered by `staggerMs` to spread rate-limit pressure.
 */
export async function runConcurrent<T>(
  items: T[],
  concurrency: number,
  staggerMs: number,
  signal: AbortSignal | undefined,
  fn: (item: T) => Promise<void>,
): Promise<void> {
  let nextIndex = 0;
  const running = new Set<Promise<void>>();

  function startNext(): void {
    if (signal?.aborted || nextIndex >= items.length) return;
    const idx = nextIndex++;
    const p = fn(items[idx]).finally(() => running.delete(p));
    running.add(p);
  }

  // Launch initial batch with stagger
  while (nextIndex < items.length && running.size < concurrency) {
    if (signal?.aborted) break;
    startNext();
    if (nextIndex < items.length && running.size < concurrency && staggerMs > 0) {
      await sleep(staggerMs);
    }
  }

  // As tasks complete, launch next with stagger
  while (running.size > 0) {
    if (signal?.aborted) break;
    await Promise.race(running);
    if (nextIndex < items.length && !signal?.aborted) {
      if (staggerMs > 0) await sleep(staggerMs);
      startNext();
    }
  }
}
