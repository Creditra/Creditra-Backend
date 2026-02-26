import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/__tests__/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/risk/**'],
      exclude: [
        'src/risk/__tests__/**',
        
        'src/risk/types.ts',   // interfaces only — no runtime statements
        'src/risk/index.ts',   // barrel re-exports only — no runtime logic
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
      reporter: ['text', 'lcov'],
    },
  },
});