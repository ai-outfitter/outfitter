// Implements deterministic remote-settings-first source synchronization.
import { existsSync } from 'node:fs';

import { Command } from 'commander';

import { strictAmbiguityFailureMessage } from '../../resolver/AmbiguityWarnings.js';
import { remoteSourceLayer } from '../../resolver/Layer.js';
import { resolveResources } from '../../resolver/Resolver.js';
import { resolveEffectiveSet } from '../../resolver/ResolverContext.js';
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
import { syncRemoteRepositoryAtomically, tryReadCleanHead } from '../../sources/GitRepository.js';
import {
  createEnterprisePrivateCatalogGate,
  type GitHubRepositoryVisibilityClassifier,
  type PrivateCatalogPrompt,
  type PrivateCatalogSourceGate,
} from '../../sources/PrivateCatalogGate.js';
import {
  createRemoteRepositoryCachePath,
  encodeRemoteSourceSelection,
  formatRemoteSourceDisplay,
  isRemoteSource,
  redactEmbeddedSourceCredentials,
  resolveSourcePayloadRoot,
} from '../../sources/SourceCache.js';
import type { RemoteSourceReference } from '../../sources/SourceCache.js';
import { readDeclaredRemoteSources } from '../../sources/TransitiveSources.js';
import type { CommandObject } from './CommandObject.js';
import { resolveHomeDirectory, resolveProjectDirectory } from './ProcessDefaults.js';

export type SyncStatus = 'updated' | 'unchanged' | 'skipped' | 'failed';
export type SyncSourceKind = 'remote_settings' | 'source' | 'transitive';

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
  readonly strict?: boolean;
}

/** Fetches one repository into the cache. Injectable so tests exercise the closure hermetically. */
export type RepositorySync = typeof syncRemoteRepositoryAtomically;

export interface SyncCommandDependencies {
  readonly homeDirectory?: string;
  readonly projectDirectory?: string;
  readonly classifier?: GitHubRepositoryVisibilityClassifier;
  readonly prompt?: PrivateCatalogPrompt;
  readonly privateCatalogGate?: PrivateCatalogSourceGate;
  readonly writeLine?: (message: string) => void;
  readonly syncRepository?: RepositorySync;
}

interface SyncPhaseResult<T extends RemoteSourceReference> {
  readonly allowedSources: readonly T[];
  readonly messages: readonly string[];
  readonly results: readonly SyncSourceResult[];
  /** The subset of `allowedSources` whose checkout is now readable (status updated/unchanged). */
  readonly readableSources: readonly T[];
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

  // A source is validated in isolation here, so an unresolved loadout slug is deferred (a warning,
  // not a failure): a catalog may reference a skill supplied by a catalog it declares as a transitive
  // dependency (OFTR-004.6), and loadout wholeness is validated against the merged tree at resolution.
  const findings = validateEffectiveSet(resolveResources([layer]), undefined, { deferLoadoutResolution: true });
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
  readonly syncRepository: RepositorySync;
  readonly validate: (repositoryPath: string, source: T) => number;
}

/** Runs the private-catalog gate over one phase's sources, then fetches everything it allowed. */
const syncPhase = <T extends RemoteSourceReference>(input: SyncPhaseInput<T>): SyncPhaseResult<T> => {
  const gated = input.gate.filter(input.sources, input.cacheDirectory);
  // Pair each source with its own result so a later step reads the checkout by identity, never by a
  // display string (which omits a `uri:` source's ref and would collide across refs).
  const synced = gated.allowedSources.map((source): { readonly source: T; readonly result: SyncSourceResult } => {
    const cachePath = createRemoteRepositoryCachePath(input.homeDirectory, source, input.cacheDirectory);
    const uri = formatRemoteSourceDisplay(source);

    try {
      const result = input.syncRepository({
        cachePath,
        source,
        validate: (repositoryPath) => input.validate(repositoryPath, source),
      });
      return {
        source,
        result: {
          kind: input.kind,
          uri,
          cachePath,
          status: result.status,
          message: result.warnings === 0 ? undefined : `validated with ${result.warnings} warning(s)`,
        },
      };
    } catch (error) {
      return {
        source,
        result: {
          kind: input.kind,
          uri,
          cachePath,
          status: 'failed',
          message: redactEmbeddedSourceCredentials(formatCaughtError(error)),
        },
      };
    }
  });

  return {
    allowedSources: gated.allowedSources,
    messages: gated.messages,
    results: [
      ...gated.skippedResults.map((result) => ({ ...result, kind: input.kind })),
      ...synced.map((s) => s.result),
    ],
    // A source is traversable when its checkout is readable on disk *now* — not only when this run
    // refreshed it. A failed refresh leaves the prior valid cache in place (atomic sync) and
    // resolution keeps using it, so its declared dependencies must still be discovered; a failed
    // first fetch leaves no checkout, so it is correctly excluded.
    readableSources: synced.filter((s) => tryReadCleanHead(s.result.cachePath) !== undefined).map((s) => s.source),
  };
};

interface TransitiveClosureInput {
  readonly homeDirectory: string;
  readonly cacheDirectory?: string;
  readonly gate: PrivateCatalogSourceGate;
  readonly syncRepository: RepositorySync;
  /** Every directly configured remote source, seeding the visited set (OFTR-004.6.6). */
  readonly directRemoteSources: readonly RemoteSourceReference[];
  readonly sourcePhase: SyncPhaseResult<RemoteSourceReference>;
}

interface TransitiveClosureResult {
  readonly messages: readonly string[];
  readonly results: readonly SyncSourceResult[];
}

/** Fetches sources declared by synced catalogs until no new sources remain (OFTR-004.6.7). */
const syncTransitiveClosure = (input: TransitiveClosureInput): TransitiveClosureResult => {
  const messages: string[] = [];
  const results: SyncSourceResult[] = [];
  const visited = new Set(input.directRemoteSources.map(encodeRemoteSourceSelection));

  let frontier = input.sourcePhase.readableSources;
  while (frontier.length > 0) {
    const discovered: RemoteSourceReference[] = [];

    for (const parent of frontier) {
      const checkoutRoot = createRemoteRepositoryCachePath(input.homeDirectory, parent, input.cacheDirectory);
      // An absolute or escaping `path:` on a directly configured source throws here; skip it rather
      // than crash sync (transitive sources are path-less and never reach this).
      let payloadRoot: string;
      try {
        payloadRoot = resolveSourcePayloadRoot(checkoutRoot, parent);
      } catch {
        continue;
      }
      const declared = readDeclaredRemoteSources(payloadRoot, checkoutRoot, formatRemoteSourceDisplay(parent));
      messages.push(...declared.warnings.map((warning) => `warning: ${warning}`));

      for (const entry of declared.sources) {
        const key = encodeRemoteSourceSelection(entry.source);
        if (visited.has(key)) continue;
        visited.add(key);
        discovered.push(entry.source);
      }
    }

    if (discovered.length === 0) break;

    const phase = syncPhase({
      kind: 'transitive',
      sources: discovered,
      homeDirectory: input.homeDirectory,
      cacheDirectory: input.cacheDirectory,
      gate: input.gate,
      syncRepository: input.syncRepository,
      validate: validateSourceCheckout,
    });
    messages.push(...phase.messages, ...phase.results.map(formatResult));
    results.push(...phase.results);
    frontier = phase.readableSources;
  }

  return { messages, results };
};

const finishSync = (
  mergedIssues: readonly SettingsLoadIssue[],
  remoteSettingsPhase: SyncPhaseResult<RemoteSettingsReference>,
  sourcePhase: SyncPhaseResult<RemoteSourceReference>,
  transitiveClosure: TransitiveClosureResult,
): SyncCommandResult => {
  const results = [...remoteSettingsPhase.results, ...sourcePhase.results, ...transitiveClosure.results];
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
    ...transitiveClosure.messages,
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

/** Validates settings, syncs remote settings, reloads, syncs remote sources, then their closure. */
export const executeSyncCommand = (
  input: SyncCommandInput,
  dependencies: Pick<SyncCommandDependencies, 'classifier' | 'prompt' | 'privateCatalogGate' | 'syncRepository'> = {},
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
  const syncRepository = dependencies.syncRepository ?? syncRemoteRepositoryAtomically;
  const remoteSettingsPhase = syncPhase({
    kind: 'remote_settings',
    // Non-null is safe: `emptySettings()` (Settings.ts) always defaults `remoteSettings` to `[]`.
    sources: local.settings.remoteSettings!,
    homeDirectory: input.homeDirectory,
    cacheDirectory: local.settings.cacheDirectory,
    gate,
    syncRepository,
    validate: validateRemoteSettingsCheckout,
  });
  const merged = loadSettingsWithCachedRemoteSettings(input, {
    remoteSettingsReferences: remoteSettingsPhase.allowedSources,
    localSettings: local,
  });
  // Non-null is safe: `emptySettings()` (Settings.ts) always defaults `sources` to `[]`. Deduplicate
  // exact-duplicate configured sources so an identical entry listed twice is fetched once, not twice
  // (OFTR-004.6.6); distinct subpaths of one repo+ref stay distinct (path-aware key).
  const seenSources = new Set<string>();
  const directRemoteSources = merged.settings.sources!.filter(isRemoteSource).filter((source) => {
    const key = encodeRemoteSourceSelection(source);
    if (seenSources.has(key)) return false;
    seenSources.add(key);
    return true;
  });
  const sourcePhase = syncPhase({
    kind: 'source',
    sources: directRemoteSources,
    homeDirectory: input.homeDirectory,
    cacheDirectory: merged.settings.cacheDirectory,
    gate,
    syncRepository,
    validate: validateSourceCheckout,
  });
  const transitiveClosure = syncTransitiveClosure({
    homeDirectory: input.homeDirectory,
    cacheDirectory: merged.settings.cacheDirectory,
    gate,
    syncRepository,
    directRemoteSources,
    sourcePhase,
  });
  const result = finishSync(merged.issues, remoteSettingsPhase, sourcePhase, transitiveClosure);
  const ambiguityWarnings = resolveEffectiveSet(input).ambiguityWarnings;
  const strictFailure = input.strict === true && ambiguityWarnings.length > 0;
  return {
    ...result,
    exitCode: strictFailure ? 1 : result.exitCode,
    messages: [
      ...result.messages,
      ...ambiguityWarnings.map((warning) => `warning: ${warning}`),
      ...(strictFailure ? [`failed: ${strictAmbiguityFailureMessage}`] : []),
    ],
  };
};

export const createSyncCommand = (dependencies: SyncCommandDependencies = {}): CommandObject => ({
  name: 'sync',
  description: 'Synchronize configured remote settings and sources into the local cache.',
  register(program: Command): void {
    program.addCommand(
      new Command('sync')
        .description('Synchronize configured remote settings and sources into the local cache.')
        .option('--strict', 'Treat ambiguous source resolution as fatal.')
        .action((options: { strict?: boolean }) => {
          const result = executeSyncCommand(
            {
              homeDirectory: resolveHomeDirectory(dependencies.homeDirectory),
              projectDirectory: resolveProjectDirectory(dependencies.projectDirectory),
              strict: options.strict,
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
