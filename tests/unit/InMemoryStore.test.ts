import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { InMemoryStore } from '../../src/middleware/stores/InMemoryStore.js';

describe('InMemoryStore', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  afterEach(() => {
    store.destroy();
  });

  describe('Specific Examples', () => {
    it('should create new window with count 1 on first increment', async () => {
      const result = await store.increment('test-key', 60000);

      expect(result.count).toBe(1);
      expect(result.resetAt).toBeGreaterThan(Date.now());
      expect(result.resetAt).toBeLessThanOrEqual(Date.now() + 60000);
    });

    it('should increment count for multiple increments within window', async () => {
      const windowMs = 60000;
      
      const result1 = await store.increment('test-key', windowMs);
      expect(result1.count).toBe(1);

      const result2 = await store.increment('test-key', windowMs);
      expect(result2.count).toBe(2);

      const result3 = await store.increment('test-key', windowMs);
      expect(result3.count).toBe(3);

      // All should have the same resetAt timestamp
      expect(result2.resetAt).toBe(result1.resetAt);
      expect(result3.resetAt).toBe(result1.resetAt);
    });

    it('should create new window when previous window expires', async () => {
      const windowMs = 100; // Short window for testing
      
      const result1 = await store.increment('test-key', windowMs);
      expect(result1.count).toBe(1);

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, windowMs + 10));

      const result2 = await store.increment('test-key', windowMs);
      expect(result2.count).toBe(1); // Should reset to 1
      expect(result2.resetAt).toBeGreaterThan(result1.resetAt);
    });
  });

  describe('get() method', () => {
    it('should return null for non-existent key', async () => {
      const count = await store.get('non-existent');
      expect(count).toBeNull();
    });

    it('should return current count for valid key', async () => {
      await store.increment('test-key', 60000);
      await store.increment('test-key', 60000);
      await store.increment('test-key', 60000);

      const count = await store.get('test-key');
      expect(count).toBe(3);
    });

    it('should return null for expired entry', async () => {
      const windowMs = 100;
      await store.increment('test-key', windowMs);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, windowMs + 10));

      const count = await store.get('test-key');
      expect(count).toBeNull();
    });
  });

  describe('reset() method', () => {
    it('should remove entry from store', async () => {
      await store.increment('test-key', 60000);
      
      let count = await store.get('test-key');
      expect(count).toBe(1);

      await store.reset('test-key');

      count = await store.get('test-key');
      expect(count).toBeNull();
    });

    it('should not throw error when resetting non-existent key', async () => {
      await expect(store.reset('non-existent')).resolves.toBeUndefined();
    });
  });

  describe('cleanup() method', () => {
    it('should remove expired entries and return count', async () => {
      const windowMs = 100;
      
      // Create multiple entries with short window
      await store.increment('key1', windowMs);
      await store.increment('key2', windowMs);
      await store.increment('key3', windowMs);

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, windowMs + 10));

      const cleaned = await store.cleanup();
      expect(cleaned).toBe(3);

      // Verify entries are gone
      expect(await store.get('key1')).toBeNull();
      expect(await store.get('key2')).toBeNull();
      expect(await store.get('key3')).toBeNull();
    });

    it('should not remove non-expired entries', async () => {
      await store.increment('key1', 100); // Short window
      await store.increment('key2', 60000); // Long window

      // Wait for key1 to expire but not key2
      await new Promise(resolve => setTimeout(resolve, 150));

      const cleaned = await store.cleanup();
      expect(cleaned).toBe(1);

      expect(await store.get('key1')).toBeNull();
      expect(await store.get('key2')).toBe(1);
    });

    it('should return 0 when no entries to clean', async () => {
      const cleaned = await store.cleanup();
      expect(cleaned).toBe(0);
    });

    it('should handle cleanup at exact boundary timestamp', async () => {
      const windowMs = 100;
      await store.increment('test-key', windowMs);

      // Wait exactly for window to expire
      await new Promise(resolve => setTimeout(resolve, windowMs));

      const cleaned = await store.cleanup();
      expect(cleaned).toBeGreaterThanOrEqual(1);
    });
  });

  describe('destroy() method', () => {
    it('should clear cleanup interval and store', async () => {
      await store.increment('key1', 60000);
      await store.increment('key2', 60000);

      store.destroy();

      // After destroy, store should be empty
      expect(await store.get('key1')).toBeNull();
      expect(await store.get('key2')).toBeNull();
    });

    it('should allow multiple destroy calls without error', () => {
      expect(() => {
        store.destroy();
        store.destroy();
      }).not.toThrow();
    });
  });

  describe('Edge Cases', () => {
    it('should handle very large counts', async () => {
      const windowMs = 60000;
      const iterations = 10000;

      for (let i = 0; i < iterations; i++) {
        await store.increment('test-key', windowMs);
      }

      const count = await store.get('test-key');
      expect(count).toBe(iterations);
    });

    it('should handle multiple keys independently', async () => {
      await store.increment('key1', 60000);
      await store.increment('key1', 60000);
      await store.increment('key2', 60000);
      await store.increment('key3', 60000);
      await store.increment('key3', 60000);
      await store.increment('key3', 60000);

      expect(await store.get('key1')).toBe(2);
      expect(await store.get('key2')).toBe(1);
      expect(await store.get('key3')).toBe(3);
    });

    it('should handle rapid successive increments', async () => {
      const windowMs = 60000;
      const promises = [];

      // Simulate concurrent requests
      for (let i = 0; i < 100; i++) {
        promises.push(store.increment('test-key', windowMs));
      }

      await Promise.all(promises);

      const count = await store.get('test-key');
      expect(count).toBe(100);
    });

    it('should handle keys with special characters', async () => {
      const specialKeys = [
        'key:with:colons',
        'key/with/slashes',
        'key-with-dashes',
        'key_with_underscores',
        'key.with.dots',
        '192.168.1.1:/api/endpoint',
      ];

      for (const key of specialKeys) {
        await store.increment(key, 60000);
      }

      for (const key of specialKeys) {
        expect(await store.get(key)).toBe(1);
      }
    });

    it('should handle very short windows', async () => {
      const windowMs = 10; // 10ms window
      
      const result1 = await store.increment('test-key', windowMs);
      expect(result1.count).toBe(1);

      await new Promise(resolve => setTimeout(resolve, windowMs + 5));

      const result2 = await store.increment('test-key', windowMs);
      expect(result2.count).toBe(1); // Should reset
    });

    it('should handle very long windows', async () => {
      const windowMs = 24 * 60 * 60 * 1000; // 24 hours
      
      const result = await store.increment('test-key', windowMs);
      expect(result.count).toBe(1);
      expect(result.resetAt).toBeGreaterThan(Date.now() + 23 * 60 * 60 * 1000);
    });
  });

  describe('Automatic Cleanup Interval', () => {
    it('should automatically clean up expired entries', async () => {
      // Create store with fast cleanup interval
      const fastStore = new InMemoryStore(50); // 50ms cleanup interval
      
      const windowMs = 100;
      await fastStore.increment('key1', windowMs);
      await fastStore.increment('key2', windowMs);

      // Wait for entries to expire and cleanup to run
      await new Promise(resolve => setTimeout(resolve, windowMs + 100));

      // Entries should be cleaned up automatically
      expect(await fastStore.get('key1')).toBeNull();
      expect(await fastStore.get('key2')).toBeNull();

      fastStore.destroy();
    });

    it('should use default cleanup interval of 60 seconds', () => {
      const defaultStore = new InMemoryStore();
      // Just verify it doesn't throw
      expect(defaultStore).toBeDefined();
      defaultStore.destroy();
    });
  });

  describe('Error Conditions', () => {
    it('should handle empty string keys', async () => {
      const result = await store.increment('', 60000);
      expect(result.count).toBe(1);
      expect(await store.get('')).toBe(1);
    });

    it('should handle zero window duration', async () => {
      const result = await store.increment('test-key', 0);
      expect(result.count).toBe(1);
      
      // Window expires immediately
      const count = await store.get('test-key');
      expect(count).toBeNull();
    });

    it('should handle negative window duration', async () => {
      const result = await store.increment('test-key', -1000);
      expect(result.count).toBe(1);
      
      // Window is already expired
      const count = await store.get('test-key');
      expect(count).toBeNull();
    });
  });

  describe('Memory Management', () => {
    it('should not leak memory with many expired entries', async () => {
      const windowMs = 50;
      
      // Create many entries that will expire
      for (let i = 0; i < 1000; i++) {
        await store.increment(`key-${i}`, windowMs);
      }

      // Wait for expiration
      await new Promise(resolve => setTimeout(resolve, windowMs + 10));

      // Cleanup should remove all entries
      const cleaned = await store.cleanup();
      expect(cleaned).toBe(1000);
    });

    it('should handle mixed expired and active entries', async () => {
      // Create some entries with short window
      await store.increment('short1', 50);
      await store.increment('short2', 50);
      
      // Create some entries with long window
      await store.increment('long1', 60000);
      await store.increment('long2', 60000);

      // Wait for short windows to expire
      await new Promise(resolve => setTimeout(resolve, 100));

      const cleaned = await store.cleanup();
      expect(cleaned).toBe(2);

      // Long window entries should still exist
      expect(await store.get('long1')).toBe(1);
      expect(await store.get('long2')).toBe(1);
    });
  });
});
