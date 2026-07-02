// Resolves Pi skill sources declared by profiles and discovered in profile folders.
import { readdirSync, statSync, type Dirent } from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

import type { AgentLaunchProfileLayer } from '../AgentAdapter.js';
import type { PiProfileControls } from '../../profiles/Profile.js';

export const createPiSkillSources = (input: {
  readonly builtInOutfitterSkill: string;
  readonly controls: PiProfileControls;
  readonly profileFolders: readonly string[];
  readonly profileLayers: readonly AgentLaunchProfileLayer[];
}): readonly string[] => [
  ...new Set([
    input.builtInOutfitterSkill,
    ...(input.controls.skills ?? []).map((source) => resolveProfileSkillSource(source, input.profileLayers)),
    ...input.profileFolders.flatMap(skillSourcesForProfile),
  ]),
];

const resolveProfileSkillSource = (source: string, profileLayers: readonly AgentLaunchProfileLayer[]): string => {
  if (isAbsolute(source)) {
    return source;
  }

  for (const root of sharedSkillRootsForLayers(profileLayers)) {
    const resolvedSource = join(root, source);

    if (isPiSkillSource(resolvedSource)) {
      return resolvedSource;
    }
  }

  return source;
};

const sharedSkillRootsForLayers = (profileLayers: readonly AgentLaunchProfileLayer[]): readonly string[] => [
  ...new Set(profileLayers.flatMap(sharedSkillRootsForLayer)),
];

const sharedSkillRootsForLayer = (profileLayer: AgentLaunchProfileLayer): readonly string[] => {
  const roots: string[] = [];

  if (profileLayer.sourceRootPath !== undefined) {
    roots.push(dirname(profileLayer.sourceRootPath), profileLayer.sourceRootPath);
  }

  if (profileLayer.resourceRootPath !== undefined) {
    roots.push(profileLayer.resourceRootPath);
  }

  return roots;
};

const isPiSkillSource = (sourcePath: string): boolean => isFile(sourcePath) || isFile(join(sourcePath, 'SKILL.md'));

const skillSourcesForProfile = (profileFolder: string): readonly string[] => [
  ...skillSourcesForFolder(join(profileFolder, 'skills'), 'profile skills folder'),
  ...skillSourcesForFolder(join(profileFolder, 'cli_specific', 'pi', 'skills'), 'profile Pi skills folder'),
];

const skillSourcesForFolder = (skillsFolder: string, description: string): readonly string[] =>
  readOptionalDirectoryEntries(skillsFolder, description)
    .filter(isPiSkillEntry(skillsFolder))
    .map((entry) => join(skillsFolder, entry.name))
    .sort();

const isPiSkillEntry =
  (folderPath: string) =>
  (entry: Dirent): boolean =>
    entry.isDirectory() && isFile(join(folderPath, entry.name, 'SKILL.md'));

const readOptionalDirectoryEntries = (folderPath: string, description: string): readonly Dirent[] => {
  try {
    return readdirSync(folderPath, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }

    throw new Error(`Could not read ${description} '${folderPath}': ${String(error)}`, { cause: error });
  }
};

const isFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }

    throw new Error(`Could not inspect file '${path}': ${String(error)}`, { cause: error });
  }
};

const isMissingPathError = (error: unknown): boolean =>
  error !== null && typeof error === 'object' && 'code' in error && error.code === 'ENOENT';
