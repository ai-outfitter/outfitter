// Resolves and validates setup starter sources: local .outfitter folders, remote git caches, and starter settings.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import spawn from 'cross-spawn';

import {
  createRemoteRepositoryCachePath,
  normalizeGitUri,
  redactProfileSourceUriCredentials,
} from '../../../profiles/ProfileCache.js';
import { isValidProfileId } from '../../../profiles/ProfileLoader.js';
import { createSettingsLoadPlan, loadSettingsFiles } from '../../../settings/SettingsLoader.js';
import {
  formatSettingsIssue,
  type SetupCommandInput,
  type SetupSourceSynchronizer,
  type StarterLayout,
} from './SetupTypes.js';

export const prepareStarterLayout = (
  homeDirectory: string,
  projectDirectory: string,
  setupSourceUri: string,
  synchronizer: SetupSourceSynchronizer = createGitSetupSourceSynchronizer(),
): StarterLayout => {
  const localOutfitterPath = resolveLocalSetupSourceOutfitterPathFromUri(setupSourceUri, projectDirectory);

  if (localOutfitterPath !== undefined) {
    const settingsPath = join(localOutfitterPath, 'settings.yml');
    validateStarterSettingsIfPresent(existsSync(settingsPath) ? settingsPath : undefined);

    return {
      cachePath: localOutfitterPath,
      settingsPath: existsSync(settingsPath) ? settingsPath : undefined,
      profilesPath: firstExistingPath(join(localOutfitterPath, 'profiles')),
      sourceKind: 'local-live',
      sourceOutfitterPath: localOutfitterPath,
    };
  }

  const cachePath = createSetupSourceCachePath(homeDirectory, setupSourceUri);
  synchronizer.sync(setupSourceUri, cachePath);

  const settingsPath = firstExistingPath(
    join(cachePath, 'settings.yml'),
    join(cachePath, '.outfitter', 'settings.yml'),
  );
  validateStarterSettingsIfPresent(settingsPath);

  const preferredProfilesPath = settingsPath?.endsWith(join('.outfitter', 'settings.yml'))
    ? join(cachePath, '.outfitter', 'profiles')
    : join(cachePath, 'profiles');
  const profilesPath = firstExistingPath(
    preferredProfilesPath,
    join(cachePath, 'profiles'),
    join(cachePath, '.outfitter', 'profiles'),
  );

  return { cachePath, settingsPath, profilesPath, sourceKind: 'remote-cache' };
};

const createSetupSourceCachePath = (homeDirectory: string, setupSourceUri: string): string =>
  createRemoteRepositoryCachePath(homeDirectory, { uri: setupSourceUri });

const createGitSetupSourceSynchronizer = (): SetupSourceSynchronizer => ({
  sync(uri, cachePath) {
    mkdirSync(dirname(cachePath), { recursive: true });

    if (existsSync(cachePath)) {
      runGit(['-C', cachePath, 'pull', '--ff-only'], uri);
      return;
    }

    runGit(['clone', '--', normalizeGitUri(uri), cachePath], uri);
  },
});

const runGit = (args: readonly string[], sensitiveUri: string): void => {
  const result = spawn.sync('git', args, { stdio: 'pipe', encoding: 'utf8' });

  if (result.status !== 0) {
    /* v8 ignore next -- the final fallback only applies if git emits no stdout or stderr. */
    throw new Error(
      redactSensitiveText((result.stderr || result.stdout || `git ${args.join(' ')} failed`).trim(), sensitiveUri),
    );
  }
};

const redactSensitiveText = (message: string, uri: string): string =>
  message
    .split(uri)
    .join(redactProfileSourceUriCredentials(uri))
    .split(normalizeGitUri(uri))
    .join(redactProfileSourceUriCredentials(normalizeGitUri(uri)));

const firstExistingPath = (...paths: readonly string[]): string | undefined => paths.find((path) => existsSync(path));

export const validateStarterSettingsIfPresent = (settingsPath?: string): void => {
  if (settingsPath === undefined) {
    return;
  }

  const loaded = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user', path: settingsPath }]));

  if (loaded.issues.length > 0) {
    throw new Error(`Cannot setup from invalid starter settings: ${loaded.issues.map(formatSettingsIssue).join('; ')}`);
  }
};

export const readStarterDefaultProfileId = (settingsPath?: string): string => {
  if (settingsPath === undefined) {
    return 'engineer';
  }

  const loaded = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user', path: settingsPath }]));
  return loaded.files[0]?.settings.defaultProfile ?? 'engineer';
};

export const readStarterExplicitDefaultProfileId = (settingsPath?: string): string | undefined => {
  if (settingsPath === undefined) {
    return undefined;
  }

  const loaded = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user', path: settingsPath }]));
  return loaded.files[0]?.settings.defaultProfile;
};

export type LoadedSetupSettingsFile = {
  readonly location: { readonly scope: string };
  readonly settings: { readonly defaultProfile?: string };
};

export const readUserDefaultProfileId = (files: readonly LoadedSetupSettingsFile[]): string =>
  files.find((file) => file.location.scope === 'user')?.settings.defaultProfile ?? 'engineer';

export const ensureExistingUserSettingsDefaultProfile = (
  settingsPath: string,
  files: readonly LoadedSetupSettingsFile[],
  defaultProfileId: string,
): void => {
  const userSettings = files.find((file) => file.location.scope === 'user');

  if (userSettings === undefined || userSettings.settings.defaultProfile !== undefined) {
    return;
  }

  const content = readFileSync(settingsPath, 'utf8');
  writeFileSync(settingsPath, `${content}\ndefault_profile: ${defaultProfileId}\n`);
};

export const assertValidDefaultProfileId = (profileId: string): void => {
  if (!isValidProfileId(profileId)) {
    throw new Error(`Default profile '${profileId}' is not a filesystem-safe Outfitter profile id.`);
  }
};

export const createDefaultSettingsContent = (defaultProfileId = 'engineer'): string =>
  [
    `default_profile: ${defaultProfileId}`,
    'profile_sources:',
    '  - github: ai-outfitter/default-profiles',
    '    path: profiles',
    '  - path: ./profiles',
    '',
  ].join('\n');

export const updateSettingsDefaultProfile = (settingsPath: string, profileId: string): void => {
  const content = readFileSync(settingsPath, 'utf8');
  const updatedContent = /^default_profile:.*$/gmu.test(content)
    ? content.replace(/^default_profile:.*$/gmu, `default_profile: ${profileId}`)
    : `${content.replace(/\s*$/u, '\n')}default_profile: ${profileId}\n`;

  writeFileSync(settingsPath, updatedContent);
};

export const createInitialSettingsIfMissing = (settingsPath: string, starterSettingsPath?: string): boolean => {
  if (existsSync(settingsPath)) {
    return false;
  }

  mkdirSync(dirname(settingsPath), { recursive: true });
  writeFileSync(
    settingsPath,
    starterSettingsPath === undefined
      ? createDefaultSettingsContent()
      : readStarterSettingsContent(starterSettingsPath),
  );
  return true;
};

export const readStarterSettingsContent = (starterSettingsPath: string): string => {
  const content = readFileSync(starterSettingsPath, 'utf8');
  const loaded = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user', path: starterSettingsPath }]));

  if (loaded.files[0]?.settings.defaultProfile !== undefined) {
    return content;
  }

  return `default_profile: engineer\n${content}`;
};

/* v8 ignore start -- local setup-source path probing is covered by filesystem integration tests. */
export const resolveLocalSetupSourceOutfitterPath = (input: SetupCommandInput): string | undefined =>
  input.setupSourceUri === undefined
    ? undefined
    : resolveLocalSetupSourceOutfitterPathFromUri(input.setupSourceUri, input.projectDirectory);

export const resolveLocalSetupSourceOutfitterPathFromUri = (
  setupSourceUri: string,
  projectDirectory: string,
): string | undefined => {
  if (isRemoteSetupSourceUri(setupSourceUri)) {
    return undefined;
  }

  const sourcePath = isAbsolute(setupSourceUri) ? setupSourceUri : resolve(projectDirectory, setupSourceUri);
  const outfitterPath = sourcePath.endsWith('.outfitter') ? sourcePath : join(sourcePath, '.outfitter');

  return existsSync(outfitterPath) ? outfitterPath : undefined;
};

const isRemoteSetupSourceUri = (source: string): boolean => /^[a-z][a-z0-9+.-]*:/iu.test(source) && !isAbsolute(source);
/* v8 ignore stop */
