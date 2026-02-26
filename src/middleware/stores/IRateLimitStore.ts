/**
 * Abstract interface defining storage operations for rate limit tracking.
 * This interface allows swapping implementations (in-memory, Redis, etc.)
 * without changing middleware logic.
 */
export interface IRateLimitStore {
  /**
   * Increment the request count for a key within a time window.
   * If the key doesn't exist or the window has expired, creates a new window.
   * 
   * @param key - Unique identifier (e.g., "ip:endpoint")
   * @param windowMs - Time window duration in milliseconds
   * @returns Current count after increment and window reset timestamp
   */
  increment(key: string, windowMs: number): Promise<{ count: number; resetAt: number }>;

  /**
   * Get current request count for a key.
   * Returns null if the key doesn't exist or the window has expired.
   * 
   * @param key - Unique identifier
   * @returns Current count or null if not found/expired
   */
  get(key: string): Promise<number | null>;

  /**
   * Reset the request count for a key.
   * Removes the key from the store.
   * 
   * @param key - Unique identifier
   */
  reset(key: string): Promise<void>;

  /**
   * Clean up expired entries from the store.
   * This prevents memory leaks by removing entries whose time windows have expired.
   * 
   * @returns Number of entries cleaned up
   */
  cleanup(): Promise<number>;
}
