// Provides tack assembly scaffolding from generated logical files.
import type { Tack } from './Tack.js';
import { createTack } from './Tack.js';
import type { TackFile } from './TackFile.js';

export interface TackAssemblyInput {
  readonly rootDirectory: string;
  readonly files: readonly TackFile[];
}

export const assembleTack = (input: TackAssemblyInput): Tack => createTack(input.rootDirectory, input.files);
