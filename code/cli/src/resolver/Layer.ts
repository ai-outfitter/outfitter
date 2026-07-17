// Builds the ordered `.agents` layer stack (workspace over global over remote sources) from settings.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { createRemoteRepositoryCachePath, resolveRemoteRepositorySubpath } from '../profiles/ProfileCache.js';
import type { Settings, SourceReference } from '../settings/Settings.js';
import type { Layer } from './Resource.js';

export interface LayerDiscoveryInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly settings: Settings;
}

const agentsRoot = (directory: string): string => join(directory, '.agents');

const sourceLayer = (homeDirectory: string, source: SourceReference): Layer => {
  if (source.path !== undefined && source.uri === undefined && source.github === undefined) {
    return { root: source.path, origin: 'source', label: source.path };
  }

  const remote = source as { readonly uri?: string; readonly github?: string; readonly ref?: string };
  const repositoryPath = createRemoteRepositoryCachePath(homeDirectory, remote as never);
  const root = source.path === undefined ? repositoryPath : resolveRemoteRepositorySubpath(repositoryPath, source.path);
  const label = remote.uri ?? `github:${remote.github}`;

  return { root, origin: 'source', label };
};

/**
 * Orders layers highest precedence first: workspace `.agents`, then global `~/.agents`,
 * then configured sources in order. Only layers whose root exists on disk are included.
 */
export const discoverLayers = (input: LayerDiscoveryInput): readonly Layer[] => {
  const candidates: Layer[] = [
    { root: agentsRoot(input.projectDirectory), origin: 'workspace', label: 'workspace' },
    { root: agentsRoot(input.homeDirectory), origin: 'global', label: 'global' },
    ...(input.settings.sources ?? []).map((source) => sourceLayer(input.homeDirectory, source)),
  ];

  return candidates.filter((layer) => existsSync(layer.root));
};
