// Composes a harness-neutral CompositionPlan from the effective resource set and a selected agent.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { escapesRoots } from '../dump/Containment.js';
import { isAgentDefinitionIssue, readAgentDefinition } from '../resolver/AgentDefinition.js';
import type { EffectiveResourceSet, Loadout, ResolvedResource } from '../resolver/Resource.js';
import { findLoadoutResource, findResource } from '../resolver/Resource.js';
import type { ComposedLoadout, CompositionPlan } from './Composition.js';

export interface ComposeResult {
  readonly plan?: CompositionPlan;
  readonly errors: readonly string[];
}

/** Reads the highest-precedence tree-root file (e.g. system-prompt.md) across layers, or undefined. */
const readRootFile = (set: EffectiveResourceSet, fileName: string): string | undefined => {
  for (const layer of set.layers) {
    const candidate = join(layer.root, fileName);

    if (existsSync(candidate)) {
      return readFileSync(candidate, 'utf8');
    }
  }

  return undefined;
};

const resolveSlugs = (
  set: EffectiveResourceSet,
  agentSlug: string,
  kind: 'skill' | 'agent',
  reference: string,
  slugs: readonly string[],
  warnings: string[],
): readonly ResolvedResource[] => {
  const resolved: ResolvedResource[] = [];

  for (const slug of slugs) {
    const resource = findLoadoutResource(set, agentSlug, kind, slug);

    if (resource === undefined) {
      warnings.push(`${reference} references unknown ${kind} '${slug}'.`);
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
  agent: ResolvedResource,
  selectedIds: readonly string[],
  warnings: string[],
): Readonly<Record<string, unknown>> => {
  if (selectedIds.length === 0) {
    return {};
  }

  const rootPaths = set.layers.map((layer) => join(layer.root, 'mcp.json')).filter((path) => existsSync(path));
  const pathsByPrecedence = [
    ...rootPaths.reverse(),
    // Resolver annotates every agent resource with mcpPaths, including an empty array.
    ...[...agent.mcpPaths!].reverse(),
  ];
  const available: Record<string, unknown> = {};
  const roots = set.layers.map((layer) => layer.root);

  for (const path of pathsByPrecedence) {
    if (escapesRoots(path, roots)) {
      warnings.push(`MCP configuration '${path}' resolves outside the resource layers and was skipped.`);
      continue;
    }
    Object.assign(available, readMcpServers(path, warnings));
  }

  const selected: Record<string, unknown> = {};
  for (const id of selectedIds) {
    if (Object.hasOwn(available, id)) {
      selected[id] = available[id];
    } else {
      warnings.push(`loadout mcp references unknown server '${id}'.`);
    }
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
    const definitionPaths = [subagent.winner.path, ...(subagent.configPaths ?? [])];
    if (definitionPaths.some((path) => escapesRoots(path, roots))) continue;

    const definition = readAgentDefinition(subagent.winner.path, subagent.configPaths);

    if (isAgentDefinitionIssue(definition) || definition.name !== subagent.slug) {
      continue;
    }

    for (const skill of resolveSlugs(
      set,
      subagent.slug,
      'skill',
      `subagent '${subagent.slug}' loadout skills`,
      definition.loadout.skills,
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
  agent: ResolvedResource,
  loadout: Loadout,
  warnings: string[],
): ComposedLoadout => {
  const subagents = resolveSlugs(set, agent.slug, 'agent', 'loadout subagents', loadout.subagents, warnings);
  const skills = resolveSlugs(set, agent.slug, 'skill', 'loadout skills', loadout.skills, warnings);

  return {
    skills,
    delegateSkills: resolveDelegateSkills(set, subagents, skills, warnings),
    subagents,
    mcp: loadout.mcp,
    mcpServers: composeMcpServers(set, agent, loadout.mcp, warnings),
    extensions: loadout.extensions,
    plugins: loadout.plugins,
    model: loadout.model,
    thinking: loadout.thinking,
    tools: loadout.tools,
  };
};

/**
 * Composes the selected agent into a CompositionPlan. Returns an error when the agent slug does not
 * resolve or its definition is invalid; loadout slugs that do not resolve are non-fatal warnings.
 */
export const compose = (set: EffectiveResourceSet, agentSlug: string): ComposeResult => {
  const agent = findResource(set, 'agent', agentSlug);

  if (agent === undefined) {
    return { errors: [`Unknown agent '${agentSlug}'. Run 'outfitter list agents' to see resolvable agents.`] };
  }

  const definition = readAgentDefinition(agent.winner.path, agent.configPaths);

  if (isAgentDefinitionIssue(definition)) {
    return { errors: [`Agent '${agentSlug}' is invalid: ${definition.message}`] };
  }

  // A name/directory mismatch is an invalid agent (OFTR-003.2) and must fail composition.
  if (definition.name !== agentSlug) {
    return {
      errors: [`Agent '${agentSlug}' is invalid: agent.md name '${definition.name}' must match its directory.`],
    };
  }

  const warnings: string[] = [];
  const plan: CompositionPlan = {
    agent: agentSlug,
    identity: {
      systemPrompt: readRootFile(set, 'system-prompt.md'),
      sharedContext: readRootFile(set, 'agents.md'),
      agentBody: definition.body,
      label: definition.label,
      description: definition.description,
    },
    loadout: composeLoadout(set, agent, definition.loadout, warnings),
    warnings,
  };

  return { plan, errors: [] };
};
