// Provides the command object for synchronizing URI-backed profile and settings sources.
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';

import type { Command } from 'commander';
import spawn from 'cross-spawn';

import {
  createProfileSourceCachePath,
  createRemoteRepositoryCachePath,
  normalizeGitUri,
  redactProfileSourceUriCredentials,
  resolveRemoteRepositorySubpath,
} from '../../profiles/ProfileCache.js';
import { loadLocalProfileSource } from '../../profiles/ProfileLoader.js';
import {
  normalizeRemoteSourceUri,
  type ProfileSourceReference,
  type RemoteSourceReference,
} from '../../profiles/ProfileSource.js';
import type { RemoteSettingsReference } from '../../settings/Settings.js';
import {
  discoverSettingsLoadPlan,
  loadSettings,
  loadSettingsWithCachedRemoteSettings,
} from '../../settings/SettingsLoader.js';
import type { CommandObject } from './CommandObject.js';

export type SyncSourceStatus = 'updated' | 'unchanged' | 'skipped' | 'failed';

export interface SyncCommandInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
}

export interface SyncSourceResult {
  readonly uri: string;
  readonly cachePath: string;
  readonly status: SyncSourceStatus;
  readonly message: string;
}

export interface SyncCommandResult {
  readonly sources: readonly SyncSourceResult[];
  readonly messages: readonly string[];
}

export interface UriProfileSourceSynchronizer {
  sync(source: RemoteSourceReference, cachePath: string): SyncSourceStatus;
}

export interface SyncCommandDependencies {
  readonly synchronizer?: UriProfileSourceSynchronizer;
  readonly homeDirectory?: string;
  readonly projectDirectory?: string;
  readonly writeLine?: (message: string) => void;
}

export const executeSyncCommand = (
  input: SyncCommandInput,
  dependencies: SyncCommandDependencies = {},
): SyncCommandResult => {
  const localSettings = loadSettings(discoverSettingsLoadPlan(input));

  if (localSettings.issues.length > 0) {
    throw new Error(`Cannot sync with invalid settings: ${localSettings.issues.map(formatSettingsIssue).join('; ')}`);
  }

  const synchronizer = dependencies.synchronizer ?? createGitSynchronizer();
  const remoteSettingsSources = localSettings.settings.remoteSettings!;
  const remoteSettingsResults = remoteSettingsSources.map((source) =>
    syncRemoteSettingsSource(input.homeDirectory, source, synchronizer),
  );
  const syncedRemoteSettingsSources = remoteSettingsSources.filter(
    (_source, index) => remoteSettingsResults[index]?.status !== 'failed',
  );
  const loadedSettings = loadSettingsWithCachedRemoteSettings(input, syncedRemoteSettingsSources);

  if (loadedSettings.issues.length > 0) {
    throw new Error(`Cannot sync with invalid settings: ${loadedSettings.issues.map(formatSettingsIssue).join('; ')}`);
  }

  const uriSources = loadedSettings.settings.profileSources!.filter(isRemoteProfileSource);
  const profileSourceResults = uriSources.map((source) => syncUriSource(input.homeDirectory, source, synchronizer));
  const sourceResults = [...remoteSettingsResults, ...profileSourceResults];

  return {
    sources: sourceResults,
    messages:
      sourceResults.length === 0
        ? ['No URI profile or remote settings sources configured; nothing to sync.']
        : sourceResults.map((result) => `${result.status}: ${result.uri} -> ${result.cachePath} (${result.message})`),
  };
};

export const createSyncCommand = (dependencies: SyncCommandDependencies = {}): CommandObject => {
  const command: CommandObject = {
    name: 'sync',
    description: 'Synchronize URI-backed Outfitter profile and remote settings sources into the local cache.',
    register(program: Command): void {
      program
        .command(command.name)
        .description(command.description)
        .action(() => {
          const result = executeSyncCommand(
            {
              /* v8 ignore next -- default process home is exercised by the direct CLI entrypoint, not unit tests. */
              homeDirectory: dependencies.homeDirectory ?? homedir(),
              /* v8 ignore next -- default process cwd is exercised by the direct CLI entrypoint, not unit tests. */
              projectDirectory: dependencies.projectDirectory ?? process.cwd(),
            },
            dependencies,
          );

          for (const message of result.messages) {
            /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
            (dependencies.writeLine ?? console.log)(message);
          }
        });
    },
  };

  return command;
};

const syncRemoteSettingsSource = (
  homeDirectory: string,
  source: RemoteSettingsReference,
  synchronizer: UriProfileSourceSynchronizer,
): SyncSourceResult => {
  const cachePath = createRemoteRepositoryCachePath(homeDirectory, source);
  const displayUri = formatDisplayUri(source);

  try {
    const settingsPath = resolveRemoteRepositorySubpath(cachePath, source.path);
    const status = synchronizer.sync(source, cachePath);

    if (!existsSync(settingsPath)) {
      return {
        uri: displayUri,
        cachePath,
        status: 'failed',
        message: `Remote settings file not found: ${settingsPath}`,
      };
    }

    return { uri: displayUri, cachePath, status, message: `Remote settings file available at ${settingsPath}.` };
  } catch (error) {
    return formatSyncFailure(displayUri, cachePath, source, error);
  }
};

const syncUriSource = (
  homeDirectory: string,
  source: RemoteProfileSource,
  synchronizer: UriProfileSourceSynchronizer,
): SyncSourceResult => {
  const cachePath = remoteCachePathForProfileSource(homeDirectory, source);
  const displayUri = formatDisplayUri(source);

  try {
    const profileSourcePath = resolveRemoteRepositorySubpath(cachePath, source.path);
    const status = synchronizer.sync(source, cachePath);
    const validation = loadLocalProfileSource({
      path: profileSourcePath,
      only: source.only,
      except: source.except,
    });

    if (validation.issues.length > 0) {
      return {
        uri: displayUri,
        cachePath,
        status: 'failed',
        message: `Synced source failed profile validation: ${validation.issues.map(formatProfileIssue).join('; ')}`,
      };
    }

    return {
      uri: displayUri,
      cachePath,
      status,
      message:
        validation.profiles.length === 1 ? '1 profile validated.' : `${validation.profiles.length} profiles validated.`,
    };
  } catch (error) {
    return formatSyncFailure(displayUri, cachePath, source, error);
  }
};

export const createGitSynchronizer = (): UriProfileSourceSynchronizer => ({
  sync(source, cachePath) {
    mkdirSync(dirname(cachePath), { recursive: true });

    if (existsSync(cachePath)) {
      runGit(['-C', cachePath, 'fetch', '--all', '--tags']);
      if (source.ref === undefined) {
        runGit(['-C', cachePath, 'pull', '--ff-only']);
      } else {
        checkoutRefIfPresent(cachePath, source.ref);
      }
      return 'updated';
    }

    runGit(['clone', '--', normalizeGitUri(normalizeRemoteSourceUri(source)), cachePath]);
    checkoutRefIfPresent(cachePath, source.ref);
    return 'updated';
  },
});

const checkoutRefIfPresent = (cachePath: string, ref: string | undefined): void => {
  if (ref === undefined) {
    return;
  }

  assertSafeGitRef(ref);

  if (gitSucceeds(['-C', cachePath, 'rev-parse', '--verify', '--quiet', `refs/remotes/origin/${ref}`])) {
    runGit(['-C', cachePath, 'checkout', '-B', ref, `refs/remotes/origin/${ref}`]);
    return;
  }

  runGit(['-C', cachePath, 'checkout', ref]);
};

const assertSafeGitRef = (ref: string): void => {
  if (ref.startsWith('-')) {
    throw new Error(`Git ref '${ref}' must not start with '-'.`);
  }
};

const gitSucceeds = (args: readonly string[]): boolean =>
  spawn.sync('git', args, { stdio: 'pipe', encoding: 'utf8' }).status === 0;

const runGit = (args: readonly string[]): void => {
  const result = spawn.sync('git', args, { stdio: 'pipe', encoding: 'utf8' });

  if (result.status !== 0) {
    /* v8 ignore next -- the final fallback only applies if git emits no stdout or stderr. */
    throw new Error((result.stderr || result.stdout || `git ${args.join(' ')} failed`).trim());
  }
};

export type RemoteProfileSource = ProfileSourceReference & ({ readonly uri: string } | { readonly github: string });

export const syncProfileSource = (
  homeDirectory: string,
  source: RemoteProfileSource,
  synchronizer: UriProfileSourceSynchronizer = createGitSynchronizer(),
): SyncSourceResult => syncUriSource(homeDirectory, source, synchronizer);

const isRemoteProfileSource = (source: ProfileSourceReference): source is RemoteProfileSource =>
  source.uri !== undefined || source.github !== undefined;

const remoteCachePathForProfileSource = (homeDirectory: string, source: RemoteProfileSource): string => {
  if (source.ref === undefined && source.path === undefined && source.uri !== undefined) {
    return createProfileSourceCachePath(homeDirectory, source.uri);
  }

  return createRemoteRepositoryCachePath(homeDirectory, source);
};

const formatDisplayUri = (source: RemoteSourceReference): string => {
  const uri = redactProfileSourceUriCredentials(normalizeRemoteSourceUri(source));
  const ref = source.ref === undefined ? '' : `#${source.ref}`;
  const path = source.path === undefined ? '' : `:${source.path}`;
  return `${uri}${ref}${path}`;
};

const formatSyncFailure = (
  displayUri: string,
  cachePath: string,
  source: RemoteSourceReference,
  error: unknown,
): SyncSourceResult => {
  const message = error instanceof Error ? error.message : String(error);

  return {
    uri: displayUri,
    cachePath,
    status: 'failed',
    message: redactSensitiveText(message, normalizeRemoteSourceUri(source)),
  };
};

const redactSensitiveText = (message: string, uri: string): string =>
  message
    .split(uri)
    .join(redactProfileSourceUriCredentials(uri))
    .split(normalizeGitUri(uri))
    .join(redactProfileSourceUriCredentials(normalizeGitUri(uri)));

const formatSettingsIssue = (issue: {
  readonly filePath: string;
  readonly path: string;
  readonly message: string;
}): string => `${issue.filePath}#${issue.path} ${issue.message}`;

const formatProfileIssue = (issue: { readonly path: string; readonly message: string }): string =>
  `${issue.path} ${issue.message}`;
