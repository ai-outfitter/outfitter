// Provides the command object for synchronizing URI-backed profile sources.
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';

import type { Command } from 'commander';
import spawn from 'cross-spawn';

import { createProfileSourceCachePath, normalizeGitUri, redactProfileSourceUriCredentials } from '../../profiles/ProfileCache.js';
import { loadLocalProfileSource } from '../../profiles/ProfileLoader.js';
import type { ProfileSourceReference } from '../../profiles/ProfileSource.js';
import { discoverSettingsLoadPlan, loadSettings } from '../../settings/SettingsLoader.js';
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
  sync(source: ProfileSourceReference & { readonly uri: string }, cachePath: string): SyncSourceStatus;
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
  const loadedSettings = loadSettings(discoverSettingsLoadPlan(input));

  if (loadedSettings.issues.length > 0) {
    throw new Error(`Cannot sync with invalid settings: ${loadedSettings.issues.map(formatSettingsIssue).join('; ')}`);
  }

  const uriSources = loadedSettings.settings.profileSources.filter(hasUri);
  const synchronizer = dependencies.synchronizer ?? createGitSynchronizer();
  const sourceResults = uriSources.map((source) => syncUriSource(input.homeDirectory, source, synchronizer));

  return {
    sources: sourceResults,
    messages: sourceResults.length === 0
      ? ['No URI profile sources configured; nothing to sync.']
      : sourceResults.map((result) => `${result.status}: ${result.uri} -> ${result.cachePath} (${result.message})`),
  };
};

export const createSyncCommand = (dependencies: SyncCommandDependencies = {}): CommandObject => {
  const command: CommandObject = {
    name: 'sync',
    description: 'Synchronize URI-backed Bridl profile sources into the local cache.',
    register(program: Command): void {
      program.command(command.name).description(command.description).action(() => {
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

const syncUriSource = (
  homeDirectory: string,
  source: ProfileSourceReference & { readonly uri: string },
  synchronizer: UriProfileSourceSynchronizer,
): SyncSourceResult => {
  const cachePath = createProfileSourceCachePath(homeDirectory, source.uri);
  const displayUri = redactProfileSourceUriCredentials(source.uri);

  try {
    const status = synchronizer.sync(source, cachePath);
    const validation = loadLocalProfileSource({ path: cachePath, only: source.only, except: source.except });

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
      message: validation.profiles.length === 1
        ? '1 profile validated.'
        : `${validation.profiles.length} profiles validated.`,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    return {
      uri: displayUri,
      cachePath,
      status: 'failed',
      message: redactSensitiveText(message, source.uri),
    };
  }
};

const createGitSynchronizer = (): UriProfileSourceSynchronizer => ({
  sync(source, cachePath) {
    mkdirSync(dirname(cachePath), { recursive: true });

    if (existsSync(cachePath)) {
      runGit(['-C', cachePath, 'pull', '--ff-only']);
      return 'updated';
    }

    runGit(['clone', normalizeGitUri(source.uri), cachePath]);
    return 'updated';
  },
});

const runGit = (args: readonly string[]): void => {
  const result = spawn.sync('git', args, { stdio: 'pipe', encoding: 'utf8' });

  if (result.status !== 0) {
    /* v8 ignore next -- the final fallback only applies if git emits no stdout or stderr. */
    throw new Error((result.stderr || result.stdout || `git ${args.join(' ')} failed`).trim());
  }
};

const hasUri = (source: ProfileSourceReference): source is ProfileSourceReference & { readonly uri: string } =>
  source.uri !== undefined;

const redactSensitiveText = (message: string, uri: string): string =>
  message
    .split(uri)
    .join(redactProfileSourceUriCredentials(uri))
    .split(normalizeGitUri(uri))
    .join(redactProfileSourceUriCredentials(normalizeGitUri(uri)));

const formatSettingsIssue = (issue: { readonly filePath: string; readonly path: string; readonly message: string }): string =>
  `${issue.filePath}#${issue.path} ${issue.message}`;

const formatProfileIssue = (issue: { readonly path: string; readonly message: string }): string =>
  `${issue.path} ${issue.message}`;
