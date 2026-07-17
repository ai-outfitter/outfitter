// Validates an effective resource set: agent frontmatter, unresolved loadout slugs, and shadowing.
import { dirname } from 'node:path';

import { isAgentDefinitionIssue, readAgentDefinition } from './AgentDefinition.js';
import type { EffectiveResourceSet, ResolvedResource } from './Resource.js';
import { listResources } from './Resource.js';

export interface ValidationFinding {
  readonly severity: 'error' | 'warning';
  readonly resource: string;
  readonly message: string;
}

const loadoutSlugReference = (
  set: EffectiveResourceSet,
  agentSlug: string,
  kind: 'agent' | 'skill',
  field: string,
  slugs: readonly string[],
): readonly ValidationFinding[] =>
  slugs
    .filter((slug) => set.resources.get(kind)?.get(slug) === undefined)
    .map((slug) => ({
      severity: 'error' as const,
      resource: `agent:${agentSlug}`,
      message: `loadout ${field} references unknown ${kind} '${slug}'.`,
    }));

const validateAgent = (set: EffectiveResourceSet, agent: ResolvedResource): readonly ValidationFinding[] => {
  const definition = readAgentDefinition(dirname(agent.winner.path), agent.winner.path);

  if (isAgentDefinitionIssue(definition)) {
    return [{ severity: 'error', resource: `agent:${agent.slug}`, message: definition.message }];
  }

  if (definition.name !== agent.slug) {
    return [
      {
        severity: 'error',
        resource: `agent:${agent.slug}`,
        message: `agent.md name '${definition.name}' must match its directory '${agent.slug}'.`,
      },
    ];
  }

  return [
    ...loadoutSlugReference(set, agent.slug, 'skill', 'skills', definition.loadout.skills),
    ...loadoutSlugReference(set, agent.slug, 'agent', 'subagents', definition.loadout.subagents),
  ];
};

const shadowFindings = (resource: ResolvedResource): readonly ValidationFinding[] =>
  resource.shadowed.map((definition) => ({
    severity: 'warning' as const,
    resource: `${resource.kind}:${resource.slug}`,
    message: `shadowed definition in ${definition.layer.label} is overridden by ${resource.winner.layer.label}.`,
  }));

/** Collects validation findings across the effective set. Errors fail `--strict`; warnings are advisory. */
export const validateEffectiveSet = (set: EffectiveResourceSet): readonly ValidationFinding[] => {
  const findings: ValidationFinding[] = [];

  for (const agent of listResources(set, 'agent')) {
    findings.push(...validateAgent(set, agent));
  }

  for (const kind of ['agent', 'skill', 'knowledge', 'command'] as const) {
    for (const resource of listResources(set, kind)) {
      findings.push(...shadowFindings(resource));
    }
  }

  return findings;
};
