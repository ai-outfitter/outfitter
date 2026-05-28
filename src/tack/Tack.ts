// Defines an assembled tack directory description before it is written to disk.
import type { TackFile } from './TackFile.js';

export interface Tack {
  readonly rootDirectory: string;
  readonly files: readonly TackFile[];
}

export const createTack = (rootDirectory: string, files: readonly TackFile[]): Tack => ({
  rootDirectory,
  files,
});
