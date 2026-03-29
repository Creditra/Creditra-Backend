'use strict';

module.exports = {
  root: true,
  env: {
    node: true,
    es2022: true,
  },
  parser: '@typescript-eslint/parser',
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
    project: './tsconfig.json',
  },
  plugins: ['@typescript-eslint'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
  ],
  rules: {
    // Enforce explicit return types on functions (good for service contracts)
    '@typescript-eslint/explicit-function-return-type': 'off',

    // Disallow unused variables except those prefixed with _
    '@typescript-eslint/no-unused-vars': [
      'error',
      { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
    ],

    // Allow explicit `any` with a warning instead of hard error (relax for now)
    '@typescript-eslint/no-explicit-any': 'warn',

    // Enforce consistent type imports
    '@typescript-eslint/consistent-type-imports': [
      'error',
      { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
    ],

    // No floating promises — important for async route handlers
    '@typescript-eslint/no-floating-promises': 'error',

    // Disallow require() in ESM codebase
    '@typescript-eslint/no-require-imports': 'error',
  },
  ignorePatterns: [
    'dist/',
    'node_modules/',
    'coverage/',
    '*.cjs',        // ignore this file itself
  ],
};
