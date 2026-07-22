// Resolves protocol resources from layered `.agents` trees into one immutable effective resource set.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

import type { EffectiveResourceSet, Layer, ResourceDefinition, ResourceKind, ResolvedResource } from './Resource.js';
import { agentLocalKinds, compareSlugs, resourceKinds } from './Resource.js';

/** True when the path resolves (following symlinks) to a directory; false for broken links. */
const resolvesToDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

/** True when the path resolves (following symlinks) to a file; false for broken links. */
const resolvesToFile = (path: string): boolean => {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

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

// Symlinked directories are followed (matching the skill catalog), so a resource can be a link.
const listSubdirectories = (directory: string): readonly string[] => {
  if (!existsSync(directory)) {
    return [];
  }

  return readdirSync(directory, { withFileTypes: true })
    .filter((entry) => resolvesToDirectory(join(directory, entry.name)))
    .map((entry) => entry.name);
};

const listFilesRecursively = (root: string): readonly string[] => {
  if (!existsSync(root)) {
    return [];
  }

  const files: string[] = [];

  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name);

    if (resolvesToDirectory(entryPath)) {
      files.push(...listFilesRecursively(entryPath));
    } else if (resolvesToFile(entryPath)) {
      files.push(entryPath);
    }
  }

  return files;
};

const toSlug = (root: string, entryPath: string): string => relative(root, entryPath).split(sep).join(posix.sep);

// `base` is the directory the kind's container sits under: a layer root for catalog-wide resources,
// or `<layer.root>/agents/<owner>` for agent-local ones. Attribution (`layer`) is separate from it.
const discoverDirectoryResources = (
  layer: Layer,
  kind: ResourceKind,
  base: string = layer.root,
): readonly ResourceDefinition[] => {
  const container = join(base, directoryResourceKinds.get(kind)!);
  const entryFile = entryFileByKind.get(kind)!;

  return listSubdirectories(container)
    .filter((slug) => resolvesToFile(join(container, slug, entryFile)))
    .map((slug) => ({ kind, slug, layer, path: join(container, slug, entryFile) }));
};

// Existing `agents/<slug>/<...>` files across every layer that defines the agent, highest first.
const collectAgentFiles = (layers: readonly Layer[], slug: string, ...segments: string[]): readonly string[] =>
  layers.map((layer) => join(layer.root, 'agents', slug, ...segments)).filter((path) => resolvesToFile(path));

const isNonEmptyDirectory = (directory: string): boolean => {
  try {
    return statSync(directory).isDirectory() && readdirSync(directory).length > 0;
  } catch {
    return false;
  }
};

// Non-empty `agents/<slug>/hooks/` directories across layers (reserved namespace; surfaced, not resolved).
const collectAgentHookDirs = (layers: readonly Layer[], slug: string): readonly string[] =>
  layers.map((layer) => join(layer.root, 'agents', slug, 'hooks')).filter(isNonEmptyDirectory);

const withAgentResourcePaths = (
  layers: readonly Layer[],
  agents: ReadonlyMap<string, ResolvedResource>,
): ReadonlyMap<string, ResolvedResource> =>
  new Map(
    [...agents.entries()].map(([slug, resource]) => [
      slug,
      {
        ...resource,
        configPaths: collectAgentFiles(layers, slug, 'config.json'),
        mcpPaths: collectAgentFiles(layers, slug, 'mcp.json'),
        hookPaths: collectAgentHookDirs(layers, slug),
      },
    ]),
  );

const discoverFileResources = (
  layer: Layer,
  kind: ResourceKind,
  base: string = layer.root,
): readonly ResourceDefinition[] => {
  const container = join(base, fileTreeResourceKinds.get(kind)!);

  return listFilesRecursively(container).map((path) => ({ kind, slug: toSlug(container, path), layer, path }));
};

const discoverLayerResources = (
  layer: Layer,
  kind: ResourceKind,
  base: string = layer.root,
): readonly ResourceDefinition[] =>
  directoryResourceKinds.has(kind)
    ? discoverDirectoryResources(layer, kind, base)
    : discoverFileResources(layer, kind, base);

type AgentResourceDefinition = ResourceDefinition & { readonly ownerAgent: string };

// Agent-local discovery of kind K = catalog discovery of K, re-rooted under `agents/<owner>/` and
// attributed to the real layer. One generic path serves skills, knowledge, and commands.
const discoverAgentResources = (layer: Layer): readonly AgentResourceDefinition[] => {
  const agentsDirectory = join(layer.root, 'agents');

  return listSubdirectories(agentsDirectory).flatMap((ownerAgent) => {
    const agentBase = join(agentsDirectory, ownerAgent);

    return agentLocalKinds.flatMap((kind) =>
      discoverLayerResources(layer, kind, agentBase).map((definition) => ({ ...definition, ownerAgent })),
    );
  });
};

const resolveDefinitions = (definitions: readonly ResourceDefinition[]): ReadonlyMap<string, ResolvedResource> => {
  const bySlug = new Map<string, { winner: ResourceDefinition; shadowed: ResourceDefinition[] }>();

  for (const definition of definitions) {
    const existing = bySlug.get(definition.slug);

    if (existing === undefined) {
      bySlug.set(definition.slug, { winner: definition, shadowed: [] });
    } else {
      existing.shadowed.push(definition);
    }
  }

  return new Map(
    [...bySlug.entries()].map(([slug, entry]) => [
      slug,
      { kind: entry.winner.kind, slug, winner: entry.winner, shadowed: entry.shadowed },
    ]),
  );
};

const resolveKind = (layers: readonly Layer[], kind: ResourceKind): ReadonlyMap<string, ResolvedResource> => {
  // Layers are ordered highest precedence first, so the first definition of a slug wins.
  return resolveDefinitions(layers.flatMap((layer) => discoverLayerResources(layer, kind)));
};

// Groups one agent's local definitions by kind, then resolves each kind's slug precedence.
const resolveAgentKinds = (
  definitions: readonly AgentResourceDefinition[],
): ReadonlyMap<ResourceKind, ReadonlyMap<string, ResolvedResource>> => {
  const byKind = new Map<ResourceKind, ResourceDefinition[]>();

  for (const definition of definitions) {
    const kindDefinitions = byKind.get(definition.kind) ?? [];
    kindDefinitions.push(definition);
    byKind.set(definition.kind, kindDefinitions);
  }

  return new Map([...byKind.entries()].map(([kind, kindDefinitions]) => [kind, resolveDefinitions(kindDefinitions)]));
};

const resolveAgentResources = (
  layers: readonly Layer[],
): ReadonlyMap<string, ReadonlyMap<ResourceKind, ReadonlyMap<string, ResolvedResource>>> => {
  const definitionsByAgent = new Map<string, AgentResourceDefinition[]>();

  for (const layer of layers) {
    for (const definition of discoverAgentResources(layer)) {
      const definitions = definitionsByAgent.get(definition.ownerAgent) ?? [];
      definitions.push(definition);
      definitionsByAgent.set(definition.ownerAgent, definitions);
    }
  }

  return new Map(
    [...definitionsByAgent.entries()]
      .sort(([left], [right]) => compareSlugs(left, right))
      .map(([agentSlug, definitions]) => [agentSlug, resolveAgentKinds(definitions)]),
  );
};

/** Produces the single effective resource set consumed by list, validate, run, and dump. */
export const resolveResources = (layers: readonly Layer[]): EffectiveResourceSet => {
  const resources = new Map<ResourceKind, ReadonlyMap<string, ResolvedResource>>();

  for (const kind of resourceKinds) {
    const resolved = resolveKind(layers, kind);
    resources.set(kind, kind === 'agent' ? withAgentResourcePaths(layers, resolved) : resolved);
  }

  return { layers, resources, agentResources: resolveAgentResources(layers) };
};
