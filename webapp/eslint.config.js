// @ts-check
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import prettier from 'eslint-config-prettier'

export default tseslint.config(
  {
    ignores: [
      '**/dist/',
      '**/dist-site/',
      '**/coverage/',
      'tools/differential/.work/',
      'tools/differential/cs/',
    ],
  },
  js.configs.recommended,

  // Typed linting for the package sources and tests.
  {
    files: ['packages/*/src/**/*.ts', 'packages/*/test/**/*.ts'],
    extends: [...tseslint.configs.recommendedTypeChecked],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // The ported code mirrors C# control flow closely, and the non-null
      // assertions come from noUncheckedIndexedAccess on regex/array access
      // that the surrounding test has already proven. Churn here would make the
      // port harder to diff against the original.
      '@typescript-eslint/no-non-null-assertion': 'off',
      // The FileSystem interface is async because OPFS is; the in-memory
      // implementation satisfies it without needing to await anything.
      '@typescript-eslint/require-await': 'off',
    },
  },

  // Tooling scripts and config files run in Node, untyped.
  {
    files: ['**/*.mjs', 'eslint.config.js', 'vitest.config.ts'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: globals.node,
      parserOptions: { project: null, projectService: false },
    },
  },

  prettier,
)
