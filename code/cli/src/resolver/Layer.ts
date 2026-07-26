// Builds the ordered `.agents` layer stack (workspace over global over remote sources) from settings.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  createRemoteRepositoryCachePath,
  formatRemoteSourceDisplay,
  isRemoteSource,
  resolveRemoteRepositorySubpath,
} from '../sources/SourceCache.js';
import type { RemoteSourceReference } from '../sources/SourceCache.js';
import type { Settings, SourceReference } from '../settings/Settings.js';
import type { Layer } from './Resource.js';

export interface LayerDiscoveryInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly settings: Settings;
}

const agentsRoot = (directory: string): string => join(directory, '.agents');

/**
 * Maps an already-materialized repository checkout to the layer `outfitter run` would resolve from
 * it. `outfitter sync` reuses this against its temporary checkout so both agree on the payload root.
 */
export const remoteSourceLayer = (repositoryPath: string, source: RemoteSourceReference): Layer => ({
  root: source.path === undefined ? repositoryPath : resolveRemoteRepositorySubpath(repositoryPath, source.path),
  origin: 'source',
  label: formatRemoteSourceDisplay(source),
});

const sourceLayer = (input: LayerDiscoveryInput, source: SourceReference): Layer =>
  isRemoteSource(source)
    ? remoteSourceLayer(
        createRemoteRepositoryCachePath(input.homeDirectory, source, input.settings.cacheDirectory),
        source,
      )
    : { root: source.path, origin: 'source', label: source.path };

export interface LayerDiscoveryResult {
  readonly layers: readonly Layer[];
  /**
   * Configured remote sources whose cache is absent, reported with `outfitter sync` guidance rather
   * than silently dropped (OFTR-004.2.18). Reported, never fatal: a private catalog the enterprise
   * gate skips is never cached, so `outfitter sync` skips it again and exits 0 — aborting here
   * would deadlock every other command behind advice the user cannot act on (OFTR-004.2.15).
   */
  readonly unsynchronized: readonly string[];
}

/**
 * Orders layers highest precedence first: workspace `.agents`, then global `~/.agents`,
 * then configured sources in order. Only layers whose root exists on disk are included.
 */
export const discoverLayers = (input: LayerDiscoveryInput): LayerDiscoveryResult => {
  const candidates: Layer[] = [
    { root: agentsRoot(input.projectDirectory), origin: 'workspace', label: 'workspace' },
    { root: agentsRoot(input.homeDirectory), origin: 'global', label: 'global' },
  ];
  const unsynchronized: string[] = [];

  for (const source of input.settings.sources ?? []) {
    const layer = sourceLayer(input, source);
    if (isRemoteSource(source) && !existsSync(layer.root)) {
      unsynchronized.push(
        `Configured remote source '${layer.label}' is not synchronized at '${layer.root}'. Run 'outfitter sync' to fetch it.`,
      );
      continue;
    }
    candidates.push(layer);
  }

  return { layers: candidates.filter((layer) => existsSync(layer.root)), unsynchronized };
};
