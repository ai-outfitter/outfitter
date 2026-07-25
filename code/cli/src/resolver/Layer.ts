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

const sourceLayer = (input: LayerDiscoveryInput, source: SourceReference): Layer => {
  if (!isRemoteSource(source)) {
    return { root: source.path, origin: 'source', label: source.path };
  }

  const layer = remoteSourceLayer(
    createRemoteRepositoryCachePath(input.homeDirectory, source, input.settings.cacheDirectory),
    source,
  );

  if (!existsSync(layer.root)) {
    throw new Error(
      `Configured remote source '${layer.label}' is not synchronized at '${layer.root}'. Run 'outfitter sync' to fetch it.`,
    );
  }

  return layer;
};

/**
 * Orders layers highest precedence first: workspace `.agents`, then global `~/.agents`,
 * then configured sources in order. Only layers whose root exists on disk are included.
 */
export const discoverLayers = (input: LayerDiscoveryInput): readonly Layer[] => {
  const candidates: Layer[] = [
    { root: agentsRoot(input.projectDirectory), origin: 'workspace', label: 'workspace' },
    { root: agentsRoot(input.homeDirectory), origin: 'global', label: 'global' },
    ...(input.settings.sources ?? []).map((source) => sourceLayer(input, source)),
  ];

  return candidates.filter((layer) => existsSync(layer.root));
};
