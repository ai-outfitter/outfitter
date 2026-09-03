// Resolves an agent's inheritance chain: ordered parent-first entries with cycle and parent checks.
import { isAgentDefinitionIssue, readAgentDefinition } from '../resolver/AgentDefinition.js';
import type { AgentDefinition } from '../resolver/AgentDefinition.js';
import type { EffectiveResourceSet, ResolvedResource } from '../resolver/Resource.js';
import { findResource } from '../resolver/Resource.js';

export interface ChainEntry {
  readonly resource: ResolvedResource;
  readonly definition: AgentDefinition;
}

const readValidAgent = (agent: ResolvedResource): AgentDefinition | string => {
  const definition = readAgentDefinition(agent.winner.path, agent.configPaths);
  if (isAgentDefinitionIssue(definition)) return definition.message;
  if (definition.name !== agent.slug) return `agent.md name '${definition.name}' must match its directory.`;
  return definition;
};

export const resolveInheritanceChain = (
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
