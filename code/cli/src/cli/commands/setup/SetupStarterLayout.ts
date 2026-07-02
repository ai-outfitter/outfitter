// Resolves and validates the starter layout for a provided setup source (local path or git URI).
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import spawn from 'cross-spawn';

import {
  createRemoteRepositoryCachePath,
  normalizeGitUri,
  redactProfileSourceUriCredentials,
} from '../../../profiles/ProfileCache.js';
import { createSettingsLoadPlan, loadSettingsFiles } from '../../../settings/SettingsLoader.js';
import { formatSettingsIssue } from './SetupTypes.js';
import type { SetupCommandInput, SetupSourceSynchronizer, StarterLayout } from './SetupTypes.js';

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

export const firstExistingPath = (...paths: readonly string[]): string | undefined =>
  paths.find((path) => existsSync(path));

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

export const readStarterSettingsContent = (starterSettingsPath: string): string => {
  const content = readFileSync(starterSettingsPath, 'utf8');
  const loaded = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user', path: starterSettingsPath }]));

  if (loaded.files[0]?.settings.defaultProfile !== undefined) {
    return content;
  }

  return `default_profile: engineer\n${content}`;
};

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
