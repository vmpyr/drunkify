import eslint from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/dist/**', '**/node_modules/**', '**/coverage/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['apps/server/**/*.ts', 'scripts/**/*.ts', 'packages/content/scripts/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['packages/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            { name: 'fastify', message: 'packages/shared must remain runtime-agnostic.' },
            {
              name: 'better-sqlite3',
              message: 'packages/shared cannot depend on database drivers.',
            },
            { name: 'postgres', message: 'packages/shared cannot depend on database drivers.' },
          ],
          patterns: [
            {
              group: ['node:*', '../../apps/server/**', '@drunkify/server'],
              message: 'packages/shared must run in browsers and Node.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/server/src/services/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { paths: [{ name: 'fastify', message: 'Services must not depend on Fastify.' }] },
      ],
    },
  },
  {
    files: ['apps/server/src/routes/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['../db/**', '../repositories/**'],
              message: 'Routes call services, never repositories or DB modules.',
            },
          ],
        },
      ],
    },
  },
  { ...tseslint.configs.disableTypeChecked, files: ['**/*.mjs'] },
);
