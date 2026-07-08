import { Injectable, Logger } from '@nestjs/common';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

/**
 * Small typed in-memory TTL cache for aggregate dashboard queries
 * (summary counters, spatial slices) so refreshes don't hammer the
 * database. The interface is deliberately Redis-shaped: swap the Map
 * for a Redis client when the platform runs on multiple instances.
 */
@Injectable()
export class TtlCacheService {
  private readonly logger = new Logger(TtlCacheService.name);
  private readonly store = new Map<string, CacheEntry<unknown>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
  }

  /**
   * Read-through helper: returns the cached value or produces, caches
   * and returns a fresh one.
   */
  async getOrSet<T>(
    key: string,
    ttlMs: number,
    producer: () => Promise<T>,
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== undefined) return cached;
    const fresh = await producer();
    this.set(key, fresh, ttlMs);
    return fresh;
  }

  /** Cache busting: drops every key starting with the given prefix. */
  invalidatePrefix(prefix: string): void {
    let dropped = 0;
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
        dropped += 1;
      }
    }
    if (dropped > 0) {
      this.logger.debug(`Invalidated ${dropped} cache entries for "${prefix}"`);
    }
  }
}
