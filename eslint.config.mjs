import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import nextPlugin from '@next/eslint-plugin-next';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/drizzle/**',
      'artifacts/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    languageOptions: {
      globals: { ...globals.node },
      parserOptions: { ecmaVersion: 2023, sourceType: 'module' },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      // Gather handles tax documents: an accidental `console.log(token)` is a real
      // incident. Structured logging goes through @gather/core's logger instead.
      'no-console': 'error',
      eqeqeq: ['error', 'smart'],
      'no-restricted-globals': ['error', { name: 'name', message: 'Use an explicit variable.' }],
    },
  },

  // The web app: Next.js and React rules, browser globals for client components.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    plugins: { '@next/next': nextPlugin, 'react-hooks': reactHooks },
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
    rules: {
      ...nextPlugin.configs.recommended.rules,
      ...nextPlugin.configs['core-web-vitals'].rules,
      ...reactHooks.configs.recommended.rules,
      // App Router only — there is no pages/ directory to link into.
      '@next/next/no-html-link-for-pages': 'off',
    },
  },

  // CLIs talk to the operator on stdout/stderr; that is their interface, not logging.
  {
    files: ['packages/db/src/cli/**/*.ts', 'e2e/**/*.ts', '*.config.{ts,mjs}'],
    rules: { 'no-console': 'off' },
  },

  prettier,
);
