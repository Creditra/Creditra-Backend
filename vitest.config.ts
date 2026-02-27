import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov', 'json', 'html'],
      include: [
        'src/db/migrations.ts',
        'src/db/validate-schema.ts',
        'src/db/riskEvaluationRepository.ts',
        'src/services/riskService.ts',
        'src/routes/risk.ts'
      ],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.d.ts',
        'vitest.config.ts',
        'src/db/**/*.test.ts',
        'src/db/migrate-cli.ts',
        'src/db/validate-cli.ts',
        'src/db/client.ts'
      ],
      thresholds: {
        global: {
          branches: 95,
          functions: 95,
          lines: 95,
          statements: 95
        }
      }
    }
  }
});
