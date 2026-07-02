import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    ignores: [
      'dist/**',
      'coverage/**',
      'node_modules/**',
      'doc_site/**',
      'eslint.config.js',
      'scripts/**/*.mjs',
      'code/enterprise/**',
      'code/pi-extension/**',
    ],
  },
  {
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      complexity: ['error', 10],
      'max-lines': ['error', { max: 500, skipBlankLines: true, skipComments: true }],
    },
  },
);
