// Computes conservative identity bind mounts needed by containerized launches.
import { existsSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { LaunchBackendRenderInput } from './LaunchBackend.js';

export interface ContainerMount {
  readonly source: string;
  readonly target: string;
  readonly readonly: boolean;
}

export interface ContainerMountPlan {
  readonly mounts: readonly ContainerMount[];
  readonly warnings: readonly string[];
}

const packageRootDirectory = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

export const planContainerMounts = (input: LaunchBackendRenderInput): ContainerMountPlan => {
  const warnings: string[] = [];
  const mounts = new Map<string, ContainerMount>();
  const add = (path: string | undefined, readonly: boolean): void => {
    /* v8 ignore next -- defensive guard for future optional mount inputs; current required inputs are covered. */
    if (path === undefined || path === '') {
      return;
    }

    const source = resolve(path);

    if (isUnsafeDefaultMount(source)) {
      warnings.push(`Refusing unsafe implicit container mount '${source}'.`);
      return;
    }

    if (!existsSync(source)) {
      warnings.push(`Required container mount source '${source}' does not exist.`);
      return;
    }

    const existing = mounts.get(source);
    mounts.set(source, {
      source,
      target: source,
      readonly: existing === undefined ? readonly : existing.readonly && readonly,
    });
  };

  add(input.projectDirectory, false);
  add(input.compositeProfile.rootDirectory, false);
  add(input.cacheDirectory, false);
  add(packageRootDirectory, true);

  for (const profileFolder of input.profileFolders) {
    add(profileFolder, true);
  }

  for (const file of input.compositeProfile.files) {
    for (const sourceInput of file.sourceInputs) {
      add(dirname(sourceInput), true);
    }
  }

  for (const statePath of input.statePaths) {
    if (statePath.sourcePath !== undefined) {
      add(statePath.directory ? statePath.sourcePath : dirname(statePath.sourcePath), false);
    }
  }

  return { mounts: [...mounts.values()].sort((left, right) => left.target.localeCompare(right.target)), warnings };
};

const isUnsafeDefaultMount = (path: string): boolean => {
  if (path === sep || path === process.env.HOME || path.endsWith(`${sep}docker.sock`)) {
    return true;
  }

  const homeDirectory = process.env.HOME;
  const sensitiveDirectories =
    homeDirectory === undefined
      ? []
      : [resolve(homeDirectory, '.ssh'), resolve(homeDirectory, '.aws'), resolve(homeDirectory, '.config', 'gcloud')];

  return sensitiveDirectories.some((directory) => path === directory || isPathInside(path, directory));
};

const isPathInside = (path: string, parent: string): boolean => {
  const childRelativePath = relative(parent, path);

  return childRelativePath !== '' && !childRelativePath.startsWith('..') && !childRelativePath.startsWith(sep);
};
