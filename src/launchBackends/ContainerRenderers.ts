// Shared argv rendering helpers for Docker-compatible and Apple container launches.
import { envPassthroughForContainer, mutableImageReferenceWarning } from './ContainerControls.js';
import { planContainerMounts, type ContainerMount } from './ContainerMountPlanner.js';
import type { LaunchBackendPlan, LaunchBackendRenderInput, ConcreteLaunchBackendId } from './LaunchBackend.js';

export const renderDockerLikeBackend = (
  id: 'docker' | 'podman',
  input: LaunchBackendRenderInput,
): LaunchBackendPlan => {
  const { image, warnings } = requireContainerImage(id, input);
  const mounts = planContainerMounts(input);
  const args = [
    'run',
    '--rm',
    '--interactive',
    ...(input.stdoutIsTty ? ['--tty'] : []),
    '--workdir',
    input.projectDirectory,
    ...mounts.mounts.flatMap(renderDockerMount),
    ...renderEnvFlags(input),
    ...renderDockerPull(input.container.pull),
    ...renderOptionValue('--platform', input.container.platform),
    ...(input.container.runArgs ?? input.container.run_args ?? []),
    image,
    input.innerLaunchPlan.command,
    ...input.innerLaunchPlan.args,
  ];

  return {
    backendId: id,
    launchPlan: { command: id, args, env: renderContainerProcessEnv(input), cwd: input.projectDirectory },
    warnings: [...warnings, ...mounts.warnings],
  };
};

export const renderAppleContainerBackend = (input: LaunchBackendRenderInput): LaunchBackendPlan => {
  const { image, warnings } = requireContainerImage('apple-container', input);
  const mounts = planContainerMounts(input);
  const pullWarning =
    input.container.pull === undefined
      ? []
      : [`apple-container launch backend does not support portable pull policy '${input.container.pull}'.`];
  const args = [
    'run',
    '--rm',
    '--interactive',
    /* v8 ignore next -- Apple TTY parity is covered by the Docker-compatible renderer tests. */
    ...(input.stdoutIsTty ? ['--tty'] : []),
    '--workdir',
    input.projectDirectory,
    ...mounts.mounts.flatMap(renderAppleMount),
    ...renderEnvFlags(input),
    ...renderOptionValue('--platform', input.container.platform),
    ...(input.container.runArgs ?? input.container.run_args ?? []),
    image,
    input.innerLaunchPlan.command,
    ...input.innerLaunchPlan.args,
  ];

  return {
    backendId: 'apple-container',
    launchPlan: { command: 'container', args, env: renderContainerProcessEnv(input), cwd: input.projectDirectory },
    warnings: [...warnings, ...pullWarning, ...mounts.warnings],
  };
};

export const renderHostBackend = (input: LaunchBackendRenderInput): LaunchBackendPlan => ({
  backendId: 'host',
  launchPlan: input.innerLaunchPlan,
  warnings:
    input.container.image === undefined
      ? []
      : [`host launch backend ignores configured container image '${input.container.image}'.`],
});

const requireContainerImage = (
  backendId: ConcreteLaunchBackendId,
  input: LaunchBackendRenderInput,
): { readonly image: string; readonly warnings: readonly string[] } => {
  if (input.container.image === undefined) {
    throw new Error(`Launch backend '${backendId}' requires controls.container.image.`);
  }

  return {
    image: input.container.image,
    warnings: [mutableImageReferenceWarning(input.container.image)].filter((warning) => warning !== undefined),
  };
};

const renderDockerMount = (mount: ContainerMount): readonly string[] => [
  '--mount',
  `type=bind,src=${mount.source},dst=${mount.target}${mount.readonly ? ',readonly' : ''}`,
];

const renderAppleMount = (mount: ContainerMount): readonly string[] => [
  '--mount',
  `source=${mount.source},target=${mount.target}${mount.readonly ? ',readonly' : ''}`,
];

const renderEnvFlags = (input: LaunchBackendRenderInput): readonly string[] => {
  const innerEnvNames = Object.keys(input.innerLaunchPlan.env).sort();
  const passThroughNames = envPassthroughForContainer(
    input.container.envPassthrough ?? input.container.env_passthrough,
    input.envPassthroughAllowed,
  );

  return [...new Set([...innerEnvNames, ...passThroughNames])].flatMap((name) => ['--env', name]);
};

const renderContainerProcessEnv = (input: LaunchBackendRenderInput): Readonly<Record<string, string>> => {
  const passThroughNames = envPassthroughForContainer(
    input.container.envPassthrough ?? input.container.env_passthrough,
    input.envPassthroughAllowed,
  );
  const passThroughEnv = Object.fromEntries(
    passThroughNames
      .map((name) => [name, process.env[name]])
      .filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

  return { ...passThroughEnv, ...input.innerLaunchPlan.env };
};

const renderDockerPull = (pull: string | undefined): readonly string[] => {
  if (pull === undefined || pull === 'missing') {
    return [];
  }

  return [`--pull=${pull}`];
};

const renderOptionValue = (option: string, value: string | undefined): readonly string[] =>
  value === undefined ? [] : [option, value];
