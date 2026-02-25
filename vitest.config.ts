import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        globals: false,
        environment: 'node',
        include: ['tests/**/*.test.ts'],
        coverage: {
            provider: 'v8',
            include: ['src/errors/**', 'src/middleware/**'],
            thresholds: {
                statements: 95,
                branches: 95,
                functions: 95,
                lines: 95,
            },
        },
    },
});
