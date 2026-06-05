// Provides composite profile assembly and disk writing for generated logical files.
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

import type { CompositeProfile } from './CompositeProfile.js';
import { createCompositeProfile } from './CompositeProfile.js';
import { materializeCompositeProfileStatePath } from './StatePersistence.js';
import type { CompositeProfileFile } from './CompositeProfileFile.js';

export interface CompositeProfileAssemblyInput {
  readonly rootDirectory?: string;
  readonly files: readonly CompositeProfileFile[];
}

export interface CompositeProfileWriteOptions {
  readonly materializeStatePaths?: boolean;
}

export const createCompositeProfileRootDirectory = (profileId: string, agentId: string): string =>
  mkdtempSync(join(tmpdir(), `applepi-${profileId}-${agentId}-`));

export const assembleCompositeProfile = (input: CompositeProfileAssemblyInput): CompositeProfile =>
  createCompositeProfile(input.rootDirectory ?? createCompositeProfileRootDirectory('profile', 'agent'), input.files);

export const writeCompositeProfile = (
  compositeProfile: CompositeProfile,
  options: CompositeProfileWriteOptions = {},
): void => {
  mkdirSync(compositeProfile.rootDirectory, { recursive: true });

  for (const file of compositeProfile.files) {
    const outputPath = resolveCompositeProfileFileOutputPath(compositeProfile.rootDirectory, file.outputPath);
    mkdirSync(dirname(outputPath), { recursive: true });
    writeFileSync(outputPath, file.content);
  }

  if (options.materializeStatePaths === false) {
    return;
  }

  for (const statePath of compositeProfile.statePaths.filter((statePath) => statePath.relativePath !== 'unknown')) {
    materializeCompositeProfileStatePath(compositeProfile.rootDirectory, statePath);
  }
};

const resolveCompositeProfileFileOutputPath = (rootDirectory: string, outputPath: string): string => {
  const resolvedRootDirectory = resolve(rootDirectory);
  const resolvedOutputPath = isAbsolute(outputPath) ? resolve(outputPath) : resolve(rootDirectory, outputPath);
  const relativeOutputPath = relative(resolvedRootDirectory, resolvedOutputPath);

  if (relativeOutputPath.startsWith('..') || isAbsolute(relativeOutputPath)) {
    throw new Error(
      `CompositeProfile file output path '${outputPath}' must stay under compositeProfile root '${rootDirectory}'.`,
    );
  }

  return resolvedOutputPath;
};
