// Defines a logical file generated into a temporary ApplePi compositeProfile directory.
import { join } from 'node:path';

export type CompositeProfileFileStrategy = 'copy' | 'merge' | 'transform' | 'generate';

export interface CompositeProfileFile {
  readonly relativePath: string;
  readonly content: string;
  readonly sourceInputs: readonly string[];
  readonly outputPath: string;
  readonly strategy: CompositeProfileFileStrategy;
}

export interface CompositeProfileFileInput {
  readonly relativePath: string;
  readonly content: string;
  readonly rootDirectory?: string;
  readonly sourceInputs?: readonly string[];
  readonly strategy?: CompositeProfileFileStrategy;
}

export const createCompositeProfileFile = (
  input: CompositeProfileFileInput | string,
  content?: string,
): CompositeProfileFile => {
  if (typeof input === 'string') {
    return createCompositeProfileFileFromInput({ relativePath: input, content: content ?? '' });
  }

  return createCompositeProfileFileFromInput(input);
};

const createCompositeProfileFileFromInput = (input: CompositeProfileFileInput): CompositeProfileFile => ({
  relativePath: input.relativePath,
  content: input.content,
  sourceInputs: input.sourceInputs ?? [],
  outputPath: input.rootDirectory === undefined ? input.relativePath : join(input.rootDirectory, input.relativePath),
  strategy: input.strategy ?? 'generate',
});
