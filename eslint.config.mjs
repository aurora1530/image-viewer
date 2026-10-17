import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import prettier from 'eslint-config-prettier/flat';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig(
  globalIgnores([
    'node_modules/',
    'dist/',
    'dist-ssr/',
    'release/',
    'coverage/',
    'test-results/',
    'playwright-report/',
  ]),
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    extends: [js.configs.recommended],
  },
  {
    files: ['electron/**/*.cjs', 'scripts/**/*.mjs', '*.{js,mjs,cjs,ts}'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['tests/**/*.ts'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: {
        // One explicit project covers application code, tests and tool configs.
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: {
      // Test doubles implement Promise/iterator contracts without real I/O.
      '@typescript-eslint/require-await': 'off',
      'require-yield': 'off',
      // Assertions inspect spy functions; they do not call them without a receiver.
      '@typescript-eslint/unbound-method': 'off',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [reactHooks.configs.flat.recommended],
    rules: { 'react-hooks/exhaustive-deps': 'error' },
  },
  {
    files: ['src/features/**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/services/**', '**/platform/**', '**/app/create*'],
              message:
                'Features use the application context and ports; composition and infrastructure belong to app/.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/app/create*.ts', 'src/app/store.ts', 'src/app/ports.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/features/**', 'react', 'react-dom', 'react-dom/**'],
              message: 'Application services must not depend on React or feature components.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/{services,platform,shared}/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/app/**',
                '**/features/**',
                'react',
                'react-dom',
                'react-dom/**',
                'zustand',
                'zustand/**',
              ],
              message:
                'Infrastructure and shared modules must not depend on application state or React.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                '**/app/**',
                '**/features/**',
                '**/services/**',
                '**/platform/**',
                'react',
                'react-dom',
                'react-dom/**',
                'zustand',
                'zustand/**',
              ],
              message: 'Shared models and helpers must remain independent of upper layers.',
            },
          ],
        },
      ],
    },
  },
  prettier,
);
