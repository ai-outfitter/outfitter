// Provides the command object for synchronizing URI-backed profile and settings sources.
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

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
import { enablePrivateProfileCatalogs, isPrivateProfileCatalogsEnabled } from '../../settings/EnterpriseSettings.js';
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

export type GitHubRepositoryVisibility = 'public' | 'private' | 'unknown';

export interface GitHubRepositoryVisibilityClassifier {
  classify(repository: string): GitHubRepositoryVisibility;
}

export interface PrivateCatalogPrompt {
  readonly interactive: boolean;
  confirm(repository: string): boolean;
}

export interface SyncCommandDependencies {
  readonly synchronizer?: UriProfileSourceSynchronizer;
  readonly repositoryVisibilityClassifier?: GitHubRepositoryVisibilityClassifier;
  readonly privateCatalogPrompt?: PrivateCatalogPrompt;
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
  const repositoryVisibilityClassifier =
    dependencies.repositoryVisibilityClassifier ?? createGitHubRepositoryVisibilityClassifier();
  const privateCatalogGate = createPrivateCatalogGate(
    input.homeDirectory,
    repositoryVisibilityClassifier,
    dependencies,
  );
  const remoteSettingsSources = localSettings.settings.remoteSettings!;
  const remoteSettingsGateResults = gatePrivateCatalogSources(remoteSettingsSources, privateCatalogGate);
  const remoteSettingsResults = remoteSettingsGateResults.allowedSources.map((source) =>
    syncRemoteSettingsSource(input.homeDirectory, source, synchronizer),
  );
  const syncedRemoteSettingsSources = remoteSettingsGateResults.allowedSources.filter(
    (_source, index) => remoteSettingsResults[index]?.status !== 'failed',
  );
  const loadedSettings = loadSettingsWithCachedRemoteSettings(input, syncedRemoteSettingsSources);

  if (loadedSettings.issues.length > 0) {
    throw new Error(`Cannot sync with invalid settings: ${loadedSettings.issues.map(formatSettingsIssue).join('; ')}`);
  }

  const uriSources = loadedSettings.settings.profileSources!.filter(isRemoteProfileSource);
  const profileSourceGateResults = gatePrivateCatalogSources(uriSources, privateCatalogGate);
  const profileSourceResults = profileSourceGateResults.allowedSources.map((source) =>
    syncUriSource(input.homeDirectory, source, synchronizer),
  );
  const sourceResults = [
    ...remoteSettingsResults,
    ...remoteSettingsGateResults.skippedResults,
    ...profileSourceResults,
    ...profileSourceGateResults.skippedResults,
  ];
  const infoMessages = [...remoteSettingsGateResults.messages, ...profileSourceGateResults.messages];

  return {
    sources: sourceResults,
    messages:
      sourceResults.length === 0
        ? ['No URI profile or remote settings sources configured; nothing to sync.']
        : [
            ...infoMessages,
            ...sourceResults.map(
              (result) => `${result.status}: ${result.uri} -> ${result.cachePath} (${result.message})`,
            ),
          ],
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

interface PrivateCatalogGate {
  readonly settingsPath: string;
  readonly classifier: GitHubRepositoryVisibilityClassifier;
  readonly prompt: PrivateCatalogPrompt;
  enabled: boolean;
}

interface PrivateCatalogGateResults<Source extends RemoteSourceReference> {
  readonly allowedSources: readonly Source[];
  readonly skippedResults: readonly SyncSourceResult[];
  readonly messages: readonly string[];
}

const createPrivateCatalogGate = (
  homeDirectory: string,
  classifier: GitHubRepositoryVisibilityClassifier,
  dependencies: SyncCommandDependencies,
): PrivateCatalogGate => {
  const homeSettingsPath = join(homeDirectory, '.outfitter', 'settings.yml');

  return {
    settingsPath: homeSettingsPath,
    classifier,
    prompt: dependencies.privateCatalogPrompt ?? createTtyPrivateCatalogPrompt(),
    enabled: isPrivateProfileCatalogsEnabled(homeSettingsPath),
  };
};

const gatePrivateCatalogSources = <Source extends RemoteSourceReference>(
  sources: readonly Source[],
  gate: PrivateCatalogGate,
): PrivateCatalogGateResults<Source> => {
  const allowedSources: Source[] = [];
  const skippedResults: SyncSourceResult[] = [];
  const messages: string[] = [];
  const promptedRepositories = new Set<string>();

  for (const source of sources) {
    const repository = source.github;
    if (repository === undefined || gate.enabled || gate.classifier.classify(repository) !== 'private') {
      allowedSources.push(source);
      continue;
    }

    if (!promptedRepositories.has(repository) && gate.prompt.interactive && gate.prompt.confirm(repository)) {
      enablePrivateProfileCatalogs(gate.settingsPath);
      gate.enabled = true;
      messages.push('info: Enabled private profile catalogs in ~/.outfitter/settings.yml.');
      allowedSources.push(source);
      continue;
    }

    promptedRepositories.add(repository);
    messages.push(formatPrivateCatalogSkippedMessage(repository, gate.prompt.interactive));
    skippedResults.push({
      uri: formatDisplayUri(source),
      cachePath: remoteCachePathForPrivateCatalogSkip(gate.settingsPath, source),
      status: 'skipped',
      message: `Private profile catalog setup was skipped for ${repository}; no settings were changed.`,
    });
  }

  return { allowedSources, skippedResults, messages };
};

const createTtyPrivateCatalogPrompt = (): PrivateCatalogPrompt => ({
  interactive: process.stdin.isTTY === true && process.stdout.isTTY === true,
  confirm(repository) {
    const prompt = formatPrivateCatalogPrompt(repository);
    const result = spawn.sync(
      'sh',
      [
        '-c',
        'printf "%s" "$OUTFITTER_PRIVATE_CATALOG_PROMPT" > /dev/tty && IFS= read -r answer < /dev/tty && case "$answer" in y|Y|yes|YES) exit 0 ;; *) exit 1 ;; esac',
      ],
      { env: { ...process.env, OUTFITTER_PRIVATE_CATALOG_PROMPT: prompt }, stdio: 'inherit' },
    );
    return result.status === 0;
  },
});

const formatPrivateCatalogPrompt = (repository: string): string =>
  [
    `Private GitHub profile catalog detected: ${repository}.`,
    '',
    'Private profile catalog support is covered by the Outfitter Enterprise license.',
    'Review code/enterprise/LICENSE or your enterprise agreement before enabling.',
    '',
    'Enable private profile catalogs in ~/.outfitter/settings.yml? [y/N] ',
  ].join('\n');

const formatPrivateCatalogSkippedMessage = (repository: string, interactive: boolean): string =>
  interactive
    ? `info: Private profile catalog setup was skipped for ${repository}; no settings were changed.`
    : `info: Private GitHub profile catalog detected: ${repository}. Enable enterprise.private_profile_catalogs in ~/.outfitter/settings.yml after reviewing code/enterprise/LICENSE or your enterprise agreement.`;

const remoteCachePathForPrivateCatalogSkip = (settingsPath: string, source: RemoteSourceReference): string =>
  createRemoteRepositoryCachePath(dirname(dirname(settingsPath)), source);

export const createGitHubRepositoryVisibilityClassifier = (): GitHubRepositoryVisibilityClassifier => ({
  classify(repository) {
    if (process.env.VITEST !== undefined) {
      return 'unknown';
    }

    const [owner, repo] = repository.split('/');

    if (!owner || !repo) {
      return 'unknown';
    }

    const script = `
      import https from 'node:https';
      const [owner, repo] = process.argv.slice(1);
      const request = https.get({
        hostname: 'api.github.com',
        path: '/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo),
        headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'ai-outfitter-cli' },
        timeout: 2000,
      }, (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => { body += chunk; });
        response.on('end', () => {
          if (response.statusCode !== 200) {
            console.log('unknown');
            return;
          }
          try {
            const document = JSON.parse(body);
            console.log(document.private === true ? 'private' : document.private === false ? 'public' : 'unknown');
          } catch {
            console.log('unknown');
          }
        });
      });
      request.on('timeout', () => request.destroy());
      request.on('error', () => console.log('unknown'));
    `;
    const result = spawn.sync(process.execPath, ['--input-type=module', '--eval', script, owner, repo], {
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 3000,
    });
    const visibility = result.stdout.trim();

    return visibility === 'private' || visibility === 'public' ? visibility : 'unknown';
  },
});

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
