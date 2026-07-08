'use client';

import * as React from 'react';
import { ApiResult } from './api';

interface CacheEntry {
  value: unknown;
  storedAt: number;
}

/** Module-level cache survives route changes within the SPA session. */
const cache = new Map<string, CacheEntry>();

const DEFAULT_MAX_AGE_MS = 5 * 60 * 1000;

export function invalidateCached(prefix: string): void {
  for (const key of cache.keys()) {
    if (key.startsWith(prefix)) cache.delete(key);
  }
}

interface UseCachedResult<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Bypass the cache and refetch now (e.g. after a mutation). */
  refresh: () => Promise<void>;
}

/**
 * Stale-while-revalidate data hook: cached data renders instantly on
 * screen switches while a background revalidation keeps it fresh —
 * no external data library needed.
 */
export function useCached<T>(
  key: string,
  fetcher: () => Promise<ApiResult<T>>,
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): UseCachedResult<T> {
  const cached = cache.get(key);
  const initial =
    cached && Date.now() - cached.storedAt < maxAgeMs
      ? (cached.value as T)
      : null;

  const [data, setData] = React.useState<T | null>(initial);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(initial === null);

  const fetcherRef = React.useRef(fetcher);
  fetcherRef.current = fetcher;

  // Out-of-order guard: only the latest request may land.
  const requestIdRef = React.useRef(0);

  const revalidate = React.useCallback(
    async (showSpinner: boolean): Promise<void> => {
      const requestId = ++requestIdRef.current;
      if (showSpinner) setLoading(true);
      const result = await fetcherRef.current();
      if (requestIdRef.current !== requestId) return;

      if (result.ok) {
        cache.set(key, { value: result.data, storedAt: Date.now() });
        setData(result.data);
        setError(null);
      } else {
        setError(result.error.message);
      }
      setLoading(false);
    },
    [key],
  );

  React.useEffect(() => {
    const entry = cache.get(key);
    const fresh = entry && Date.now() - entry.storedAt < maxAgeMs;
    if (fresh) {
      setData(entry.value as T);
      setLoading(false);
      // Stale-while-revalidate: serve instantly, refresh silently.
      void revalidate(false);
    } else {
      setData(null);
      void revalidate(true);
    }
  }, [key, maxAgeMs, revalidate]);

  const refresh = React.useCallback(async (): Promise<void> => {
    cache.delete(key);
    await revalidate(true);
  }, [key, revalidate]);

  return { data, error, loading, refresh };
}
