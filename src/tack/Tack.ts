// Defines an assembled tack directory description before it is written to disk.
import type { TackStatePath } from './StatePersistence.js';
import type { TackFile } from './TackFile.js';

export interface Tack {
  readonly rootDirectory: string;
  readonly files: readonly TackFile[];
  readonly statePaths: readonly TackStatePath[];
}

export const createTack = (
  rootDirectory: string,
  files: readonly TackFile[],
  statePaths: readonly TackStatePath[] = [],
): Tack => ({
  rootDirectory,
  files,
  statePaths,
});
