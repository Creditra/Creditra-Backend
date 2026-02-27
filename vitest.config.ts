import { defineConfig } from 'vitest/config';
import { resolve } from 'path';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',

    include: [
      'src/**/*.test.ts',
      'src/**/__tests__/**/*.test.ts',
    ],

    coverage: {
      provider: 'v8',

      reporter: ['text', 'lcov', 'html'],

      include: [
        'src/**/*.ts',
      ],

      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        'vitest.config.ts',

        // DB exclusions
        'src/db/**/*.test.ts',
        'src/db/migrate-cli.ts',
        'src/db/validate-cli.ts',
        'src/db/client.ts',

        // Risk exclusions
        'src/risk/__tests__/**',
        'src/risk/types.ts',
        'src/risk/index.ts',

        // Entry file
        'src/index.ts',
      ],

      thresholds: {
        global: {
          branches: 95,
          functions: 95,
          lines: 95,
          statements: 95,
        },
      },
    },
  },
});