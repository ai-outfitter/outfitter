// Realpath containment helpers so a dump can never read or overwrite content outside the tree.
import { realpathSync } from 'node:fs';
import { isAbsolute, relative, resolve, sep } from 'node:path';

const isContainedRelativePath = (path: string): boolean =>
  path === '' || (path !== '..' && !path.startsWith(`..${sep}`) && !isAbsolute(path));

/** Resolves symlinks to a real path; falls back to a normalized absolute path when it does not exist. */
export const realpathOrResolve = (path: string): string => {
  try {
    return realpathSync(path);
  } catch {
    return resolve(path);
  }
};

/** True when a normalized child path is lexically contained without following symlinks. */
export const isLexicallyInside = (child: string, parent: string): boolean => {
  const relativePath = relative(parent, child);
  return isContainedRelativePath(relativePath);
};

/** True when `child` resolves to `parent` or somewhere inside it (symlinks followed on both sides). */
export const isInside = (child: string, parent: string): boolean => {
  const relativePath = relative(realpathOrResolve(parent), realpathOrResolve(child));
  return isContainedRelativePath(relativePath);
};

/** True when `path` resolves outside every provided root — i.e. it escapes the tree. */
export const escapesRoots = (path: string, roots: readonly string[]): boolean =>
  !roots.some((root) => isInside(path, root));

/** True when two directories overlap in either direction (realpath-aware). */
export const overlaps = (left: string, right: string): boolean => isInside(left, right) || isInside(right, left);
