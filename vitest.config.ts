import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'istanbul',
      include: [
        'src/models/AuditLog.ts',
        'src/repositories/interfaces/AuditLogRepository.ts',
        'src/repositories/memory/InMemoryAuditLogRepository.ts',
        'src/routes/audit.ts',
        'src/services/AuditLogService.ts'
      ],
      exclude: [
        'src/index.ts',
        'src/**/__test__/**',
        'src/**/*.test.ts'
      ],
      reporter: ['text', 'lcov'],
      thresholds: {
        statements: 95,
        branches: 95,
        functions: 95,
        lines: 95,
      },
    },
  },
});
