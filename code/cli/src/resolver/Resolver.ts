// Resolves protocol resources from layered `.agents` trees into one immutable effective resource set.
import { existsSync, readdirSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

import type { EffectiveResourceSet, Layer, ResourceDefinition, ResourceKind, ResolvedResource } from './Resource.js';
import { resourceKinds } from './Resource.js';

const directoryResourceKinds: ReadonlyMap<ResourceKind, string> = new Map([
  ['agent', 'agents'],
  ['skill', 'skills'],
]);

const entryFileByKind: ReadonlyMap<ResourceKind, string> = new Map([
  ['agent', 'agent.md'],
  ['skill', 'SKILL.md'],
]);

const fileTreeResourceKinds: ReadonlyMap<ResourceKind, string> = new Map([
  ['knowledge', 'knowledge'],
  ['command', 'commands'],
]);

const listSubdirectories = (directory: string): readonly string[] => {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
};

const listFilesRecursively = (root: string): readonly string[] => {
  if (!existsSync(root)) {
    return [];
  }

  const files: string[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name);

    if (entry.isDirectory()) {
      files.push(...listFilesRecursively(entryPath));
    } else if (entry.isFile()) {
      files.push(entryPath);
    }
  }

  return files;
};

const toSlug = (root: string, entryPath: string): string => relative(root, entryPath).split(sep).join(posix.sep);

const discoverDirectoryResources = (layer: Layer, kind: ResourceKind): readonly ResourceDefinition[] => {
  const container = join(layer.root, directoryResourceKinds.get(kind)!);
  const entryFile = entryFileByKind.get(kind)!;

  return listSubdirectories(container)
    .filter((slug) => existsSync(join(container, slug, entryFile)))
    .map((slug) => ({ kind, slug, layer, path: join(container, slug, entryFile) }));
};

const discoverFileResources = (layer: Layer, kind: ResourceKind): readonly ResourceDefinition[] => {
  const container = join(layer.root, fileTreeResourceKinds.get(kind)!);

  return listFilesRecursively(container).map((path) => ({ kind, slug: toSlug(container, path), layer, path }));
};

const discoverLayerResources = (layer: Layer, kind: ResourceKind): readonly ResourceDefinition[] =>
  directoryResourceKinds.has(kind) ? discoverDirectoryResources(layer, kind) : discoverFileResources(layer, kind);

const resolveKind = (layers: readonly Layer[], kind: ResourceKind): ReadonlyMap<string, ResolvedResource> => {
  const bySlug = new Map<string, { winner: ResourceDefinition; shadowed: ResourceDefinition[] }>();

  // Layers are ordered highest precedence first, so the first definition of a slug wins.
  for (const layer of layers) {
    for (const definition of discoverLayerResources(layer, kind)) {
      const existing = bySlug.get(definition.slug);

      if (existing === undefined) {
        bySlug.set(definition.slug, { winner: definition, shadowed: [] });
      } else {
        existing.shadowed.push(definition);
      }
    }
  }

  return new Map(
    [...bySlug.entries()].map(([slug, entry]) => [
      slug,
      { kind, slug, winner: entry.winner, shadowed: entry.shadowed },
    ]),
  );
};

/** Produces the single effective resource set consumed by list, validate, run, and dump. */
export const resolveResources = (layers: readonly Layer[]): EffectiveResourceSet => {
  const resources = new Map<ResourceKind, ReadonlyMap<string, ResolvedResource>>();

  for (const kind of resourceKinds) {
    resources.set(kind, resolveKind(layers, kind));
  }

  return { layers, resources };
};
