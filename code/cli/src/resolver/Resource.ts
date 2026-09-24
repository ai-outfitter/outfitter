// Core resource-model types shared across the resolver, list, validate, run, and dump paths.

/** Kinds of protocol resources Outfitter resolves by slug across `.agents` layers. */
export type ResourceKind = 'agent' | 'skill' | 'knowledge' | 'command' | 'workflow';

export const resourceKinds: readonly ResourceKind[] = ['agent', 'skill', 'knowledge', 'command', 'workflow'];

/**
 * Kinds that also resolve **agent-local** — discovered under `agents/<agent>/<container>/` and
 * resolved local-first before catalog fallback. Excludes `agent` (no nested subagents; a delegate is
 * a shared catalog agent). mcp/hooks are handled separately (config file / reserved namespace), not
 * as slug-container kinds.
 */
export const agentLocalKinds: readonly ResourceKind[] = ['skill', 'knowledge', 'command'];

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
  readonly commands: readonly string[];
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
  commands: [],
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
  /** Agent that owns this definition when it is nested beneath `agents/<agent>/<kind>/`. */
  readonly ownerAgent?: string;
}

/** The winning definition for a slug plus any lower-precedence definitions it shadows. */
export interface ResolvedResource {
  readonly kind: ResourceKind;
  readonly slug: string;
  readonly winner: ResourceDefinition;
  readonly shadowed: readonly ResourceDefinition[];
  /**
   * For agents: existing `config.json` paths across all layers, highest precedence first. Per-agent
   * JSON merges across layers independently of the markdown merge-by-ID, so a workspace config can
   * override one loadout field of a globally defined agent.
   */
  readonly configPaths?: readonly string[];
  /**
   * For agents: layer roots corresponding to `configPaths`. Config-only overlay layers do not
   * appear in `winner` or `shadowed`, so projection retains this provenance for containment checks.
   */
  readonly configLayerRoots?: readonly string[];
  /**
   * For agents: existing `agents/<slug>/mcp.json` paths across all layers, highest precedence first.
   * Discovered here so a later projection pass (#183) can merge them over the tree-root `mcp.json`.
   * Config merges by server id — it does not shadow whole like slug resources.
   */
  readonly mcpPaths?: readonly string[];
  /**
   * For agents: existing `agents/<slug>/hooks/` directories across all layers. The hooks namespace is
   * reserved (no protocol hooks entity yet); presence is surfaced as a diagnostic, not resolved.
   */
  readonly hookPaths?: readonly string[];
  /**
   * For agents: existing `agents/<slug>/pi/` directories across all layers, highest precedence
   * first. The Pi projector overlays these directories into its runtime `PI_CODING_AGENT_DIR`.
   */
  readonly piConfigDirectories?: readonly string[];
}

/** Locale-independent, deterministic slug ordering (code-unit comparison). */
export const compareSlugs = (left: string, right: string): number => (left < right ? -1 : left > right ? 1 : 0);

/**
 * The bare command name behind a file-tree command slug: the slug with its extension stripped
 * (`deploy/staging.md` -> `deploy/staging`). Files without an extension, and dotfiles, keep their
 * slug unchanged. Bare names are the canonical selector grammar because pi names prompt templates
 * by filename minus `.md`.
 */
export const commandSlugStem = (slug: string): string => {
  const dot = slug.lastIndexOf('.');
  const slash = slug.lastIndexOf('/');
  return dot > slash + 1 ? slug.slice(0, dot) : slug;
};

/**
 * The pi prompt-template invocation name behind a command slug: the bare name with nested path
 * separators flattened to `-` (`deploy/staging.md` -> `deploy-staging`), because pi's prompt
 * discovery is non-recursive and names templates by filename minus `.md`. Two slugs may flatten
 * to the same name (`a-b.md`, `a/b.md`); both selection ambiguity and projection treat that as a
 * collision rather than silently picking one.
 */
export const commandPromptName = (slug: string): string => commandSlugStem(slug).split('/').join('-');

/** One immutable effective resource set per invocation, keyed by kind then slug. */
export interface EffectiveResourceSet {
  readonly layers: readonly Layer[];
  readonly resources: ReadonlyMap<ResourceKind, ReadonlyMap<string, ResolvedResource>>;
  /** Agent-local resources, keyed by owning agent, kind, then slug. */
  readonly agentResources: ReadonlyMap<string, ReadonlyMap<ResourceKind, ReadonlyMap<string, ResolvedResource>>>;
}

export const listResources = (set: EffectiveResourceSet, kind: ResourceKind): readonly ResolvedResource[] => {
  const bySlug = set.resources.get(kind);

  if (bySlug === undefined) {
    return [];
  }

  return [...bySlug.values()].sort((left, right) => compareSlugs(left.slug, right.slug));
};

export const findResource = (
  set: EffectiveResourceSet,
  kind: ResourceKind,
  slug: string,
): ResolvedResource | undefined => set.resources.get(kind)?.get(slug);

export const listAgentResources = (
  set: EffectiveResourceSet,
  agentSlug: string,
  kind: ResourceKind,
): readonly ResolvedResource[] => {
  const bySlug = set.agentResources.get(agentSlug)?.get(kind);

  return bySlug === undefined ? [] : [...bySlug.values()].sort((left, right) => compareSlugs(left.slug, right.slug));
};

export const findAgentResource = (
  set: EffectiveResourceSet,
  agentSlug: string,
  kind: ResourceKind,
  slug: string,
): ResolvedResource | undefined => set.agentResources.get(agentSlug)?.get(kind)?.get(slug);

/** Resolves a loadout resource in the selected agent's private namespace before catalog fallback. */
export const findLoadoutResource = (
  set: EffectiveResourceSet,
  agentSlug: string,
  kind: ResourceKind,
  slug: string,
): ResolvedResource | undefined => findAgentResource(set, agentSlug, kind, slug) ?? findResource(set, kind, slug);
