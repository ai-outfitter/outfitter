import { Command } from 'commander';

import { loadSettingsWithCachedRemoteSettings } from '../../settings/SettingsLoader.js';
import type { SourceReference } from '../../settings/Settings.js';
import {
  createRemoteRepositoryCachePath,
  formatRemoteSourceDisplay,
  isRemoteSource,
} from '../../sources/SourceCache.js';
import { inspectSourceCache } from '../../sources/SourceState.js';
import { expandTransitiveSources } from '../../sources/TransitiveSources.js';
import type { CommandObject } from './CommandObject.js';
import { resolveHomeDirectory, resolveProjectDirectory } from './ProcessDefaults.js';

export interface SourceReportEntry {
  readonly precedence: number;
  readonly origin: 'workspace' | 'global' | 'remote-settings' | 'source' | 'transitive';
  readonly source: string;
  readonly requestedRevision: string | null;
  readonly resolvedRevision: string | null;
  readonly cacheHealth: 'live' | ReturnType<typeof inspectSourceCache>['health'];
}

export const executeSourcesCommand = (input: {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
}): readonly SourceReportEntry[] => {
  const loaded = loadSettingsWithCachedRemoteSettings(input);
  const entries: SourceReportEntry[] = [
    {
      precedence: 0,
      origin: 'workspace',
      source: `${input.projectDirectory}/.agents`,
      requestedRevision: null,
      resolvedRevision: null,
      cacheHealth: 'live',
    },
    {
      precedence: 1,
      origin: 'global',
      source: `${input.homeDirectory}/.agents`,
      requestedRevision: null,
      resolvedRevision: null,
      cacheHealth: 'live',
    },
  ];
  const append = (source: SourceReference, origin: SourceReportEntry['origin']): void => {
    if (!isRemoteSource(source)) {
      entries.push({
        precedence: entries.length,
        origin,
        source: source.path,
        requestedRevision: null,
        resolvedRevision: null,
        cacheHealth: 'live',
      });
      return;
    }
    const cachePath = createRemoteRepositoryCachePath(input.homeDirectory, source, loaded.settings.cacheDirectory);
    const state = inspectSourceCache({ ...input, cacheDirectory: loaded.settings.cacheDirectory, cachePath, source });
    entries.push({
      precedence: entries.length,
      origin,
      source: formatRemoteSourceDisplay(source),
      requestedRevision: source.ref ?? null,
      resolvedRevision: state.commit ?? null,
      cacheHealth: state.health,
    });
  };
  for (const remote of loaded.settings.remoteSettings!) append(remote, 'remote-settings');
  const directSources = loaded.settings.sources!;
  for (const source of directSources) append(source, 'source');
  const transitive = expandTransitiveSources({
    directSources,
    resolveCachedCheckoutRoot: (source) =>
      createRemoteRepositoryCachePath(input.homeDirectory, source, loaded.settings.cacheDirectory),
  });
  for (const source of transitive.sources) append(source.source, 'transitive');
  return entries;
};

export const createSourcesCommand = (
  dependencies: {
    readonly homeDirectory?: string;
    readonly projectDirectory?: string;
    readonly writeLine?: (message: string) => void;
  } = {},
): CommandObject => ({
  name: 'sources',
  description: 'Report source precedence and cache health.',
  register(program: Command): void {
    program.addCommand(
      new Command('sources')
        .description('Report source precedence and cache health.')
        .option('--json', 'Emit stable machine-readable JSON.')
        .action((options: { json?: boolean }) => {
          const entries = executeSourcesCommand({
            homeDirectory: resolveHomeDirectory(dependencies.homeDirectory),
            projectDirectory: resolveProjectDirectory(dependencies.projectDirectory),
          });
          /* v8 ignore next -- console fallback is direct CLI behavior; tests inject a writer. */
          const write = dependencies.writeLine ?? console.log;
          if (options.json === true) write(JSON.stringify(entries, null, 2));
          else
            for (const entry of entries)
              write(
                `${entry.precedence}\t${entry.origin}\t${entry.cacheHealth}\t${entry.source}\t${entry.resolvedRevision ?? '-'}`,
              );
        }),
    );
  },
});
