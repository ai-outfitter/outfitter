// Resolves protocol resources from layered `.agents` trees into one immutable effective resource set.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, posix, relative, sep } from 'node:path';

import type { EffectiveResourceSet, Layer, ResourceDefinition, ResourceKind, ResolvedResource } from './Resource.js';
import { compareSlugs, resourceKinds } from './Resource.js';

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

const discoverDirectoryResources = (layer: Layer, kind: ResourceKind): readonly ResourceDefinition[] => {
  const container = join(layer.root, directoryResourceKinds.get(kind)!);
  const entryFile = entryFileByKind.get(kind)!;

  return listSubdirectories(container)
    .filter((slug) => resolvesToFile(join(container, slug, entryFile)))
    .map((slug) => ({ kind, slug, layer, path: join(container, slug, entryFile) }));
};

// Per-agent config.json paths across every layer that defines the agent, highest precedence first.
const collectAgentConfigPaths = (layers: readonly Layer[], slug: string): readonly string[] =>
  layers
    .map((layer) => join(layer.root, 'agents', slug, 'config.json'))
    .filter((configPath) => resolvesToFile(configPath));

const withAgentConfigPaths = (
  layers: readonly Layer[],
  agents: ReadonlyMap<string, ResolvedResource>,
): ReadonlyMap<string, ResolvedResource> =>
  new Map(
    [...agents.entries()].map(([slug, resource]) => [
      slug,
      { ...resource, configPaths: collectAgentConfigPaths(layers, slug) },
    ]),
  );

const discoverFileResources = (layer: Layer, kind: ResourceKind): readonly ResourceDefinition[] => {
  const container = join(layer.root, fileTreeResourceKinds.get(kind)!);

  return listFilesRecursively(container).map((path) => ({ kind, slug: toSlug(container, path), layer, path }));
};

const discoverLayerResources = (layer: Layer, kind: ResourceKind): readonly ResourceDefinition[] =>
  directoryResourceKinds.has(kind) ? discoverDirectoryResources(layer, kind) : discoverFileResources(layer, kind);

type AgentResourceDefinition = ResourceDefinition & { readonly ownerAgent: string };

const discoverAgentSkills = (layer: Layer): readonly AgentResourceDefinition[] => {
  const agentsDirectory = join(layer.root, 'agents');

  return listSubdirectories(agentsDirectory).flatMap((ownerAgent) => {
    const skillsDirectory = join(agentsDirectory, ownerAgent, 'skills');

    return listSubdirectories(skillsDirectory)
      .filter((slug) => resolvesToFile(join(skillsDirectory, slug, 'SKILL.md')))
      .map((slug) => ({
        kind: 'skill' as const,
        slug,
        layer,
        path: join(skillsDirectory, slug, 'SKILL.md'),
        ownerAgent,
      }));
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

const resolveAgentResources = (
  layers: readonly Layer[],
): ReadonlyMap<string, ReadonlyMap<ResourceKind, ReadonlyMap<string, ResolvedResource>>> => {
  const definitionsByAgent = new Map<string, AgentResourceDefinition[]>();

  for (const layer of layers) {
    for (const definition of discoverAgentSkills(layer)) {
      const definitions = definitionsByAgent.get(definition.ownerAgent) ?? [];
      definitions.push(definition);
      definitionsByAgent.set(definition.ownerAgent, definitions);
    }
  }

  return new Map(
    [...definitionsByAgent.entries()]
      .sort(([left], [right]) => compareSlugs(left, right))
      .map(([agentSlug, definitions]) => [
        agentSlug,
        new Map<ResourceKind, ReadonlyMap<string, ResolvedResource>>([['skill', resolveDefinitions(definitions)]]),
      ]),
  );
};

/** Produces the single effective resource set consumed by list, validate, run, and dump. */
export const resolveResources = (layers: readonly Layer[]): EffectiveResourceSet => {
  const resources = new Map<ResourceKind, ReadonlyMap<string, ResolvedResource>>();

  for (const kind of resourceKinds) {
    const resolved = resolveKind(layers, kind);
    resources.set(kind, kind === 'agent' ? withAgentConfigPaths(layers, resolved) : resolved);
  }

  return { layers, resources, agentResources: resolveAgentResources(layers) };
};
