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
  testMatch: [
    "**/tests/**/*.test.ts",
    "**/src/**/*.test.ts"
  ],
  testPathIgnorePatterns: [
    "/node_modules/",
    "/dist/"
  ],
  collectCoverage: true,
  coverageDirectory: 'coverage',
  collectCoverageFrom: [
    'src/models/AuditLog.ts',
    'src/repositories/interfaces/AuditLogRepository.ts',
    'src/repositories/memory/InMemoryAuditLogRepository.ts',
    'src/routes/audit.ts',
    'src/services/AuditLogService.ts',
    'src/data/creditLines.ts',
    'src/routes/credit.ts',
    'src/utils/paginate.ts'
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
