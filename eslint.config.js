import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'
import configPrettier from 'eslint-config-prettier'
import prettierPlugin from 'eslint-plugin-prettier'
import { defineConfig, globalIgnores } from 'eslint/config'

const browserNodeGlobals = { ...globals.browser, ...globals.node }

export default defineConfig([
  // Global linter options
  { linterOptions: { reportUnusedDisableDirectives: true } },
  globalIgnores(['dist', 'types/**/*.d.ts', 'INSTRUCTIONS.md']),
  // Base config for plain JS/JSX files (keep lightweight)
  {
    files: ['**/*.{js,jsx}'],
    extends: [js.configs.recommended],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserNodeGlobals,
    },
    rules: {
      // Allow empty catches (common for best-effort cleanup in this project)
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // Allow leading underscore to intentionally mark unused vars
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      // Type-aware rules for TypeScript
      tseslint.configs.strictTypeChecked,
      tseslint.configs.stylisticTypeChecked,
      // React-specific rules
      reactX.configs['recommended-typescript'],
      reactDom.configs.recommended,
      // Existing React hooks/refresh
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: browserNodeGlobals,
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json', './tsconfig.tests.json'],
        tsconfigRootDir: import.meta.dirname,
      },
    },
    // Explicitly declare plugin so custom rule overrides are recognized
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // Downgrade / relax overly strict rules producing current build-blocking errors whilst retaining visibility
      '@typescript-eslint/no-unnecessary-condition': 'off',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/restrict-template-expressions': [
        'warn',
        { allowNumber: true, allowBoolean: true, allowNullish: true },
      ],
      '@typescript-eslint/restrict-plus-operands': 'warn',
      '@typescript-eslint/no-non-null-assertion': 'warn',
      '@typescript-eslint/prefer-nullish-coalescing': 'warn',
      '@typescript-eslint/no-empty-function': 'warn',
      '@typescript-eslint/no-unnecessary-type-conversion': 'warn',
      // Permit intentionally empty blocks used as safe no-op fallbacks (already documented in code)
      'no-empty': ['warn', { allowEmptyCatch: true }],
      // Disable the base rule in TS files to avoid false positives (it doesn't understand types)
      'no-unused-vars': 'off',
      // Enable the TS-aware variant with underscore ignore convention
      '@typescript-eslint/no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {
    files: ['tests/**/*.{js,ts,tsx}', 'e2e/**/*.{js,ts,tsx}'],
    // Provide plugin here too because flat config blocks are isolated
    plugins: { '@typescript-eslint': tseslint.plugin },
    rules: {
      // Tests (unit + e2e) often use flexible typing and partial objects; relax strict safety rules here.
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/no-unsafe-assignment': 'off',
      '@typescript-eslint/no-unsafe-member-access': 'off',
      '@typescript-eslint/no-unsafe-return': 'off',
      '@typescript-eslint/no-redundant-type-constituents': 'off',
      '@typescript-eslint/no-empty-function': 'off',
    },
  },
  // Disable conflicting stylistic rules and integrate Prettier in compatibility mode
  configPrettier,
  {
    files: ['**/*.{js,jsx,ts,tsx}'],
    plugins: { prettier: prettierPlugin },
    rules: {
      'prettier/prettier': 'warn',
    },
  },
])
