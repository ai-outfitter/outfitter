// Materializes profile-provided Agent Skills into the Claude composite profile skills directory.
import { readdirSync, statSync, type Dirent } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';

import type { CompositeProfileStatePath } from '../../compositeProfile/StatePersistence.js';
import { normalizeLaunchResourceIdentity } from '../ResourceIdentity.js';

export interface ClaudeSkillMaterializationInput {
  readonly profileId: string;
  /** Merged skill controls ordered from highest precedence to lowest precedence. */
  readonly skills?: readonly string[];
  /** Profile folders ordered from lowest precedence to highest precedence. */
  readonly profileFolders?: readonly string[];
  readonly projectDirectory?: string;
  /** The native skills directory the whole-directory `skills/` symlink would target. */
  readonly nativeSkillsSourcePath?: string;
}

export interface ClaudeSkillMaterialization {
  /** Per-skill symlink state paths inside `skills/`; empty when no profile skills resolve. */
  readonly statePaths: readonly CompositeProfileStatePath[];
  readonly warnings: readonly string[];
}

interface ClaudeSkillSource {
  readonly name: string;
  readonly sourcePath: string;
  readonly directory: boolean;
}

// Claude Code reads personal skills from `<config dir>/skills/<name>/SKILL.md`
// and documents that a skill entry may be a symlink to a directory elsewhere on
// disk, so profile skills are materialized as one symlink per skill.
export const materializeClaudeSkills = (input: ClaudeSkillMaterializationInput): ClaudeSkillMaterialization => {
  const warnings: string[] = [];
  const profileFoldersByPrecedence = [...(input.profileFolders ?? [])].reverse();
  const profileSkills = [
    ...resolveControlSkillSources(input, profileFoldersByPrecedence, warnings),
    ...profileFoldersByPrecedence.flatMap(claudeSkillSourcesForProfileFolder),
  ];

  if (profileSkills.length === 0) {
    return { statePaths: [], warnings };
  }

  const skillSources = dedupeClaudeSkillSources([
    ...profileSkills,
    ...mirroredNativeSkillEntries(input.nativeSkillsSourcePath),
  ]);

  return {
    statePaths: skillSources.map((skillSource) => ({
      relativePath: `skills/${skillSource.name}${skillSource.directory ? '/' : ''}`,
      strategy: 'symlink',
      sourcePath: skillSource.sourcePath,
      directory: skillSource.directory,
    })),
    warnings,
  };
};

const resolveControlSkillSources = (
  input: ClaudeSkillMaterializationInput,
  profileFoldersByPrecedence: readonly string[],
  warnings: string[],
): readonly ClaudeSkillSource[] =>
  (input.skills ?? []).flatMap((source) => {
    const skillDirectory = resolveControlSkillDirectory(source, profileFoldersByPrecedence, input.projectDirectory);

    if (skillDirectory === undefined) {
      warnings.push(`claude adapter could not find skill '${source}' for profile '${input.profileId}'.`);
      return [];
    }

    return [{ name: basename(skillDirectory), sourcePath: skillDirectory, directory: true }];
  });

const resolveControlSkillDirectory = (
  source: string,
  profileFoldersByPrecedence: readonly string[],
  projectDirectory: string | undefined,
): string | undefined => {
  const trimmed = source.trim();

  if (isPathLikeSkillSource(trimmed)) {
    const candidate = isAbsolute(trimmed) ? trimmed : resolve(projectDirectory ?? '.', trimmed);
    return isClaudeSkillDirectory(candidate) ? candidate : undefined;
  }

  return profileFoldersByPrecedence
    .flatMap((profileFolder) => [
      join(profileFolder, 'skills', trimmed),
      join(profileFolder, 'cli_specific', 'claude', 'skills', trimmed),
    ])
    .find((candidate) => isClaudeSkillDirectory(candidate));
};

const isPathLikeSkillSource = (source: string): boolean =>
  isAbsolute(source) || source.startsWith('.') || source.includes('/') || source.includes('\\');

const claudeSkillSourcesForProfileFolder = (profileFolder: string): readonly ClaudeSkillSource[] => [
  ...claudeSkillSourcesInFolder(join(profileFolder, 'skills')),
  ...claudeSkillSourcesInFolder(join(profileFolder, 'cli_specific', 'claude', 'skills')),
];

const claudeSkillSourcesInFolder = (skillsFolder: string): readonly ClaudeSkillSource[] =>
  readOptionalDirectoryEntries(skillsFolder)
    .filter((entry) => isClaudeSkillDirectory(join(skillsFolder, entry.name)))
    .map((entry) => ({ name: entry.name, sourcePath: join(skillsFolder, entry.name), directory: true }))
    .sort((left, right) => left.name.localeCompare(right.name));

// Entries already present in the native skills source stay reachable when the
// whole-directory symlink is replaced by per-skill materialization.
const mirroredNativeSkillEntries = (nativeSkillsSourcePath: string | undefined): readonly ClaudeSkillSource[] =>
  nativeSkillsSourcePath === undefined ? [] : mirroredNativeSkillFolderEntries(nativeSkillsSourcePath);

const mirroredNativeSkillFolderEntries = (nativeSkillsSourcePath: string): readonly ClaudeSkillSource[] =>
  readOptionalDirectoryEntries(nativeSkillsSourcePath)
    .flatMap((entry) => {
      const sourcePath = join(nativeSkillsSourcePath, entry.name);
      const sourceType = statOptionalSourceType(sourcePath);

      return sourceType === undefined ? [] : [{ name: entry.name, sourcePath, directory: sourceType === 'directory' }];
    })
    .sort((left, right) => left.name.localeCompare(right.name));

const dedupeClaudeSkillSources = (skillSources: readonly ClaudeSkillSource[]): readonly ClaudeSkillSource[] => {
  const seenIdentities = new Set<string>();
  const seenNames = new Set<string>();
  const uniqueSkillSources: ClaudeSkillSource[] = [];

  for (const skillSource of skillSources) {
    const identity = normalizeLaunchResourceIdentity(skillSource.sourcePath);

    if (seenIdentities.has(identity) || seenNames.has(skillSource.name)) {
      continue;
    }

    seenIdentities.add(identity);
    seenNames.add(skillSource.name);
    uniqueSkillSources.push(skillSource);
  }

  return uniqueSkillSources;
};

const isClaudeSkillDirectory = (candidate: string): boolean =>
  statOptionalSourceType(join(candidate, 'SKILL.md')) === 'file';

const statOptionalSourceType = (path: string): 'file' | 'directory' | undefined => {
  try {
    return statSync(path).isDirectory() ? 'directory' : 'file';
  } catch (error) {
    if (isMissingPathError(error) || isNotADirectoryError(error)) {
      return undefined;
    }

    /* v8 ignore next 2 -- non-ENOENT stat failures should surface as actionable filesystem errors. */
    throw new Error(`Could not inspect Claude skill path '${path}': ${String(error)}`, { cause: error });
  }
};

const readOptionalDirectoryEntries = (folderPath: string): readonly Dirent[] => {
  try {
    return readdirSync(folderPath, { withFileTypes: true });
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }

    throw new Error(`Could not read Claude skills folder '${folderPath}': ${String(error)}`, { cause: error });
  }
};

const isMissingPathError = (error: unknown): boolean => isErrorWithCode(error, 'ENOENT');

const isNotADirectoryError = (error: unknown): boolean => isErrorWithCode(error, 'ENOTDIR');

const isErrorWithCode = (error: unknown, code: string): boolean =>
  error !== null && typeof error === 'object' && 'code' in error && error.code === code;
