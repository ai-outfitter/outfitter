// Defines an assembled compositeProfile directory description before it is written to disk.
import type { CompositeProfileStatePath } from './StatePersistence.js';
import type { CompositeProfileFile } from './CompositeProfileFile.js';

export interface CompositeProfile {
  readonly rootDirectory: string;
  readonly files: readonly CompositeProfileFile[];
  readonly statePaths: readonly CompositeProfileStatePath[];
}

export const createCompositeProfile = (
  rootDirectory: string,
  files: readonly CompositeProfileFile[],
  statePaths: readonly CompositeProfileStatePath[] = [],
): CompositeProfile => ({
  rootDirectory,
  files,
  statePaths,
});
