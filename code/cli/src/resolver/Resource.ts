// Core resource-model types shared across the resolver, list, validate, run, and dump paths.

/** Kinds of protocol resources Outfitter resolves by slug across `.agents` layers. */
export type ResourceKind = 'agent' | 'skill' | 'knowledge' | 'command';

export const resourceKinds: readonly ResourceKind[] = ['agent', 'skill', 'knowledge', 'command'];

/** Where a layer originates, highest precedence first. */
export type LayerOrigin = 'workspace' | 'global' | 'source';

export interface Layer {
  /** Absolute path to the `.agents` payload root for this layer. */
  readonly root: string;
  readonly origin: LayerOrigin;
  /** Human-readable label for diagnostics, e.g. `workspace`, `global`, or a source URI. */
  readonly label: string;
}

/** An agent's loadout — the resources and runtime options it composes with. */
export interface Loadout {
  readonly skills: readonly string[];
  readonly subagents: readonly string[];
  readonly mcp: readonly string[];
  readonly extensions: readonly string[];
  readonly plugins: readonly string[];
  readonly model?: string;
  readonly thinking?: string;
  readonly tools?: { readonly allow?: readonly string[]; readonly deny?: readonly string[] };
}

export const emptyLoadout = (): Loadout => ({
  skills: [],
  subagents: [],
  mcp: [],
  extensions: [],
  plugins: [],
});

/** A single resource definition discovered in one layer. */
export interface ResourceDefinition {
  readonly kind: ResourceKind;
  readonly slug: string;
  readonly layer: Layer;
  /** Absolute path to the resource's defining file or directory. */
  readonly path: string;
}

/** The winning definition for a slug plus any lower-precedence definitions it shadows. */
export interface ResolvedResource {
  readonly kind: ResourceKind;
  readonly slug: string;
  readonly winner: ResourceDefinition;
  readonly shadowed: readonly ResourceDefinition[];
}

/** One immutable effective resource set per invocation, keyed by kind then slug. */
export interface EffectiveResourceSet {
  readonly layers: readonly Layer[];
  readonly resources: ReadonlyMap<ResourceKind, ReadonlyMap<string, ResolvedResource>>;
}

export const listResources = (set: EffectiveResourceSet, kind: ResourceKind): readonly ResolvedResource[] => {
  const bySlug = set.resources.get(kind);

  if (bySlug === undefined) {
    return [];
  }

  return [...bySlug.values()].sort((left, right) => left.slug.localeCompare(right.slug));
};

export const findResource = (
  set: EffectiveResourceSet,
  kind: ResourceKind,
  slug: string,
): ResolvedResource | undefined => set.resources.get(kind)?.get(slug);
