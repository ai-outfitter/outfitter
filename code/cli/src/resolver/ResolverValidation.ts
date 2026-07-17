// Validates an effective resource set: agent + skill definitions, unresolved loadout slugs, shadowing.
import { isSkillDocumentIssue, readSkillDocument } from '../skills/SkillDocument.js';
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
  const definition = readAgentDefinition(agent.winner.path, agent.configPaths ?? []);

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

const validateSkill = (skill: ResolvedResource): readonly ValidationFinding[] => {
  const document = readSkillDocument(skill.winner.path);

  if (isSkillDocumentIssue(document)) {
    return [{ severity: 'error', resource: `skill:${skill.slug}`, message: document.message }];
  }

  if (document.name !== skill.slug) {
    return [
      {
        severity: 'error',
        resource: `skill:${skill.slug}`,
        message: `SKILL.md name '${document.name}' must match its directory '${skill.slug}'.`,
      },
    ];
  }

  return [];
};

const shadowFindings = (resource: ResolvedResource): readonly ValidationFinding[] =>
  resource.shadowed.map((definition) => ({
    severity: 'warning' as const,
    resource: `${resource.kind}:${resource.slug}`,
    message: `shadowed definition in ${definition.layer.label} is overridden by ${resource.winner.layer.label}.`,
  }));

/**
 * Collects validation findings across the effective set. `error` findings always fail validation;
 * `warning` findings (such as shadowed definitions) fail only under `--strict`.
 */
export const validateEffectiveSet = (set: EffectiveResourceSet): readonly ValidationFinding[] => {
  const findings: ValidationFinding[] = [];

  for (const agent of listResources(set, 'agent')) {
    findings.push(...validateAgent(set, agent));
  }

  for (const skill of listResources(set, 'skill')) {
    findings.push(...validateSkill(skill));
  }

  for (const kind of ['agent', 'skill', 'knowledge', 'command'] as const) {
    for (const resource of listResources(set, kind)) {
      findings.push(...shadowFindings(resource));
    }
  }

  return findings;
};
