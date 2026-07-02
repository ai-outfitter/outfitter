// Renders the human-readable launch summary lines printed before an agent starts.
import chalk from 'chalk';

import type { Profile } from '../../../profiles/Profile.js';
import { redactProfileSourceUriCredentials } from '../../../profiles/ProfileCache.js';
import type { LoadedProfile } from '../../../profiles/ProfileLoader.js';
import type { ResolvedRunProfile } from './RunProfileResolution.js';

export const emitLaunchSummary = (
  resolvedProfile: ResolvedRunProfile,
  adapterId: string,
  compositeProfileRootDirectory: string,
  writeLine: ((message: string) => void) | undefined,
): void => {
  const writer = writeLine ?? console.log;
  const model = selectSummaryModel(resolvedProfile.profile, adapterId);

  writer(`${chalk.magenta('→')} resolving profile ${chalk.yellow(resolvedProfile.profile.id)}`);

  for (const layer of resolvedProfile.profileLayers) {
    writer(
      `${chalk.green('✓')} profile layer ${chalk.yellow(layer.profile.id)}  ${chalk.dim(formatProfileLayerSource(layer))}`,
    );
  }

  writer(`${chalk.green('✓')} merged controls${model === undefined ? '' : `  model=${chalk.yellow(model)}`}`);
  writer(`${chalk.green('✓')} prepared composite profile  ${chalk.dim(compositeProfileRootDirectory)}`);
  writer(`${chalk.blue('↳')} launching ${chalk.cyan(adapterId)} …`);
};

const selectSummaryModel = (profile: Profile, adapterId: string): string | undefined => {
  if (adapterId === 'claude') {
    return profile.controls.claude?.model ?? profile.controls.model;
  }

  return profile.controls.pi?.model ?? profile.controls.model;
};

const formatProfileLayerSource = (layer: LoadedProfile): string => {
  if (layer.source.github !== undefined) {
    return formatRemoteProfileSource(`github:${layer.source.github}`, layer.source.ref, layer.source.path);
  }

  if (layer.source.uri !== undefined) {
    return formatRemoteProfileSource(
      redactProfileSourceUriCredentials(layer.source.uri),
      layer.source.ref,
      layer.source.path,
    );
  }

  return layer.folderPath;
};

const formatRemoteProfileSource = (source: string, ref: string | undefined, path: string | undefined): string => {
  const refSuffix = ref === undefined ? '' : `@${ref}`;
  const pathSuffix = path === undefined ? '' : `/${path}`;

  return `${source}${refSuffix}${pathSuffix}`;
};
