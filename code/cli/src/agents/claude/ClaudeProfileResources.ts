// Aggregates profile-provided Claude skills and subagents into merged composite state directories.
import { readdirSync, statSync, type Dirent } from 'node:fs';
import { join } from 'node:path';

import type { CompositeProfileStateEntrySource } from '../../compositeProfile/StatePersistence.js';

export type ClaudeAggregatedStatePath = 'skills/' | 'agents/';

export const claudeAggregatedStatePaths: readonly ClaudeAggregatedStatePath[] = ['skills/', 'agents/'];

/**
 * Resolves per-entry symlink sources for the composite `skills/` or `agents/` directory.
 * Returns undefined when no contributing profile folder ships generic entries, so the
 * adapter keeps the existing whole-directory symlink behavior.
 */
export const resolveClaudeStateEntrySources = (input: {
  readonly relativePath: ClaudeAggregatedStatePath;
  readonly profileFolders: readonly string[];
  readonly baseSourcePath: string;
}): readonly CompositeProfileStateEntrySource[] | undefined => {
  const profileEntries = input.profileFolders.flatMap((profileFolder) =>
    profileEntrySourcesForFolder(input.relativePath, profileFolder),
  );

  if (profileEntries.length === 0) {
    return undefined;
  }

  const mergedEntries = new Map<string, CompositeProfileStateEntrySource>();

  for (const entry of baseEntrySources(input.baseSourcePath, input.relativePath)) {
    mergedEntries.set(entry.name, entry);
  }

  for (const entry of profileEntries) {
    mergedEntries.set(entry.name, entry);
  }

  return [...mergedEntries.values()].sort((left, right) => left.name.localeCompare(right.name));
};

const profileEntrySourcesForFolder = (
  relativePath: ClaudeAggregatedStatePath,
  profileFolder: string,
): readonly CompositeProfileStateEntrySource[] =>
  relativePath === 'skills/'
    ? skillEntrySourcesForFolder(join(profileFolder, 'skills'), 'profile skills folder')
    : subagentEntrySourcesForFolder(join(profileFolder, 'agents'), 'profile agents folder');

const skillEntrySourcesForFolder = (
  skillsFolder: string,
  description: string,
): readonly CompositeProfileStateEntrySource[] =>
  readOptionalDirectoryEntries(skillsFolder, description)
    .filter((entry) => entry.isDirectory() && isFile(join(skillsFolder, entry.name, 'SKILL.md')))
    .map((entry) => ({ name: entry.name, sourcePath: join(skillsFolder, entry.name), directory: true }))
    .sort(byEntryName);

const subagentEntrySourcesForFolder = (
  agentsFolder: string,
  description: string,
): readonly CompositeProfileStateEntrySource[] =>
  readOptionalDirectoryEntries(agentsFolder, description)
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => ({ name: entry.name, sourcePath: join(agentsFolder, entry.name), directory: false }))
    .sort(byEntryName);

const baseEntrySources = (
  baseSourcePath: string,
  relativePath: ClaudeAggregatedStatePath,
): readonly CompositeProfileStateEntrySource[] =>
  readOptionalDirectoryEntries(baseSourcePath, `claude ${relativePath} state directory`)
    .map((entry) => ({
      name: entry.name,
      sourcePath: join(baseSourcePath, entry.name),
      directory: entry.isDirectory(),
    }))
    .sort(byEntryName);

const byEntryName = (left: CompositeProfileStateEntrySource, right: CompositeProfileStateEntrySource): number =>
  left.name.localeCompare(right.name);

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
