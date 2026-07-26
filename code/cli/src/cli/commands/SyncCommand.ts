// Implements deterministic remote-settings-first source synchronization.
import { existsSync } from 'node:fs';

import { Command } from 'commander';

import { remoteSourceLayer } from '../../resolver/Layer.js';
import { resolveResources } from '../../resolver/Resolver.js';
import { validateEffectiveSet } from '../../resolver/ResolverValidation.js';
import {
  createSettingsLoadPlan,
  discoverSettingsLoadPlan,
  formatSettingsIssue,
  loadSettings,
  loadSettingsFiles,
  loadSettingsWithCachedRemoteSettings,
  resolveRemoteSettingsPath,
} from '../../settings/SettingsLoader.js';
import type { SettingsLoadIssue } from '../../settings/SettingsLoader.js';
import type { RemoteSettingsReference } from '../../settings/Settings.js';
import { syncRemoteRepositoryAtomically } from '../../sources/GitRepository.js';
import {
  createEnterprisePrivateCatalogGate,
  type GitHubRepositoryVisibilityClassifier,
  type PrivateCatalogPrompt,
  type PrivateCatalogSourceGate,
} from '../../sources/PrivateCatalogGate.js';
import {
  createRemoteRepositoryCachePath,
  formatRemoteSourceDisplay,
  isRemoteSource,
  redactEmbeddedSourceCredentials,
} from '../../sources/SourceCache.js';
import type { RemoteSourceReference } from '../../sources/SourceCache.js';
import type { CommandObject } from './CommandObject.js';
import { resolveHomeDirectory, resolveProjectDirectory } from './ProcessDefaults.js';

export type SyncStatus = 'updated' | 'unchanged' | 'skipped' | 'failed';
export type SyncSourceKind = 'remote_settings' | 'source';

export interface SyncSourceResult {
  readonly kind: SyncSourceKind;
  readonly uri: string;
  readonly cachePath: string;
  readonly status: SyncStatus;
  readonly message?: string;
}

export interface SyncCommandResult {
  readonly exitCode: number;
  readonly messages: readonly string[];
  readonly results: readonly SyncSourceResult[];
}

export interface SyncCommandInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
}

export interface SyncCommandDependencies {
  readonly homeDirectory?: string;
  readonly projectDirectory?: string;
  readonly classifier?: GitHubRepositoryVisibilityClassifier;
  readonly prompt?: PrivateCatalogPrompt;
  readonly privateCatalogGate?: PrivateCatalogSourceGate;
  readonly writeLine?: (message: string) => void;
}

interface SyncPhaseResult<T extends RemoteSourceReference> {
  readonly allowedSources: readonly T[];
  readonly messages: readonly string[];
  readonly results: readonly SyncSourceResult[];
}

const formatSettingsIssues = (heading: string, issues: readonly SettingsLoadIssue[]): readonly string[] => [
  heading,
  ...issues.map((issue) => `failed: ${formatSettingsIssue(issue)}`),
];

const formatResult = (result: SyncSourceResult): string =>
  `${result.status}: ${result.kind} ${result.uri} -> ${result.cachePath}${
    result.message === undefined ? '' : ` (${result.message})`
  }`;

const formatCaughtError = (error: unknown): string => {
  /* v8 ignore else -- repository synchronization throws Error instances. */
  if (error instanceof Error) return error.message;
  return String(error);
};

const validateRemoteSettingsCheckout = (repositoryPath: string, source: RemoteSettingsReference): number => {
  const settingsPath = resolveRemoteSettingsPath(repositoryPath, source.path);
  if (!existsSync(settingsPath)) {
    throw new Error(`Remote settings file '${source.path}' was not found in the fetched repository.`);
  }
  const loaded = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'remote', path: settingsPath }]));
  if (loaded.issues.length > 0) {
    throw new Error(`Fetched remote settings are invalid: ${loaded.issues.map(formatSettingsIssue).join('; ')}`);
  }
  return 0;
};

const validateSourceCheckout = (repositoryPath: string, source: RemoteSourceReference): number => {
  const layer = remoteSourceLayer(repositoryPath, source);
  if (!existsSync(layer.root)) {
    throw new Error(`Configured source path '${source.path}' was not found in the fetched repository.`);
  }

  const findings = validateEffectiveSet(resolveResources([layer]));
  const errors = findings.filter((finding) => finding.severity === 'error');
  if (errors.length > 0) {
    throw new Error(
      `Fetched source is invalid: ${errors.map((finding) => `${finding.resource} ${finding.message}`).join('; ')}`,
    );
  }
  return findings.length;
};

interface SyncPhaseInput<T extends RemoteSourceReference> {
  readonly kind: SyncSourceKind;
  readonly sources: readonly T[];
  readonly homeDirectory: string;
  readonly cacheDirectory?: string;
  readonly gate: PrivateCatalogSourceGate;
  readonly validate: (repositoryPath: string, source: T) => number;
}

/** Runs the private-catalog gate over one phase's sources, then fetches everything it allowed. */
const syncPhase = <T extends RemoteSourceReference>(input: SyncPhaseInput<T>): SyncPhaseResult<T> => {
  const gated = input.gate.filter(input.sources, input.cacheDirectory);
  const synced = gated.allowedSources.map((source): SyncSourceResult => {
    const cachePath = createRemoteRepositoryCachePath(input.homeDirectory, source, input.cacheDirectory);
    const uri = formatRemoteSourceDisplay(source);

    try {
      const result = syncRemoteRepositoryAtomically({
        cachePath,
        source,
        validate: (repositoryPath) => input.validate(repositoryPath, source),
      });
      return {
        kind: input.kind,
        uri,
        cachePath,
        status: result.status,
        message: result.warnings === 0 ? undefined : `validated with ${result.warnings} warning(s)`,
      };
    } catch (error) {
      return {
        kind: input.kind,
        uri,
        cachePath,
        status: 'failed',
        message: redactEmbeddedSourceCredentials(formatCaughtError(error)),
      };
    }
  });

  return {
    allowedSources: gated.allowedSources,
    messages: gated.messages,
    results: [...gated.skippedResults.map((result) => ({ ...result, kind: input.kind })), ...synced],
  };
};

const finishSync = (
  mergedIssues: readonly SettingsLoadIssue[],
  remoteSettingsPhase: SyncPhaseResult<RemoteSettingsReference>,
  sourcePhase: SyncPhaseResult<RemoteSourceReference>,
): SyncCommandResult => {
  const results = [...remoteSettingsPhase.results, ...sourcePhase.results];
  const settingsMessages =
    mergedIssues.length === 0
      ? []
      : formatSettingsIssues('Merged settings contain errors after remote-settings synchronization.', mergedIssues);
  const messages = [
    ...remoteSettingsPhase.messages,
    ...remoteSettingsPhase.results.map(formatResult),
    ...settingsMessages,
    ...sourcePhase.messages,
    ...sourcePhase.results.map(formatResult),
  ];

  if (results.length === 0 && mergedIssues.length === 0) {
    messages.push('No remote sources are configured.');
  }

  return {
    exitCode: mergedIssues.length > 0 || results.some((result) => result.status === 'failed') ? 1 : 0,
    messages,
    results,
  };
};

/** Validates local settings, syncs remote settings, reloads, then syncs resulting remote sources. */
export const executeSyncCommand = (
  input: SyncCommandInput,
  dependencies: Pick<SyncCommandDependencies, 'classifier' | 'prompt' | 'privateCatalogGate'> = {},
): SyncCommandResult => {
  const local = loadSettings(discoverSettingsLoadPlan(input));
  if (local.issues.length > 0) {
    return {
      exitCode: 1,
      messages: formatSettingsIssues('Local settings are invalid; no sources were synchronized.', local.issues),
      results: [],
    };
  }

  const gate =
    dependencies.privateCatalogGate ??
    createEnterprisePrivateCatalogGate({
      homeDirectory: input.homeDirectory,
      classifier: dependencies.classifier,
      prompt: dependencies.prompt,
    });
  const remoteSettingsPhase = syncPhase({
    kind: 'remote_settings',
    sources: local.settings.remoteSettings!,
    homeDirectory: input.homeDirectory,
    cacheDirectory: local.settings.cacheDirectory,
    gate,
    validate: validateRemoteSettingsCheckout,
  });
  const merged = loadSettingsWithCachedRemoteSettings(input, {
    remoteSettingsReferences: remoteSettingsPhase.allowedSources,
    localSettings: local,
  });
  const sourcePhase = syncPhase({
    kind: 'source',
    sources: merged.settings.sources!.filter(isRemoteSource),
    homeDirectory: input.homeDirectory,
    cacheDirectory: merged.settings.cacheDirectory,
    gate,
    validate: validateSourceCheckout,
  });
  return finishSync(merged.issues, remoteSettingsPhase, sourcePhase);
};

export const createSyncCommand = (dependencies: SyncCommandDependencies = {}): CommandObject => ({
  name: 'sync',
  description: 'Synchronize configured remote settings and sources into the local cache.',
  register(program: Command): void {
    program.addCommand(
      new Command('sync')
        .description('Synchronize configured remote settings and sources into the local cache.')
        .action(() => {
          const result = executeSyncCommand(
            {
              homeDirectory: resolveHomeDirectory(dependencies.homeDirectory),
              projectDirectory: resolveProjectDirectory(dependencies.projectDirectory),
            },
            dependencies,
          );
          for (const message of result.messages) {
            /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
            (dependencies.writeLine ?? console.log)(message);
          }
          /* v8 ignore next -- process exit wiring is covered by CLI smoke behavior. */
          if (result.exitCode !== 0) process.exitCode = result.exitCode;
        }),
    );
  },
});
