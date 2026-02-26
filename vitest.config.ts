import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "lcov"],
      include: [
        "src/db/migrations.ts",
        "src/db/validate-schema.ts",
        "src/health/healthService.ts",
        "src/health/healthRouter.ts",
        "src/health/checks/database.ts",
        "src/health/checks/horizon.ts",
        "src/health/checks/redis.ts",
        "src/health/checks/riskEngine.ts",
      ],
      exclude: [
        "src/db/**/*.test.ts",
        "src/db/migrate-cli.ts",
        "src/db/validate-cli.ts",
        "src/db/client.ts",
        "src/health/__tests__/**",
      ],
      thresholds: {
        lines: 95,
        functions: 95,
        branches: 95,
        statements: 95,
      },
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
});
