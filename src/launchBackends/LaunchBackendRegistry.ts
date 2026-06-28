// Selects launch backends and resolves auto detection with injectable dependencies.
import { accessSync, constants } from 'node:fs';
import { delimiter, join } from 'node:path';

import type { LaunchBackend, LaunchBackendId, ConcreteLaunchBackendId } from './LaunchBackend.js';
import { createAppleContainerLaunchBackend } from './AppleContainerLaunchBackend.js';
import { createDockerLaunchBackend } from './DockerLaunchBackend.js';
import { createHostLaunchBackend } from './HostLaunchBackend.js';
import { createPodmanLaunchBackend } from './PodmanLaunchBackend.js';

export interface LaunchBackendResolverDependencies {
  readonly commandExists?: (command: string) => boolean;
  readonly platform?: NodeJS.Platform;
}

export const createLaunchBackend = (
  requestedBackend: LaunchBackendId,
  dependencies: LaunchBackendResolverDependencies = {},
): LaunchBackend => {
  const backendId = resolveConcreteBackendId(requestedBackend, dependencies);

  assertBackendExecutable(backendId, dependencies.commandExists ?? defaultCommandExists);

  if (backendId === 'docker') {
    return createDockerLaunchBackend();
  }

  if (backendId === 'podman') {
    return createPodmanLaunchBackend();
  }

  if (backendId === 'apple-container') {
    return createAppleContainerLaunchBackend();
  }

  return createHostLaunchBackend();
};

export const resolveConcreteBackendId = (
  requestedBackend: LaunchBackendId,
  dependencies: LaunchBackendResolverDependencies = {},
): ConcreteLaunchBackendId => {
  if (requestedBackend !== 'auto') {
    return requestedBackend;
  }

  /* v8 ignore next -- default PATH/platform probing is host-environment behavior; tests inject both. */
  const commandExists = dependencies.commandExists ?? defaultCommandExists;
  const platform = dependencies.platform ?? process.platform;

  if (commandExists('docker')) {
    return 'docker';
  }

  if (commandExists('podman')) {
    return 'podman';
  }

  if (platform === 'darwin' && commandExists('container')) {
    return 'apple-container';
  }

  throw new Error(
    "No container launch backend executable found for 'auto' (tried docker, podman, and Apple container on macOS). Use --launch-backend host or install a backend.",
  );
};

const assertBackendExecutable = (
  backendId: ConcreteLaunchBackendId,
  commandExists: (command: string) => boolean,
): void => {
  if (backendId === 'host') {
    return;
  }

  const command = backendId === 'apple-container' ? 'container' : backendId;

  if (!commandExists(command)) {
    throw new Error(`Launch backend '${backendId}' requires executable '${command}' on PATH.`);
  }
};

/* v8 ignore start -- default PATH probing is host-environment behavior; tests inject commandExists. */
const defaultCommandExists = (command: string): boolean => {
  const pathEntries = (process.env.PATH ?? '').split(delimiter).filter((entry) => entry !== '');

  return pathEntries.some((entry) => {
    try {
      accessSync(join(entry, command), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
};
/* v8 ignore stop */
