// --- Server-proxy fetch helpers ---

/** The server, same origin: Vite proxies it in dev, nginx in production */
export const API_BASE = "/api";

/** Timeout for search/geocode requests (ms) */
export const REQUEST_TIMEOUT = 15_000;

/**
 * JSON fetch helper: GET (no body) or POST JSON; null on any failure.
 * Shared by the proxy-endpoint wrappers.
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

/** Combine an optional caller signal with a timeout. */
export function timeoutSignal(ms: number, signal?: AbortSignal): AbortSignal {
  return signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
}
