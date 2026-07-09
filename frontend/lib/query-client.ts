import { QueryClient } from '@tanstack/react-query';
import { ApiError, ApiResult } from './api';

/**
 * Thrown by `unwrap()` so failed requests surface through TanStack
 * Query's normal `error`/`isError` state instead of the `ApiResult`
 * union — while keeping the full bilingual `ApiError` payload intact
 * for callers that need `error.code` or `messageAr`.
 */
export class ApiRequestError extends Error {
  constructor(public readonly apiError: ApiError) {
    super(apiError.message);
    this.name = 'ApiRequestError';
  }
}

/** Query/mutation fn adapter: unwraps `ApiResult`, throwing on failure. */
export async function unwrap<T>(promise: Promise<ApiResult<T>>): Promise<T> {
  const result = await promise;
  if (result.ok) return result.data;
  throw new ApiRequestError(result.error);
}

/** Normalizes anything a query/mutation can throw back into an `ApiError`. */
export function toApiError(error: unknown): ApiError {
  if (error instanceof ApiRequestError) return error.apiError;
  return {
    status: 0,
    code: 'UNKNOWN_ERROR',
    message: error instanceof Error ? error.message : 'The request failed',
  };
}

/**
 * One retry for flaky network blips — not TanStack's default of 3.
 * This backend runs on a single pooled DB connection, so retrying a
 * timed-out request 3x just piles more load on the same bottleneck.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 60_000,
        retry: 1,
        refetchOnWindowFocus: false,
      },
      mutations: {
        retry: 0,
      },
    },
  });
}
