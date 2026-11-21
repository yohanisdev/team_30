import js from '@eslint/js';
import { defineConfig } from 'eslint/config';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'backend/src/generated/**',
      'backend/storage/**',
      'frontend/playwright-report/**',
      'frontend/test-results/**',
      'docs/**',
    ],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    files: ['backend/**/*.ts', 'packages/**/*.ts', '*.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['frontend/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { fixStyle: 'inline-type-imports' }],
      'no-console': ['warn', { allow: ['warn', 'error'] }],
    },
  },
  {
    // Command-line scripts report progress on stdout.
    files: ['backend/prisma/**/*.ts', 'backend/tests/global-setup.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // The assistant may call the catalog service. It may not touch the database or other modules.
    files: ['backend/src/modules/assistant/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/lib/prisma*',
                '**/generated/prisma/**',
                '@prisma/client',
                '@prisma/adapter-pg',
                'pg',
              ],
              message: 'The assistant cannot access the database. Call the catalog service.',
            },
            {
              group: [
                '**/modules/identity/**',
                '**/modules/admin/**',
                '**/modules/merchant/**',
                '**/modules/cart/**',
                '**/modules/audit/**',
              ],
              message: 'The assistant may only use the public catalog service.',
            },
          ],
        },
      ],
    },
  },
);
