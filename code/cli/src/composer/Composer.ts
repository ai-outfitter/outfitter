// Composes a harness-neutral CompositionPlan from the effective resource set and a selected agent.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { escapesRoots } from '../dump/Containment.js';
import { readWorkspaceHooks } from '../hooks/WorkspaceHook.js';
import { isAgentDefinitionIssue, readAgentDefinition } from '../resolver/AgentDefinition.js';
import type { AgentDefinition } from '../resolver/AgentDefinition.js';
import type { EffectiveResourceSet, Loadout, ResolvedResource } from '../resolver/Resource.js';
import { findLoadoutResource, findResource } from '../resolver/Resource.js';
import type { ComposedLoadout, ComposedSubagent, ComposedSubagentIdentity, CompositionPlan } from './Composition.js';
import { resolveModelRegistry } from './Models.js';
import type { PromptFragment, PromptSourceReference } from './PromptSource.js';
import { agentBodyFragment, promptSourceKey, resolvePromptSource, rootPromptFragment } from './PromptSource.js';

export interface ComposeOptions {
  /** Active repository root for `repo_file` prompt references. */
  readonly projectDirectory?: string;
}

export interface ComposeResult {
  readonly plan?: CompositionPlan;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

interface ChainEntry {
  readonly resource: ResolvedResource;
  readonly definition: AgentDefinition;
}

interface DeclaredSlug {
  readonly slug: string;
  readonly owner: string;
}

interface EffectiveControls {
  readonly loadout: Loadout;
  readonly skillSelections: readonly DeclaredSlug[];
  readonly subagentSelections: readonly DeclaredSlug[];
  readonly mcpSelections: readonly DeclaredSlug[];
  readonly appendPromptSelections: readonly {
    readonly source: PromptSourceReference;
    readonly owner: string;
    readonly index: number;
  }[];
  readonly systemPrompt?: { readonly source: PromptSourceReference; readonly owner: string };
  readonly promptTemplate?: { readonly source: PromptSourceReference; readonly owner: string };
  readonly label?: string;
  readonly description?: string;
}

/** Reads the highest-precedence tree-root file (e.g. system-prompt.md) across layers, or undefined. */
const readRootFile = (set: EffectiveResourceSet, fileName: string): PromptFragment | undefined => {
  for (const layer of set.layers) {
    const candidate = join(layer.root, fileName);

    if (existsSync(candidate)) {
      return rootPromptFragment({ fileName, layer, content: readFileSync(candidate, 'utf8') });
    }
  }

  return undefined;
};

const readValidAgent = (agent: ResolvedResource): AgentDefinition | string => {
  const definition = readAgentDefinition(agent.winner.path, agent.configPaths);
  if (isAgentDefinitionIssue(definition)) return definition.message;
  if (definition.name !== agent.slug) return `agent.md name '${definition.name}' must match its directory.`;
  return definition;
};

const resolveInheritanceChain = (
  set: EffectiveResourceSet,
  agentSlug: string,
): { entries?: readonly ChainEntry[]; errors: readonly string[] } => {
  const entries: ChainEntry[] = [];
  const composed = new Set<string>();
  const visiting: string[] = [];
  const errors: string[] = [];

  const visit = (slug: string): void => {
    if (composed.has(slug)) return;
    const cycleIndex = visiting.indexOf(slug);
    if (cycleIndex !== -1) {
      errors.push(`Agent inheritance cycle detected: ${[...visiting.slice(cycleIndex), slug].join(' -> ')}.`);
      return;
    }

    const resource = findResource(set, 'agent', slug);
    if (resource === undefined) {
      errors.push(
        `Agent inheritance references unknown parent '${slug}' in chain ${[...visiting, slug].join(' -> ')}.`,
      );
      return;
    }

    const definition = readValidAgent(resource);
    if (typeof definition === 'string') {
      errors.push(`Agent '${slug}' is invalid: ${definition}`);
      return;
    }

    visiting.push(slug);
    for (const parent of definition.inherits) visit(parent);
    visiting.pop();

    if (!composed.has(slug)) {
      composed.add(slug);
      entries.push({ resource, definition });
    }
  };

  visit(agentSlug);
  return errors.length > 0 ? { errors } : { entries, errors: [] };
};

const stablePush = <T>(items: T[], keySet: Set<string>, key: string, value: T): void => {
  if (!keySet.has(key)) {
    keySet.add(key);
    items.push(value);
  }
};

const union = (values: readonly string[] = [], next: readonly string[] = []): readonly string[] | undefined => {
  const merged: string[] = [];
  const seen = new Set<string>();
  for (const value of [...values, ...next]) stablePush(merged, seen, value, value);
  return merged.length > 0 ? merged : undefined;
};

const uniqueStrings = (values: readonly string[]): readonly string[] => [...new Set(values)];

const declaredSelections = (
  chain: readonly ChainEntry[],
  select: (definition: AgentDefinition) => readonly string[],
): readonly DeclaredSlug[] => {
  const selections: DeclaredSlug[] = [];
  const seen = new Set<string>();
  for (const entry of chain) {
    for (const slug of select(entry.definition)) {
      stablePush(selections, seen, slug, { slug, owner: entry.resource.slug });
    }
  }
  return selections;
};

const appendPromptSelections = (chain: readonly ChainEntry[]): EffectiveControls['appendPromptSelections'] => {
  const selections: { readonly source: PromptSourceReference; readonly owner: string; readonly index: number }[] = [];
  const seen = new Set<string>();
  for (const entry of chain) {
    entry.definition.promptControls.appendSystemPrompt.forEach((source, index) => {
      stablePush(selections, seen, promptSourceKey(source), { source, owner: entry.resource.slug, index });
    });
  }
  return selections;
};

const nearest = <T>(
  chain: readonly ChainEntry[],
  select: (definition: AgentDefinition) => T | undefined,
): T | undefined => {
  for (const entry of [...chain].reverse()) {
    const value = select(entry.definition);
    if (value !== undefined) return value;
  }
  return undefined;
};

const composeTools = (chain: readonly ChainEntry[]): Loadout['tools'] => {
  const allow = union(
    [],
    chain.flatMap((entry) => entry.definition.loadout.tools?.allow ?? []),
  );
  const deny = union(
    [],
    chain.flatMap((entry) => entry.definition.loadout.tools?.deny ?? []),
  );
  return allow === undefined && deny === undefined ? undefined : { allow, deny };
};

const nearestPrompt = (
  chain: readonly ChainEntry[],
  select: (definition: AgentDefinition) => PromptSourceReference | undefined,
): EffectiveControls['systemPrompt'] => {
  for (const entry of [...chain].reverse()) {
    const source = select(entry.definition);
    if (source !== undefined) return { source, owner: entry.resource.slug };
  }
  return undefined;
};

const composeEffectiveControls = (chain: readonly ChainEntry[]): EffectiveControls => {
  const skills = declaredSelections(chain, (definition) => definition.loadout.skills);
  const subagents = declaredSelections(chain, (definition) => definition.loadout.subagents);
  const mcp = declaredSelections(chain, (definition) => definition.loadout.mcp);
  const model = nearest(chain, (definition) => definition.loadout.model);
  const thinking = nearest(chain, (definition) => definition.loadout.thinking);

  return {
    skillSelections: skills,
    subagentSelections: subagents,
    mcpSelections: mcp,
    appendPromptSelections: appendPromptSelections(chain),
    systemPrompt: nearestPrompt(chain, (definition) => definition.promptControls.systemPrompt),
    promptTemplate: nearestPrompt(chain, (definition) => definition.promptControls.promptTemplate),
    label: nearest(chain, (definition) => definition.label),
    description: nearest(chain, (definition) => definition.description),
    loadout: {
      skills: skills.map((selection) => selection.slug),
      subagents: subagents.map((selection) => selection.slug),
      mcp: mcp.map((selection) => selection.slug),
      extensions: uniqueStrings(chain.flatMap((entry) => entry.definition.loadout.extensions)),
      plugins: uniqueStrings(chain.flatMap((entry) => entry.definition.loadout.plugins)),
      model,
      thinking,
      tools: composeTools(chain),
    },
  };
};

const resolveDeclaredSlugs = (
  set: EffectiveResourceSet,
  kind: 'skill' | 'agent',
  reference: string,
  selections: readonly DeclaredSlug[],
  warnings: string[],
): readonly ResolvedResource[] => {
  const resolved: ResolvedResource[] = [];

  for (const selection of selections) {
    const resource = findLoadoutResource(set, selection.owner, kind, selection.slug);

    if (resource === undefined) {
      warnings.push(`${reference} references unknown ${kind} '${selection.slug}'.`);
    } else {
      resolved.push(resource);
    }
  }

  return resolved;
};

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const readMcpServers = (path: string, warnings: string[]): Readonly<Record<string, unknown>> => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    warnings.push(`MCP configuration '${path}' is not readable JSON: ${String(error)}`);
    return {};
  }

  const document = asRecord(parsed);
  const servers = document === undefined ? undefined : asRecord(document.mcpServers);

  if (servers === undefined) {
    warnings.push(`MCP configuration '${path}' must contain an object-valued 'mcpServers' map.`);
    return {};
  }

  return servers;
};

const composeMcpServers = (
  set: EffectiveResourceSet,
  selections: readonly DeclaredSlug[],
  warnings: string[],
): Readonly<Record<string, unknown>> => {
  if (selections.length === 0) return {};

  const rootPaths = set.layers.map((layer) => join(layer.root, 'mcp.json')).filter((path) => existsSync(path));
  const roots = set.layers.map((layer) => layer.root);
  const cache = new Map<string, Readonly<Record<string, unknown>>>();
  const serversAt = (path: string): Readonly<Record<string, unknown>> => {
    const cached = cache.get(path);
    if (cached !== undefined) return cached;
    let servers: Readonly<Record<string, unknown>>;
    if (escapesRoots(path, roots)) {
      warnings.push(`MCP configuration '${path}' resolves outside the resource layers and was skipped.`);
      servers = {};
    } else {
      servers = readMcpServers(path, warnings);
    }
    cache.set(path, servers);
    return servers;
  };

  const selected: Record<string, unknown> = {};
  for (const selection of selections) {
    // MCP selections are created only from entries in the resolved inheritance chain.
    const owner = findResource(set, 'agent', selection.owner)!;
    // Root definitions are shared; only the declaring agent's overlays may override its selection.
    const ownerPaths = [...owner.mcpPaths!].reverse();
    const pathsByPrecedence = [...rootPaths].reverse().concat(ownerPaths);
    let definition: unknown;
    let found = false;

    for (const path of pathsByPrecedence) {
      const servers = serversAt(path);
      if (Object.hasOwn(servers, selection.slug)) {
        definition = servers[selection.slug];
        found = true;
      }
    }

    if (found) selected[selection.slug] = definition;
    else warnings.push(`loadout mcp references unknown server '${selection.slug}'.`);
  }

  return selected;
};

const resolveDelegateSkills = (
  set: EffectiveResourceSet,
  subagents: readonly ResolvedResource[],
  leaderSkills: readonly ResolvedResource[],
  warnings: string[],
): readonly ResolvedResource[] => {
  const skills = new Map(leaderSkills.map((skill) => [skill.slug, skill]));
  const delegateSkills: ResolvedResource[] = [];
  const roots = set.layers.map((layer) => layer.root);

  for (const subagent of subagents) {
    // Resolver annotates every agent resource with configPaths, including an empty array.
    const definitionPaths = [subagent.winner.path, ...subagent.configPaths!];
    if (definitionPaths.some((path) => escapesRoots(path, roots))) continue;

    const chain = resolveInheritanceChain(set, subagent.slug);
    if (chain.entries === undefined) continue;
    const controls = composeEffectiveControls(chain.entries);

    for (const skill of resolveDeclaredSlugs(
      set,
      'skill',
      `subagent '${subagent.slug}' loadout skills`,
      controls.skillSelections,
      warnings,
    )) {
      const selected = skills.get(skill.slug);

      if (selected === undefined) {
        skills.set(skill.slug, skill);
        delegateSkills.push(skill);
      } else if (selected.winner.path !== skill.winner.path) {
        warnings.push(
          `delegate skill '${skill.slug}' resolves to conflicting definitions; using '${selected.winner.path}'.`,
        );
      }
    }
  }

  return delegateSkills;
};

const composeLoadout = (
  set: EffectiveResourceSet,
  controls: EffectiveControls,
  warnings: string[],
): ComposedLoadout => {
  const subagents = resolveDeclaredSlugs(set, 'agent', 'loadout subagents', controls.subagentSelections, warnings);
  const skills = resolveDeclaredSlugs(set, 'skill', 'loadout skills', controls.skillSelections, warnings);

  return {
    skills,
    delegateSkills: resolveDelegateSkills(set, subagents, skills, warnings),
    subagents,
    mcp: controls.loadout.mcp,
    mcpServers: composeMcpServers(set, controls.mcpSelections, warnings),
    extensions: controls.loadout.extensions,
    plugins: controls.loadout.plugins,
    model: controls.loadout.model,
    thinking: controls.loadout.thinking,
    tools: controls.loadout.tools,
  };
};

const resolvePromptSelection = (
  set: EffectiveResourceSet,
  selection: { readonly source: PromptSourceReference; readonly owner: string },
  options: ComposeOptions,
  label: string,
  warnings: string[],
  errors: string[],
): PromptFragment | undefined => {
  // Prompt selections are created only from entries in the resolved inheritance chain.
  const owner = findResource(set, 'agent', selection.owner)!;
  const resolved = resolvePromptSource({
    source: selection.source,
    declaringAgent: selection.owner,
    layer: owner.winner.layer,
    projectDirectory: options.projectDirectory,
    optionalRepoFile: true,
    label,
  });
  if (resolved.warning !== undefined) warnings.push(resolved.warning);
  if (resolved.error !== undefined) errors.push(resolved.error);
  return resolved.fragment;
};

const resolveOptionalPrompt = (
  set: EffectiveResourceSet,
  selection: EffectiveControls['systemPrompt'],
  options: ComposeOptions,
  label: string,
  warnings: string[],
  errors: string[],
): PromptFragment | undefined =>
  selection === undefined ? undefined : resolvePromptSelection(set, selection, options, label, warnings, errors);

const composeIdentity = (
  set: EffectiveResourceSet,
  chain: readonly ChainEntry[],
  controls: EffectiveControls,
  options: ComposeOptions,
  warnings: string[],
  errors: string[],
): ComposedSubagentIdentity => {
  const declaredSystemPrompt = resolveOptionalPrompt(
    set,
    controls.systemPrompt,
    options,
    'system-prompt',
    warnings,
    errors,
  );
  if (declaredSystemPrompt?.kind === 'repo_file') {
    warnings.push(
      `agent '${controls.systemPrompt!.owner}' uses untrusted repo_file '${declaredSystemPrompt.reference}' as system_prompt.`,
    );
  }
  const systemPrompt = declaredSystemPrompt ?? readRootFile(set, 'system-prompt.md');
  const sharedContext = readRootFile(set, 'agents.md');
  const appendSystemPrompts = controls.appendPromptSelections
    .map((selection) =>
      resolvePromptSelection(
        set,
        selection,
        options,
        `append-${selection.owner}-${selection.index + 1}`,
        warnings,
        errors,
      ),
    )
    .filter((fragment): fragment is PromptFragment => fragment !== undefined);
  const promptTemplate = resolveOptionalPrompt(
    set,
    controls.promptTemplate,
    options,
    'prompt-template',
    warnings,
    errors,
  );
  const agentBodies = chain.map((entry) =>
    agentBodyFragment({
      agent: entry.resource.slug,
      layer: entry.resource.winner.layer,
      path: entry.resource.winner.path,
      content: entry.definition.body,
    }),
  );

  return {
    systemPrompt: systemPrompt?.content,
    systemPromptFragment: systemPrompt,
    sharedContext: sharedContext?.content,
    sharedContextFragment: sharedContext,
    appendSystemPrompts,
    agentBodies,
    promptTemplate,
    agentBody: agentBodies.map((fragment) => fragment.content).join('\n'),
    label: controls.label,
    description: controls.description,
  };
};

const composeSubagents = (
  set: EffectiveResourceSet,
  subagents: readonly ResolvedResource[],
  options: ComposeOptions,
  warnings: string[],
  errors: string[],
): readonly ComposedSubagent[] => {
  const composed: ComposedSubagent[] = [];

  const roots = set.layers.map((layer) => layer.root);
  for (const resource of subagents) {
    const definitionPaths = [resource.winner.path, ...resource.configPaths!];
    if (definitionPaths.some((path) => escapesRoots(path, roots))) continue;

    const chainResult = resolveInheritanceChain(set, resource.slug);
    if (chainResult.entries === undefined) {
      errors.push(...chainResult.errors.map((error) => `Subagent '${resource.slug}' is invalid: ${error}`));
      continue;
    }

    const controls = composeEffectiveControls(chainResult.entries);
    const identity = composeIdentity(set, chainResult.entries, controls, options, warnings, errors);
    const skills = resolveDeclaredSlugs(
      set,
      'skill',
      `subagent '${resource.slug}' loadout skills`,
      controls.skillSelections,
      warnings,
    );
    composed.push({
      resource,
      identity,
      skills,
      extensions: controls.loadout.extensions,
      model: controls.loadout.model,
      thinking: controls.loadout.thinking,
      tools: controls.loadout.tools,
    });
  }

  return composed;
};

/** Composes one selected agent from the shared effective resource set. */
export const compose = (set: EffectiveResourceSet, agentSlug: string, options: ComposeOptions = {}): ComposeResult => {
  if (findResource(set, 'agent', agentSlug) === undefined) {
    return {
      errors: [`Unknown agent '${agentSlug}'. Run 'outfitter list agents' to see resolvable agents.`],
      warnings: [],
    };
  }

  const chainResult = resolveInheritanceChain(set, agentSlug);
  if (chainResult.entries === undefined) return { errors: chainResult.errors, warnings: [] };
  const chain = chainResult.entries;
  const warnings: string[] = [];
  const errors: string[] = [];
  const controls = composeEffectiveControls(chain);
  const identity = composeIdentity(set, chain, controls, options, warnings, errors);
  const loadout = composeLoadout(set, controls, warnings);
  const models = resolveModelRegistry(set, loadout.model, warnings, errors);
  const composedSubagents = composeSubagents(set, loadout.subagents, options, warnings, errors);
  const uniqueWarnings = uniqueStrings(warnings);
  if (errors.length > 0) return { errors, warnings: uniqueWarnings };
  let workspaceHooks;
  try {
    workspaceHooks = options.projectDirectory === undefined ? undefined : readWorkspaceHooks(options.projectDirectory);
  } catch (error) {
    return { errors: [String(error)], warnings: uniqueWarnings };
  }

  return {
    plan: {
      agent: agentSlug,
      identity,
      ...(models.configured ? { models } : {}),
      loadout: { ...loadout, composedSubagents },
      contributingAgents: chain.map((entry) => entry.resource),
      inheritanceChain: chain.map((entry) => entry.resource.slug),
      ...(workspaceHooks === undefined ? {} : { workspaceHooks }),
      warnings: uniqueWarnings,
    },
    errors: [],
    warnings: uniqueWarnings,
  };
};
