<<<<<<< HEAD
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
        'airbnb-typescript/base',
      ],
      rules: {
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
        '@typescript-eslint/quotes': ['error', 'double'],
        'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
        'import/extensions': 'off',
        '@typescript-eslint/no-explicit-any': 'off',
        '@typescript-eslint/naming-convention': [
          'error',
          {
            selector: 'variableLike',
            format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
            leadingUnderscore: 'allow',
          },
        ],
        'node/no-missing-import': 'off',
        'indent': 'off',
        '@typescript-eslint/indent': 'off',
      },
      overrides: [
        {
          files: ['**/*.test.ts'],
          rules: {
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
          },
        },
      ],
      ignorePatterns: ['dist/', 'node_modules/', 'coverage/', 'build/'],
    es2021: true,
    jest: true,
  },
  plugins: ['@typescript-eslint', 'import', 'node', 'promise'],
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'airbnb-typescript/base',
  ],
  rules: {
    '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    '@typescript-eslint/quotes': ['error', 'double'],
    'import/no-extraneous-dependencies': ['error', { devDependencies: true }],
    'import/extensions': 'off',
    '@typescript-eslint/no-explicit-any': 'off',
    '@typescript-eslint/naming-convention': [
      'error',
      {
        selector: 'variableLike',
        format: ['camelCase', 'PascalCase', 'UPPER_CASE'],
        leadingUnderscore: 'allow',
      },
    ],
    'node/no-missing-import': 'off',
    'indent': 'off',
    '@typescript-eslint/indent': 'off',
  },
  overrides: [
    {
      files: ['**/*.test.ts'],
      rules: {
        '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      },
    },
  ],
  ignorePatterns: ['dist/', 'node_modules/', 'coverage/', 'build/'],
>>>>>>> 4e2f84e (chore: configure ESLint for backend TypeScript)
};
