// Composes a harness-neutral CompositionPlan from the effective resource set and a selected agent.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { isAgentDefinitionIssue, readAgentDefinition } from '../resolver/AgentDefinition.js';
import type { EffectiveResourceSet, Loadout, ResolvedResource } from '../resolver/Resource.js';
import { findResource } from '../resolver/Resource.js';
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
  kind: 'skill' | 'agent',
  field: string,
  slugs: readonly string[],
  warnings: string[],
): readonly ResolvedResource[] => {
  const resolved: ResolvedResource[] = [];

  for (const slug of slugs) {
    const resource = findResource(set, kind, slug);

    if (resource === undefined) {
      warnings.push(`loadout ${field} references unknown ${kind} '${slug}'.`);
    } else {
      resolved.push(resource);
    }
  }

  return resolved;
};

const composeLoadout = (set: EffectiveResourceSet, loadout: Loadout, warnings: string[]): ComposedLoadout => ({
  skills: resolveSlugs(set, 'skill', 'skills', loadout.skills, warnings),
  subagents: resolveSlugs(set, 'agent', 'subagents', loadout.subagents, warnings),
  mcp: loadout.mcp,
  extensions: loadout.extensions,
  plugins: loadout.plugins,
  model: loadout.model,
  thinking: loadout.thinking,
  tools: loadout.tools,
});

/**
 * Composes the selected agent into a CompositionPlan. Returns an error when the agent slug does not
 * resolve or its definition is invalid; loadout slugs that do not resolve are non-fatal warnings.
 */
export const compose = (set: EffectiveResourceSet, agentSlug: string): ComposeResult => {
  const agent = findResource(set, 'agent', agentSlug);

  if (agent === undefined) {
    return { errors: [`Unknown agent '${agentSlug}'. Run 'outfitter list agents' to see resolvable agents.`] };
  }

  const definition = readAgentDefinition(dirname(agent.winner.path), agent.winner.path);

  if (isAgentDefinitionIssue(definition)) {
    return { errors: [`Agent '${agentSlug}' is invalid: ${definition.message}`] };
  }

  const warnings: string[] = [];
  const plan: CompositionPlan = {
    agent: agentSlug,
    identity: {
      systemPrompt: readRootFile(set, 'system-prompt.md'),
      sharedContext: readRootFile(set, 'agents.md'),
      agentBody: definition.body,
      description: definition.description,
    },
    loadout: composeLoadout(set, definition.loadout, warnings),
    warnings,
  };

  return { plan, errors: [] };
};
