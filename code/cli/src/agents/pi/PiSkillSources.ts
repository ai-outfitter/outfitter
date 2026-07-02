// Resolves Pi skill sources declared by profiles and discovered in profile folders.
import { readdirSync, statSync, type Dirent } from 'node:fs';
import { join } from 'node:path';

import type { PiProfileControls } from '../../profiles/Profile.js';

export const createPiSkillSources = (input: {
  readonly builtInOutfitterSkill: string;
  readonly controls: PiProfileControls;
  readonly profileFolders: readonly string[];
  readonly generatedSkillSources?: readonly string[];
}): readonly string[] => [
  ...new Set([
    input.builtInOutfitterSkill,
    ...(input.generatedSkillSources ?? []),
    ...(input.controls.skills ?? []),
    ...input.profileFolders.flatMap(skillSourcesForProfile),
  ]),
];

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
