import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/middleware/rateLimiter.ts'],
      exclude: ['node_modules/', 'dist/', '**/*.d.ts'],
      thresholds: {
        global: {
          statements: 95,
          branches: 95,
          functions: 95,
          lines: 95
        }
      }
    }
  }
});
