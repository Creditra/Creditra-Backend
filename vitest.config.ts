import { defineConfig } from 'vitest/config';
import { resolve } from 'path';
import { existsSync } from 'fs';

// Custom plugin to resolve .js imports to .ts files
function resolveJsToTs() {
  return {
    name: 'resolve-js-to-ts',
    resolveId(id: string, importer?: string) {
      if (id.endsWith('.js') && importer) {
        const tsPath = id.replace(/\.js$/, '.ts');
        const resolvedPath = resolve(importer, '..', tsPath);
        if (existsSync(resolvedPath)) {
          return resolvedPath;
        }
      }
      return null;
    }
  };
}

export default defineConfig({
  plugins: [resolveJsToTs()],
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      include: ['src/db/migrations.ts', 'src/db/validate-schema.ts', 'src/services/creditService.ts', 'src/routes/credit.ts'],
      exclude: ['src/db/**/*.test.ts', 'src/db/migrate-cli.ts', 'src/db/validate-cli.ts', 'src/db/client.ts'],
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
      '@': resolve(__dirname, 'src'),
    },
  },
  esbuild: {
    target: 'node18'
  }
});
