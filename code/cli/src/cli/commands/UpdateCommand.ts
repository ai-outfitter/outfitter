// Implements `outfitter update extensions`: an explicit, user-invoked mutation of the machine-local
// pi extension cache (the mutating counterpart of `list extensions`). The command needs neither
// settings, a project, nor agent resolution — the cache is shared across agents — and it never
// reads or writes loadout files or settings. It delegates every per-entry decision and transaction
// to `updateExtensions` and owns only the surface: kind dispatch, cache-dir resolution, offline and
// dry-run flags, deterministic summary rendering, the JSON contract, strictness, and the exit code.
import { join } from 'node:path';

import { Command } from 'commander';

import { updateExtensions } from '../../extensions/ExtensionUpdate.js';
import type { ExtensionUpdateEntry, GitFastForwarder } from '../../extensions/ExtensionUpdate.js';
import type { GitRemoteTipResolver } from '../../extensions/ExtensionReport.js';
import type { NpmLatestResolver, PiInstallSpawner } from '../../extensions/PiExtensionCache.js';
import type { PiPeerSpawner } from '../../extensions/PiExtensionPeers.js';
import { resolveOutfitterCacheDir } from '../../paths/OutfitterCache.js';
import type { CommandObject } from './CommandObject.js';
import { resolveHomeDirectory } from './ProcessDefaults.js';

export interface UpdateExtensionsInput {
  readonly homeDirectory: string;
  readonly kind?: string;
  readonly offline?: boolean;
  readonly dryRun?: boolean;
  readonly strict?: boolean;
}

export interface UpdateExtensionsResult {
  readonly exitCode: number;
  readonly messages: readonly string[];
  readonly updates: readonly ExtensionUpdateEntry[];
  readonly dryRun: boolean;
}

export interface UpdateCommandDependencies {
  readonly homeDirectory?: string;
  readonly writeLine?: (message: string) => void;
  /** Test seam for the registry resolver behind the npm update checks. */
  readonly npmLatest?: NpmLatestResolver;
  /** Test seam for the git tip resolver behind the git update checks. */
  readonly gitRemoteTip?: GitRemoteTipResolver;
  /** Test seam for the `pi install` spawn behind npm reinstalls. */
  readonly spawn?: PiInstallSpawner;
  /** Test seam for the npm spawn behind peer-dependency satisfaction. */
  readonly peerSpawn?: PiPeerSpawner;
  /** Test seam for the git fetch/merge behind checkout fast-forwards. */
  readonly fastForward?: GitFastForwarder;
}

const renderStatus = (entry: ExtensionUpdateEntry): string =>
  entry.statusDetail === undefined ? entry.status : `${entry.status} (${entry.statusDetail})`;

const renderUpdateEntry = (entry: ExtensionUpdateEntry): string => {
  const from = entry.from ?? '(unreadable)';
  // An arrow means the transition is known (it happened, or dry-run resolved the target).
  if (entry.to === undefined) return `  ${entry.specifier}  ${from}  ${renderStatus(entry)}`;
  if (entry.status === 'would-update') return `  ${entry.specifier}  ${from}  ${renderStatus(entry)}`;
  return `  ${entry.specifier}  ${from} -> ${entry.to}  ${renderStatus(entry)}`;
};

/** PI_OFFLINE is the extension-network switch the cache flow already honors at launch time. */
const resolveOffline = (offline: boolean | undefined): boolean =>
  offline === true || process.env.PI_OFFLINE === '1' || process.env.PI_OFFLINE === 'true';

/** Failed entries always fail the run; strict additionally makes warnings fatal. */
const updateExitCode = (
  updates: readonly ExtensionUpdateEntry[],
  warnings: readonly string[],
  strict: boolean | undefined,
): number => {
  if (updates.some((entry) => entry.status === 'failed')) return 1;
  return strict === true && warnings.length > 0 ? 1 : 0;
};

/** Runs the explicit cache update and renders its deterministic summary; no settings apply. */
export const executeUpdateCommand = async (
  input: UpdateExtensionsInput,
  dependencies: Pick<
    UpdateCommandDependencies,
    'npmLatest' | 'gitRemoteTip' | 'spawn' | 'peerSpawn' | 'fastForward'
  > = {},
): Promise<UpdateExtensionsResult> => {
  if (input.kind !== 'extensions') {
    throw new Error(`Unknown kind '${input.kind ?? ''}'. The update command supports: extensions.`);
  }
  const cacheAgentDir = join(resolveOutfitterCacheDir(process.env, input.homeDirectory), 'pi-extensions');
  const result = await updateExtensions({
    cacheAgentDir,
    offline: resolveOffline(input.offline),
    dryRun: input.dryRun === true,
    npmLatest: dependencies.npmLatest,
    gitRemoteTip: dependencies.gitRemoteTip,
    spawn: dependencies.spawn,
    peerSpawn: dependencies.peerSpawn,
    fastForward: dependencies.fastForward,
  });
  const messages = [
    'extensions update:',
    ...(input.dryRun === true ? ['  (dry run — no changes were written)'] : []),
    ...(result.updates.length === 0 ? ['  (none)'] : result.updates.map(renderUpdateEntry)),
    ...result.warnings.map((warning) => `warning: ${warning}`),
  ];
  const exitCode = updateExitCode(result.updates, result.warnings, input.strict);
  return { exitCode, messages, updates: result.updates, dryRun: input.dryRun === true };
};

const writeUpdateOutput = (result: UpdateExtensionsResult, json: boolean, write: (message: string) => void): void => {
  if (json) {
    write(
      JSON.stringify(
        {
          ok: result.exitCode === 0,
          dryRun: result.dryRun,
          updates: result.updates,
          diagnostics: result.messages.filter((message) => message.startsWith('warning: ')),
        },
        null,
        2,
      ),
    );
    return;
  }
  for (const message of result.messages) write(message);
};

export const createUpdateCommand = (dependencies: UpdateCommandDependencies = {}): CommandObject => ({
  name: 'update',
  description: 'Update the cached pi extensions (an explicit mutation; run stays offline-first).',
  register(program: Command): void {
    program.addCommand(
      new Command('update')
        .description(
          'Update the cached pi extensions: reinstalls outdated npm packages and fast-forwards branch-pinned git checkouts.',
        )
        .argument('[kind]', 'The cache to update: extensions.')
        .option('--strict', 'Treat warnings (for example failed peer installs) as fatal.')
        .option('--offline', 'Skip every upstream lookup, mutate nothing, and report each entry offline.')
        .option('--dry-run', 'Perform the upstream lookups and report what would update, without mutating.')
        .option('--json', 'Emit stable machine-readable JSON with the update entries.')
        .action(
          async (
            kind: string | undefined,
            options: { strict?: boolean; offline?: boolean; dryRun?: boolean; json?: boolean },
          ) => {
            const result = await executeUpdateCommand(
              {
                /* v8 ignore next -- process defaults are exercised by the CLI entrypoint, not unit tests. */
                homeDirectory: resolveHomeDirectory(dependencies.homeDirectory),
                kind,
                offline: options.offline,
                dryRun: options.dryRun,
                strict: options.strict,
              },
              dependencies,
            );

            /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
            writeUpdateOutput(result, options.json === true, dependencies.writeLine ?? console.log);

            /* v8 ignore next -- process exit wiring is covered by CLI smoke behavior. */
            if (result.exitCode !== 0) process.exitCode = result.exitCode;
          },
        ),
    );
  },
});
