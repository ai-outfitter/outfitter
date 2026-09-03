// Composes a harness-neutral CompositionPlan from the effective resource set and a selected agent.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { escapesRoots } from '../dump/Containment.js';
import type { AgentDefinition } from '../resolver/AgentDefinition.js';
import type { EffectiveResourceSet, Loadout, ResolvedResource } from '../resolver/Resource.js';
import { findResource } from '../resolver/Resource.js';
import type { AgentDefaults } from '../settings/Settings.js';
import type { ChainEntry } from './Chain.js';
import { resolveInheritanceChain } from './Chain.js';
import type { ComposedLoadout, ComposedSubagent, ComposedSubagentIdentity, CompositionPlan } from './Composition.js';
import type { DeclaredSlug, PromptSelection } from './Defaults.js';
import {
  SETTINGS_DEFAULTS_DECLARER,
  mergePromptSelections,
  mergeSelections,
  planAgentDefaults,
  resolveDeclaredSlugs,
  resolveSettingsPromptSelection,
  settingsPromptSelections,
  settingsSelections,
} from './Defaults.js';
import { composeMcpServers } from './Mcp.js';
import { resolveModelRegistry } from './Models.js';
import type { PromptFragment, PromptSourceReference } from './PromptSource.js';
import { agentBodyFragment, promptSourceKey, resolvePromptSource, rootPromptFragment } from './PromptSource.js';

export interface ComposeOptions {
  /** Active repository root for `repo_file` prompt references. */
  readonly projectDirectory?: string;
  /**
   * Settings-layer (`agent_defaults`) loadout entries composed into the agent ahead of its own
   * inheritance chain. Absent or empty defaults leave composition byte-identical to no settings.
   */
  readonly agentDefaults?: AgentDefaults;
}

export interface ComposeResult {
  readonly plan?: CompositionPlan;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

interface EffectiveControls {
  readonly loadout: Loadout;
  readonly skillSelections: readonly DeclaredSlug[];
  readonly subagentSelections: readonly DeclaredSlug[];
  readonly mcpSelections: readonly DeclaredSlug[];
  readonly appendPromptSelections: readonly PromptSelection[];
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

const appendPromptSelections = (chain: readonly ChainEntry[]): readonly PromptSelection[] => {
  const selections: PromptSelection[] = [];
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

const composeEffectiveControls = (chain: readonly ChainEntry[], defaults?: AgentDefaults): EffectiveControls => {
  // Settings defaults compose ahead of the whole chain, parent-first, like a root-most ancestor.
  const skills = mergeSelections(
    settingsSelections(defaults?.skills),
    declaredSelections(chain, (definition) => definition.loadout.skills),
  );
  const subagents = mergeSelections(
    settingsSelections(defaults?.subagents),
    declaredSelections(chain, (definition) => definition.loadout.subagents),
  );
  const mcp = mergeSelections(
    settingsSelections(defaults?.mcp),
    declaredSelections(chain, (definition) => definition.loadout.mcp),
  );
  const model = nearest(chain, (definition) => definition.loadout.model);
  const thinking = nearest(chain, (definition) => definition.loadout.thinking);

  return {
    skillSelections: skills,
    subagentSelections: subagents,
    mcpSelections: mcp,
    appendPromptSelections: mergePromptSelections(
      settingsPromptSelections(defaults?.appendSystemPrompt),
      appendPromptSelections(chain),
    ),
    systemPrompt: nearestPrompt(chain, (definition) => definition.promptControls.systemPrompt),
    promptTemplate: nearestPrompt(chain, (definition) => definition.promptControls.promptTemplate),
    label: nearest(chain, (definition) => definition.label),
    description: nearest(chain, (definition) => definition.description),
    loadout: {
      skills: skills.map((selection) => selection.slug),
      subagents: subagents.map((selection) => selection.slug),
      mcp: mcp.map((selection) => selection.slug),
      extensions: uniqueStrings([
        ...(defaults?.extensions ?? []),
        ...chain.flatMap((entry) => entry.definition.loadout.extensions),
      ]),
      plugins: uniqueStrings([
        ...(defaults?.plugins ?? []),
        ...chain.flatMap((entry) => entry.definition.loadout.plugins),
      ]),
      model,
      thinking,
      tools: composeTools(chain),
    },
  };
};

const resolveDelegateSkills = (
  set: EffectiveResourceSet,
  subagents: readonly ResolvedResource[],
  leaderSkills: readonly ResolvedResource[],
  defaults: AgentDefaults | undefined,
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
    const controls = composeEffectiveControls(chain.entries, defaults);

    for (const skill of resolveDeclaredSlugs(
      set,
      'skill',
      controls.skillSelections,
      warnings,
      `subagent '${subagent.slug}' `,
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
  defaults: AgentDefaults | undefined,
  warnings: string[],
): ComposedLoadout => {
  const subagents = resolveDeclaredSlugs(set, 'agent', controls.subagentSelections, warnings);
  const skills = resolveDeclaredSlugs(set, 'skill', controls.skillSelections, warnings);

  return {
    skills,
    delegateSkills: resolveDelegateSkills(set, subagents, skills, defaults, warnings),
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
  selection: PromptSelection,
  options: ComposeOptions,
  label: string,
  warnings: string[],
  errors: string[],
): PromptFragment | undefined => {
  if (selection.owner === undefined) {
    return resolveSettingsPromptSelection(set, selection, options.projectDirectory, label, warnings, errors);
  }

  // Prompt selections from the chain resolve in their declaring agent's namespace.
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
  // The fixed role label carries the provenance here; the index is never part of it.
  selection === undefined
    ? undefined
    : resolvePromptSelection(set, { ...selection, index: 0 }, options, label, warnings, errors);

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
        `append-${selection.owner ?? SETTINGS_DEFAULTS_DECLARER}-${selection.index + 1}`,
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

    // Delegates are agents too, so settings defaults compose into them ahead of their own chain.
    const controls = composeEffectiveControls(chainResult.entries, options.agentDefaults);
    const identity = composeIdentity(set, chainResult.entries, controls, options, warnings, errors);
    const skills = resolveDeclaredSlugs(
      set,
      'skill',
      controls.skillSelections,
      warnings,
      `subagent '${resource.slug}' `,
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
  const controls = composeEffectiveControls(chain, options.agentDefaults);
  const identity = composeIdentity(set, chain, controls, options, warnings, errors);
  const loadout = composeLoadout(set, controls, options.agentDefaults, warnings);
  const models = resolveModelRegistry(set, loadout.model, warnings, errors);
  const composedSubagents = composeSubagents(set, loadout.subagents, options, warnings, errors);
  const uniqueWarnings = uniqueStrings(warnings);
  if (errors.length > 0) return { errors, warnings: uniqueWarnings };
  const agentDefaults = planAgentDefaults(options.agentDefaults);

  return {
    plan: {
      agent: agentSlug,
      identity,
      ...(models.configured ? { models } : {}),
      loadout: { ...loadout, composedSubagents },
      contributingAgents: chain.map((entry) => entry.resource),
      inheritanceChain: chain.map((entry) => entry.resource.slug),
      ...(agentDefaults === undefined ? {} : { agentDefaults }),
      warnings: uniqueWarnings,
    },
    errors: [],
    warnings: uniqueWarnings,
  };
};
