// Applies a setup-source import (copy snapshot or development symlink) to an install target.
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { parse, stringify } from 'yaml';

import { createSettingsLoadPlan, loadSettingsFiles } from '../../../settings/SettingsLoader.js';
import { updateSettingsDefaultProfile } from '../FirstRunWelcomeProfile.js';
import {
  readStarterSettingsContent,
  resolveLocalSetupSourceOutfitterPath,
  validateStarterSettingsIfPresent,
} from './SetupStarterLayout.js';
import type { SetupCommandInput, SetupSourceOnboardingResult, StarterLayout } from './SetupTypes.js';

export interface AppliedSetupSourceImport {
  readonly settingsPath: string;
  readonly settingsDescription: string;
  readonly profilesPath: string;
  readonly createdSettings: boolean;
  readonly copiedStarterProfileFiles: number;
  readonly copiedStarterResourceFiles: number;
  readonly selectedProfileAlreadyExists: boolean;
  readonly selectedProfileConflictMessage?: string;
  readonly symlinkedOutfitter: boolean;
}

export const applySetupSourceImport = (
  input: SetupCommandInput,
  starterLayout: StarterLayout,
  onboarding: SetupSourceOnboardingResult,
): AppliedSetupSourceImport => {
  const target = createSetupSourceImportTargetLayout(input, onboarding.importTarget);

  if (onboarding.importMode === 'symlink') {
    return applySetupSourceSymlinkImport(input, target, onboarding);
  }

  return applySetupSourceCopyImport(starterLayout, target, onboarding);
};

const applySetupSourceSymlinkImport = (
  input: SetupCommandInput,
  target: Pick<AppliedSetupSourceImport, 'settingsPath' | 'settingsDescription' | 'profilesPath'>,
  onboarding: SetupSourceOnboardingResult,
): AppliedSetupSourceImport => {
  const sourceOutfitterPath = resolveLocalSetupSourceOutfitterPath(input);

  if (sourceOutfitterPath === undefined) {
    throw new Error('Local setup-source symlink mode requires a source .outfitter directory.');
  }

  const sourceSettingsPath = join(sourceOutfitterPath, 'settings.yml');

  if (!existsSync(sourceSettingsPath)) {
    throw new Error('Local setup-source symlink mode requires source .outfitter/settings.yml.');
  }

  validateStarterSettingsIfPresent(sourceSettingsPath);

  const sourceProfilesPath = join(sourceOutfitterPath, 'profiles');
  const sourceSelectedProfilePath = findSetupProfilePath(sourceProfilesPath, onboarding.selectedProfileId);

  if (!existsSync(sourceSelectedProfilePath)) {
    throw new Error(`Local setup-source symlink mode requires selected profile '${onboarding.selectedProfileId}'.`);
  }

  symlinkLocalOutfitterSource(sourceOutfitterPath, dirname(target.settingsPath));

  return {
    ...target,
    createdSettings: false,
    copiedStarterProfileFiles: 0,
    copiedStarterResourceFiles: 0,
    selectedProfileAlreadyExists: false,
    symlinkedOutfitter: true,
  };
};

const applySetupSourceCopyImport = (
  starterLayout: StarterLayout,
  target: Pick<AppliedSetupSourceImport, 'settingsPath' | 'settingsDescription' | 'profilesPath'>,
  onboarding: SetupSourceOnboardingResult,
): AppliedSetupSourceImport => {
  const createdSettings = createImportSettingsIfMissing(
    target.settingsPath,
    starterLayout.settingsPath,
    onboarding.selectedProfileId,
  );
  const selectedProfilePath = findSetupProfilePath(target.profilesPath, onboarding.selectedProfileId);
  const selectedProfileAlreadyExists = existsSync(selectedProfilePath);

  ensureLocalProfileSource(target.settingsPath, target.profilesPath);
  updateSettingsDefaultProfile(target.settingsPath, onboarding.selectedProfileId);

  return {
    ...target,
    createdSettings,
    copiedStarterProfileFiles: copyStarterProfileFilesIfPresent(starterLayout.profilesPath, target.profilesPath),
    copiedStarterResourceFiles: copyStarterResourceFilesIfPresent(
      starterLayout.profilesPath,
      dirname(target.settingsPath),
    ),
    selectedProfileAlreadyExists,
    selectedProfileConflictMessage: selectedProfileAlreadyExists
      ? `Existing selected setup-source profile '${onboarding.selectedProfileId}' at ${selectedProfilePath} was not overwritten.`
      : undefined,
    symlinkedOutfitter: false,
  };
};

export type SymlinkDirectory = (target: string, path: string, type: 'dir') => void;

export const symlinkLocalOutfitterSource = (
  sourceOutfitterPath: string,
  targetOutfitterPath: string,
  symlinkDirectory: SymlinkDirectory = symlinkSync,
  platform: NodeJS.Platform = process.platform,
): void => {
  if (existsSync(targetOutfitterPath)) {
    const entries = readdirSync(targetOutfitterPath);

    if (entries.length > 0) {
      throw new Error(
        `Cannot symlink local setup source into non-empty .outfitter directory '${targetOutfitterPath}'. ` +
          'Move it aside or use copy snapshot setup.',
      );
    }

    rmSync(targetOutfitterPath, { recursive: true, force: true });
  }

  mkdirSync(dirname(targetOutfitterPath), { recursive: true });

  try {
    symlinkDirectory(sourceOutfitterPath, targetOutfitterPath, 'dir');
  } catch (error) {
    throw translateSymlinkFailure(error, targetOutfitterPath, platform);
  }
};

// Windows refuses symlink creation without Developer Mode or elevation (EPERM/EACCES);
// surface an actionable choice instead of a raw crash. Never silently fall back to copying.
const translateSymlinkFailure = (error: unknown, targetOutfitterPath: string, platform: NodeJS.Platform): unknown => {
  const code = (error as { readonly code?: unknown } | null)?.code;

  if (platform !== 'win32' || (code !== 'EPERM' && code !== 'EACCES')) {
    return error;
  }

  return new Error(
    `Could not create the development symlink at '${targetOutfitterPath}' (${String(code)}). ` +
      'Windows requires Developer Mode (Settings > System > For developers) or an elevated shell to create symlinks. ' +
      'Enable Developer Mode and retry, or rerun setup and choose the copy snapshot import mode.',
    { cause: error },
  );
};

export const createSetupSourceImportTargetLayout = (
  input: SetupCommandInput,
  target: 'home' | 'project',
): Pick<AppliedSetupSourceImport, 'settingsPath' | 'settingsDescription' | 'profilesPath'> => {
  if (target === 'project') {
    return {
      settingsPath: join(input.projectDirectory, '.outfitter', 'settings.yml'),
      settingsDescription: 'project',
      profilesPath: join(input.projectDirectory, '.outfitter', 'profiles'),
    };
  }

  return {
    settingsPath: join(input.homeDirectory, '.outfitter', 'settings.yml'),
    settingsDescription: 'user',
    profilesPath: join(input.homeDirectory, '.outfitter', 'profiles'),
  };
};

const createImportSettingsIfMissing = (
  settingsPath: string,
  starterSettingsPath: string | undefined,
  selectedProfileId: string,
): boolean => {
  if (existsSync(settingsPath)) {
    return false;
  }

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(
    settingsPath,
    /* v8 ignore next -- setup-source tests exercise starter settings; missing starter settings is defensive fallback. */
    starterSettingsPath === undefined
      ? createLocalProfileSettingsContent(selectedProfileId)
      : readStarterSettingsContent(starterSettingsPath),
  );
  return true;
};

const createLocalProfileSettingsContent = (defaultProfileId: string): string =>
  ['default_profile: ' + defaultProfileId, 'profile_sources:', '  - path: ./profiles', ''].join('\n');

const ensureLocalProfileSource = (settingsPath: string, profilesPath: string): void => {
  const loaded = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user', path: settingsPath }]));
  const sources = loaded.files[0]?.settings.profileSources ?? [];

  if (sources.some((source) => source.path === profilesPath)) {
    return;
  }

  const document = readYamlRecord(settingsPath);
  /* v8 ignore next -- appending to existing non-local source lists is equivalent to the covered empty-source case. */
  const existingSources: readonly unknown[] = Array.isArray(document.profile_sources) ? document.profile_sources : [];
  writeFileSync(
    settingsPath,
    stringify({ ...document, profile_sources: [...existingSources, { path: './profiles' }] }),
  );
};

const readYamlRecord = (path: string): Record<string, unknown> => {
  const parsed = parse(readFileSync(path, 'utf8')) as unknown;
  /* v8 ignore next -- settings schema validation guarantees object documents before this helper mutates them. */
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? { ...(parsed as Record<string, unknown>) }
    : {};
};

export const copyStarterProfileFilesIfPresent = (
  sourceProfilesPath: string | undefined,
  targetProfilesPath: string,
): number => {
  if (sourceProfilesPath === undefined) {
    return 0;
  }

  return copyDirectoryContentsWithoutOverwriting(sourceProfilesPath, targetProfilesPath);
};

const copyStarterResourceFilesIfPresent = (
  sourceProfilesPath: string | undefined,
  targetOutfitterPath: string,
): number => {
  if (sourceProfilesPath === undefined) {
    return 0;
  }

  const sourceOutfitterPath = dirname(sourceProfilesPath);
  return ['prompts', 'deepwork', 'skills'].reduce(
    (copiedFiles, resourceName) =>
      copiedFiles + copyNamedStarterResourceDirectoryIfPresent(sourceOutfitterPath, targetOutfitterPath, resourceName),
    0,
  );
};

const copyNamedStarterResourceDirectoryIfPresent = (
  sourceOutfitterPath: string,
  targetOutfitterPath: string,
  resourceName: string,
): number => {
  const sourceResourcePath = join(sourceOutfitterPath, resourceName);

  if (!existsSync(sourceResourcePath)) {
    return 0;
  }

  return copyDirectoryContentsWithoutOverwriting(sourceResourcePath, join(targetOutfitterPath, resourceName));
};

const copyDirectoryContentsWithoutOverwriting = (sourceDirectory: string, targetDirectory: string): number => {
  mkdirSync(targetDirectory, { recursive: true });
  let copiedFiles = 0;

  for (const entry of readdirSync(sourceDirectory, { withFileTypes: true })) {
    const sourcePath = join(sourceDirectory, entry.name);
    const targetPath = join(targetDirectory, entry.name);

    if (entry.isDirectory()) {
      copiedFiles += copyDirectoryContentsWithoutOverwriting(sourcePath, targetPath);
      continue;
    }

    if (entry.isFile() && !existsSync(targetPath)) {
      mkdirSync(dirname(targetPath), { recursive: true });
      cpSync(sourcePath, targetPath, { force: false });
      copiedFiles += 1;
    }
  }

  return copiedFiles;
};

export const findSetupProfilePath = (profilesPath: string, profileId: string): string => {
  for (const profilePath of [
    join(profilesPath, `${profileId}.yml`),
    join(profilesPath, `${profileId}.yaml`),
    join(profilesPath, profileId, 'profile.yml'),
  ]) {
    if (existsSync(profilePath)) {
      return profilePath;
    }
  }

  return join(profilesPath, profileId, 'profile.yml');
};

export const createDefaultProfileIfMissing = (profilePath: string, profileId: string): boolean => {
  if (existsSync(profilePath)) {
    return false;
  }

  mkdirSync(dirname(profilePath), { recursive: true });
  writeFileSync(profilePath, `id: ${profileId}\nlabel: Default\ncontrols: {}\n`);
  return true;
};
