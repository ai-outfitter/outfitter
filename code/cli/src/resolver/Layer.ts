// Builds the ordered `.agents` layer stack (workspace over global over remote sources) from settings.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import {
  createRemoteRepositoryCachePath,
  encodeRemoteSourceSelection,
  formatRemoteSourceDisplay,
  isRemoteSource,
  resolveSourcePayloadRoot,
} from '../sources/SourceCache.js';
import type { RemoteSourceReference } from '../sources/SourceCache.js';
import { expandTransitiveSources } from '../sources/TransitiveSources.js';
import type { DeclaredRemoteSource } from '../sources/TransitiveSources.js';
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
  root: resolveSourcePayloadRoot(repositoryPath, source),
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
  /** Accepted transitive declarations, including duplicates, retained for ambiguity diagnostics. */
  readonly transitiveDeclarations: readonly DeclaredRemoteSource[];
  /**
   * Configured remote sources whose cache is absent, reported with `outfitter sync` guidance rather
   * than silently dropped (OFTR-004.2.18). Reported, never fatal: a private catalog the enterprise
   * gate skips is never cached, so `outfitter sync` skips it again and exits 0 — aborting here
   * would deadlock every other command behind advice the user cannot act on (OFTR-004.2.15).
   */
  readonly unsynchronized: readonly string[];
  /** Non-fatal transitive-source skip warnings (unpinned refs, path sources, invalid settings). */
  readonly warnings: readonly string[];
}

/**
 * Orders layers highest precedence first: workspace `.agents`, then global `~/.agents`, then
 * configured sources in order, then transitive sources those catalogs declare, breadth-first
 * (OFTR-004.6.1, OFTR-004.6.3). Only layers whose root exists on disk are included.
 */
export const discoverLayers = (input: LayerDiscoveryInput): LayerDiscoveryResult => {
  const candidates: Layer[] = [
    { root: agentsRoot(input.projectDirectory), origin: 'workspace', label: 'workspace' },
    { root: agentsRoot(input.homeDirectory), origin: 'global', label: 'global' },
  ];
  const unsynchronized: string[] = [];
  const invalid: string[] = [];

  const appendSourceLayer = (source: SourceReference): void => {
    // An absolute or escaping `path:` makes payload-root resolution throw; skip the source with a
    // warning rather than crash every resolve command (list/validate/run/dump).
    let layer: Layer;
    try {
      layer = sourceLayer(input, source);
    } catch {
      invalid.push(
        `Configured source '${isRemoteSource(source) ? formatRemoteSourceDisplay(source) : source.path}' has an invalid path and was skipped.`,
      );
      return;
    }
    if (isRemoteSource(source) && !existsSync(layer.root)) {
      unsynchronized.push(
        `Configured remote source '${layer.label}' is not synchronized at '${layer.root}'. Run 'outfitter sync' to fetch it.`,
      );
      return;
    }
    candidates.push(layer);
  };

  // Deduplicate exact-duplicate configured sources so an identical entry listed twice yields one
  // layer, not a self-shadowing pair (OFTR-004.6.6). Distinct subpaths stay distinct (path-aware).
  const seenSources = new Set<string>();
  const directSources = (input.settings.sources ?? []).filter((source) => {
    const key = isRemoteSource(source) ? encodeRemoteSourceSelection(source) : `path\0${source.path}`;
    if (seenSources.has(key)) return false;
    seenSources.add(key);
    return true;
  });
  for (const source of directSources) {
    appendSourceLayer(source);
  }

  const expansion = expandTransitiveSources({
    directSources,
    resolveCachedCheckoutRoot: (source) => {
      const checkoutRoot = createRemoteRepositoryCachePath(input.homeDirectory, source, input.settings.cacheDirectory);
      return existsSync(checkoutRoot) ? checkoutRoot : undefined;
    },
  });
  for (const transitive of expansion.sources) {
    appendSourceLayer(transitive.source);
  }

  return {
    layers: candidates.filter((layer) => existsSync(layer.root)),
    transitiveDeclarations: expansion.declarations,
    unsynchronized,
    warnings: [...invalid, ...expansion.warnings],
  };
};
