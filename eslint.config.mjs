import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/coverage/**',
      'services/agent/**',
      'packages/chat-core-kotlin/**',
      'packages/chat-core-swift/**',
      'packages/a2ui-bridge/**',
      'apps/android/**',
      'apps/ios/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node },
    },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['apps/web/**', 'apps/catalog/**', 'apps/composer/**'],
    languageOptions: {
      globals: { ...globals.browser },
    },
  },
  {
    files: ['**/test/**', '**/*.test.*'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
);
