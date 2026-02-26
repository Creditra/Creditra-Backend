import { IRateLimitStore } from './IRateLimitStore.js';

/**
 * In-memory implementation of IRateLimitStore using a Map.
 * Provides automatic cleanup of expired entries to prevent memory leaks.
 * 
 * Storage format: Map<string, { count: number; resetAt: number }>
 * - count: Current request count in the time window
 * - resetAt: Timestamp (ms) when the window expires
 */
export class InMemoryStore implements IRateLimitStore {
  private store: Map<string, { count: number; resetAt: number }>;
  private cleanupInterval: NodeJS.Timeout | null;

  /**
   * Creates a new InMemoryStore with automatic cleanup.
   * 
   * @param cleanupIntervalMs - Interval in milliseconds for automatic cleanup (default: 60000ms = 1 minute)
   */
  constructor(cleanupIntervalMs: number = 60000) {
    this.store = new Map();
    this.cleanupInterval = null;
    this.startCleanup(cleanupIntervalMs);
  }

  /**
   * Increment the request count for a key within a time window.
   * If the key doesn't exist or the window has expired, creates a new window.
   * 
   * @param key - Unique identifier (e.g., "ip:endpoint")
   * @param windowMs - Time window duration in milliseconds
   * @returns Current count after increment and window reset timestamp
   */
  async increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }> {
    const now = Date.now();
    const entry = this.store.get(key);

    // Check if entry exists and is not expired
    if (!entry || entry.resetAt <= now) {
      // Create new window
      const resetAt = now + windowMs;
      this.store.set(key, { count: 1, resetAt });
      return { count: 1, resetAt };
    }

    // Increment existing window
    entry.count++;
    this.store.set(key, entry);
    return { count: entry.count, resetAt: entry.resetAt };
  }

  /**
   * Get current request count for a key.
   * Returns null if the key doesn't exist or the window has expired.
   * 
   * @param key - Unique identifier
   * @returns Current count or null if not found/expired
   */
  async get(key: string): Promise<number | null> {
    const entry = this.store.get(key);
    
    // Return null if entry doesn't exist or is expired
    if (!entry || entry.resetAt <= Date.now()) {
      return null;
    }
    
    return entry.count;
  }

  /**
   * Reset the request count for a key.
   * Removes the key from the store.
   * 
   * @param key - Unique identifier
   */
  async reset(key: string): Promise<void> {
    this.store.delete(key);
  }

  /**
   * Clean up expired entries from the store.
   * Iterates through all entries and removes those whose time windows have expired.
   * 
   * @returns Number of entries cleaned up
   */
  async cleanup(): Promise<number> {
    const now = Date.now();
    let cleaned = 0;

    for (const [key, entry] of this.store.entries()) {
      if (entry.resetAt <= now) {
        this.store.delete(key);
        cleaned++;
      }
    }

    return cleaned;
  }

  /**
   * Start automatic cleanup interval.
   * Runs cleanup() periodically to prevent memory leaks.
   * 
   * @param intervalMs - Interval in milliseconds between cleanup runs
   */
  private startCleanup(intervalMs: number): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, intervalMs);
    
    // Prevent the interval from keeping the process alive
    if (this.cleanupInterval.unref) {
      this.cleanupInterval.unref();
    }
  }

  /**
   * Destroy the store and clean up resources.
   * Clears the cleanup interval and removes all entries.
   * Should be called when the store is no longer needed.
   */
  destroy(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
    this.store.clear();
  }
}
