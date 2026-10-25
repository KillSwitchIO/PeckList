import js from '@eslint/js';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist', '**/dev-dist', '**/coverage', '**/node_modules', 'CHANGELOG.md'] },
  js.configs.recommended,
  ...tseslint.configs.strict,
  {
    // noUncheckedIndexedAccess makes every index access optional; a `!` after an explicit
    // bounds check is the clearest way to say "this exists".
    rules: { '@typescript-eslint/no-non-null-assertion': 'off' },
  },
  {
    files: ['web/src/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
    plugins: { 'react-hooks': reactHooks, 'react-refresh': reactRefresh },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },
  {
    // Ports and adapters: the domain core stays free of UI libraries and adapters.
    files: ['web/src/core/**/*.ts'],
    ignores: ['web/src/**/*.test.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['react', 'react-*', '@mui/*', '@emotion/*'],
              message: 'core must not depend on UI libraries',
            },
            {
              group: ['**/adapters/**', '**/app/**'],
              message: 'core must not import adapters or UI',
            },
            {
              group: ['idb', 'ulid', 'ajv', 'zustand'],
              message: 'core reaches libraries through ports',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.{mjs,ts}'],
    ignores: ['web/src/**'],
    languageOptions: { globals: globals.node },
  },
  // Scripts the service worker imports as they are (not bundled): service-worker globals.
  {
    files: ['web/public/**/*.js'],
    languageOptions: { globals: globals.serviceworker },
  },
);
