// Provides tack assembly and disk writing for generated logical files.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import type { Tack } from './Tack.js';
import { createTack } from './Tack.js';
import type { TackFile } from './TackFile.js';

export interface TackAssemblyInput {
  readonly rootDirectory?: string;
  readonly files: readonly TackFile[];
}

export const createTackRootDirectory = (profileId: string, agentId: string): string =>
  mkdtempSync(join(tmpdir(), `bridl-${profileId}-${agentId}-`));

export const assembleTack = (input: TackAssemblyInput): Tack =>
  createTack(input.rootDirectory ?? createTackRootDirectory('profile', 'agent'), input.files);

export const writeTack = (tack: Tack): void => {
  mkdirSync(tack.rootDirectory, { recursive: true });

  for (const file of tack.files) {
    const outputPath = resolveTackFileOutputPath(tack.rootDirectory, file.outputPath);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, file.content);
  }
};

const resolveTackFileOutputPath = (rootDirectory: string, outputPath: string): string => {
  const resolvedRootDirectory = resolve(rootDirectory);
  const resolvedOutputPath = isAbsolute(outputPath) ? resolve(outputPath) : resolve(rootDirectory, outputPath);
  const relativeOutputPath = relative(resolvedRootDirectory, resolvedOutputPath);

  if (relativeOutputPath.startsWith('..') || isAbsolute(relativeOutputPath)) {
    throw new Error(`Tack file output path '${outputPath}' must stay under tack root '${rootDirectory}'.`);
  }

  return resolvedOutputPath;
};
