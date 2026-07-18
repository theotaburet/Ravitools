// ---------------------------------------------------------------------------
// Server-proxy fetch helpers shared by the enrichment adapters
// ---------------------------------------------------------------------------

/** Timeout for search/geocode requests (ms) */
export const REQUEST_TIMEOUT = 15_000;

/**
 * JSON fetch helper — GET (no body) or POST JSON; null on any failure.
 * Shared by the proxy-endpoint wrappers (AUDIT R32).
 */
export async function fetchJson<T>(
  url: string,
  opts: { body?: unknown; signal?: AbortSignal } = {},
): Promise<T | null> {
  try {
    const res = await fetch(url, {
      method: opts.body !== undefined ? "POST" : "GET",
      headers: opts.body !== undefined ? { "Content-Type": "application/json" } : undefined,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

/** Combine an optional caller signal with a timeout (AUDIT R25). */
export function timeoutSignal(ms: number, signal?: AbortSignal): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
}
