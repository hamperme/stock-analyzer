interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

class MemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();

  set<T>(key: string, data: T, ttlMs: number): void {
    this.store.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.data as T;
  }

  delete(key: string): void {
    this.store.delete(key);
  }

  clear(): void {
    this.store.clear();
  }
}

// Singleton cache shared across API routes in the same Node.js process
export const cache = new MemoryCache();

export const TTL = {
  QUOTE: 60_000,          // 1 minute
  HISTORY: 5 * 60_000,    // 5 minutes
  NEWS: 10 * 60_000,      // 10 minutes
  FEAR_GREED: 15 * 60_000,// 15 minutes
  ANALYSIS: 30 * 60_000,  // 30 minutes
  INDICES: 60_000,        // 1 minute
};
