module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
  transform: {
    '^.+\\.tsx?$': ['ts-jest', {
      useESM: true,
      tsconfig: {
        isolatedModules: true,
      },
    }],
  },
  collectCoverage: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/models/AuditLog.ts',
    'src/repositories/interfaces/AuditLogRepository.ts',
    'src/repositories/memory/InMemoryAuditLogRepository.ts',
    'src/routes/audit.ts',
    'src/services/AuditLogService.ts'
  ],
  coverageThreshold: {
    global: {
      lines: 95,
      functions: 95,
      branches: 95,
      statements: 95,
    },
  },
};
