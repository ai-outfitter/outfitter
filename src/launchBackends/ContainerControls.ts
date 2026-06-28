// Normalizes and selects profile-defined container controls for launch backends.
import type { Profile, ContainerProfileControls } from '../profiles/Profile.js';
import type { Settings } from '../settings/Settings.js';
import type { LaunchBackendId } from './LaunchBackend.js';

export const launchBackendIds = ['host', 'auto', 'docker', 'podman', 'apple-container'] as const;
export const containerPullPolicies = ['missing', 'always', 'never'] as const;

export const isLaunchBackendId = (value: string): value is LaunchBackendId =>
  (launchBackendIds as readonly string[]).includes(value);

export const mergeContainerControls = (
  generic: ContainerProfileControls | undefined,
  agentSpecific: ContainerProfileControls | undefined,
): ContainerProfileControls | undefined => {
  const merged = { ...generic, ...agentSpecific };

  return Object.keys(merged).length === 0 ? undefined : merged;
};

export const selectContainerControls = (profile: Profile, agentId: string): ContainerProfileControls => {
  const agentContainer = agentId === 'pi' ? profile.controls.pi?.container : profile.controls.claude?.container;

  return (
    mergeContainerControls(
      profile.controls.container,
      agentId === 'pi' || agentId === 'claude' ? agentContainer : undefined,
    ) ?? {}
  );
};

export const selectRequestedLaunchBackend = (
  cliBackend: LaunchBackendId | undefined,
  container: ContainerProfileControls,
  settings: Settings,
): LaunchBackendId =>
  cliBackend ?? container.backend ?? settings.defaultLaunchBackend ?? (container.image === undefined ? 'host' : 'auto');

export const mutableImageReferenceWarning = (image: string | undefined): string | undefined => {
  if (image === undefined) {
    return undefined;
  }

  const withoutRegistryPort = image.includes('/') ? image.slice(image.lastIndexOf('/') + 1) : image;
  const hasDigest = image.includes('@sha256:');
  const tag = withoutRegistryPort.includes(':')
    ? withoutRegistryPort.slice(withoutRegistryPort.lastIndexOf(':') + 1)
    : undefined;

  if (hasDigest || (tag !== undefined && tag !== 'latest')) {
    return undefined;
  }

  return `Container image '${image}' is mutable; pin a non-latest tag or digest for reproducible launches.`;
};

export const envPassthroughForContainer = (
  requested: readonly string[] | undefined,
  allowed: readonly string[] | undefined,
  hostEnv: NodeJS.ProcessEnv = process.env,
): readonly string[] => {
  const allowedSet = new Set(allowed ?? []);

  return [...new Set(requested ?? [])].filter((name) => allowedSet.has(name) && hostEnv[name] !== undefined);
};
