// Resolves support files shipped from the repository's `code/` tree. They live at `code/<asset>` in
// the repository layout and at `code/cli/code/<asset>` in the packaged npm layout; both relative
// depths are encoded here only, so a packaging change is a one-file edit.
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Resolves a `code/`-relative asset path, or undefined when neither layout provides it. */
export const findRepositoryCodeAsset = (relativePath: string): string | undefined => {
  const sourcePath = fileURLToPath(new URL(`../../../${relativePath}`, import.meta.url));
  const packagePath = fileURLToPath(new URL(`../../code/${relativePath}`, import.meta.url));

  /* v8 ignore else -- packaged layout is exercised by the npm package smoke test. */
  if (existsSync(sourcePath)) return sourcePath;
  /* v8 ignore next 3 -- packaged layout is covered by the package smoke test. */
  if (existsSync(packagePath)) return packagePath;
  return undefined;
};

export const resolveRepositoryCodeAsset = (relativePath: string): string => {
  const path = findRepositoryCodeAsset(relativePath);
  /* v8 ignore next -- support files ship with the package, so they always resolve in practice. */
  if (path === undefined) throw new Error(`Outfitter support file '${relativePath}' was not found.`);
  return path;
};

export const readRepositoryCodeAsset = (relativePath: string): string =>
  readFileSync(resolveRepositoryCodeAsset(relativePath), 'utf8');
