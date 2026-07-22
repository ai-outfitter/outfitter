// Shared helper for copy/overlay writers that populate an already-materialized tree, where a path
// can be a directory in one source and a file in another (or collide with a generated file).
import { lstatSync, rmSync } from 'node:fs';

/**
 * Removes `targetPath` when it exists but is not the `expected` node type, so a subsequent copy or
 * write can create the right kind in its place. A missing target is left untouched. Uses a single
 * `lstatSync` (ENOENT means nothing to remove) rather than an `existsSync` + `lstatSync` pair.
 */
export const removeTargetTypeConflict = (targetPath: string, expected: 'directory' | 'file'): void => {
  let target;
  try {
    target = lstatSync(targetPath);
  } catch {
    return;
  }
  const matches = expected === 'directory' ? target.isDirectory() : target.isFile();
  if (!matches) rmSync(targetPath, { recursive: true, force: true });
};
