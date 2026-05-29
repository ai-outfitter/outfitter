// Defines a logical file generated into a temporary Bridl tack directory.
import { join } from 'node:path';

export type TackFileStrategy = 'copy' | 'merge' | 'transform' | 'generate';

export interface TackFile {
  readonly relativePath: string;
  readonly content: string;
  readonly sourceInputs: readonly string[];
  readonly outputPath: string;
  readonly strategy: TackFileStrategy;
}

export interface TackFileInput {
  readonly relativePath: string;
  readonly content: string;
  readonly rootDirectory?: string;
  readonly sourceInputs?: readonly string[];
  readonly strategy?: TackFileStrategy;
}

export const createTackFile = (input: TackFileInput | string, content?: string): TackFile => {
  if (typeof input === 'string') {
    return createTackFileFromInput({ relativePath: input, content: content ?? '' });
  }

  return createTackFileFromInput(input);
};

const createTackFileFromInput = (input: TackFileInput): TackFile => ({
  relativePath: input.relativePath,
  content: input.content,
  sourceInputs: input.sourceInputs ?? [],
  outputPath: input.rootDirectory === undefined ? input.relativePath : join(input.rootDirectory, input.relativePath),
  strategy: input.strategy ?? 'generate',
});
