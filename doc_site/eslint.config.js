import js from '@eslint/js';
import tseslint from 'typescript-eslint';

const typedTypeScriptConfigs = tseslint.configs.recommendedTypeChecked.map((config) => ({
  ...config,
  files: ['**/*.ts', '**/*.tsx'],
}));

export default tseslint.config(
  {
    ignores: ['**/.next/**', '**/node_modules/**', 'next-env.d.ts'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...typedTypeScriptConfigs,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parserOptions: {
        project: './tsconfig.json',
        tsconfigRootDir: import.meta.dirname,
      },
    },
  },
);
