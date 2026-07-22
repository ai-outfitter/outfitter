// Validates an effective resource set: agent + skill definitions, unresolved loadout slugs, shadowing.
import { isSkillDocumentIssue, readSkillDocument } from '../skills/SkillDocument.js';
import { isAgentDefinitionIssue, readAgentDefinition } from './AgentDefinition.js';
import type { EffectiveResourceSet, ResolvedResource } from './Resource.js';
import { agentLocalKinds, findLoadoutResource, findResource, listAgentResources, listResources } from './Resource.js';

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
    .filter((slug) => findLoadoutResource(set, agentSlug, kind, slug) === undefined)
    .map((slug) => ({
      severity: 'error' as const,
      resource: `agent:${agentSlug}`,
      message: `loadout ${field} references unknown ${kind} '${slug}'.`,
    }));

const validateAgent = (set: EffectiveResourceSet, agent: ResolvedResource): readonly ValidationFinding[] => {
  const definition = readAgentDefinition(agent.winner.path, agent.configPaths);

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

const resourceLabel = (resource: ResolvedResource): string =>
  resource.winner.ownerAgent === undefined
    ? `${resource.kind}:${resource.slug}`
    : `agent:${resource.winner.ownerAgent}/${resource.kind}:${resource.slug}`;

const validateSkill = (skill: ResolvedResource): readonly ValidationFinding[] => {
  const document = readSkillDocument(skill.winner.path);
  const label = resourceLabel(skill);

  if (isSkillDocumentIssue(document)) {
    return [{ severity: 'error', resource: label, message: document.message }];
  }

  if (document.name !== skill.slug) {
    return [
      {
        severity: 'error',
        resource: label,
        message: `SKILL.md name '${document.name}' must match its directory '${skill.slug}'.`,
      },
    ];
  }

  return [];
};

const shadowFindings = (resource: ResolvedResource): readonly ValidationFinding[] =>
  resource.shadowed.map((definition) => ({
    severity: 'warning' as const,
    resource: resourceLabel(resource),
    message: `shadowed definition in ${definition.layer.label} is overridden by ${resource.winner.layer.label}.`,
  }));

// Agent-local resource shapes that resolver discovers but does not yet project into a run. Surfaced
// as warnings (fatal only under --strict) so a selection placed here is never silently dropped.
const reservedNamespaceFindings = (agent: ResolvedResource): readonly ValidationFinding[] => {
  const findings: ValidationFinding[] = [];

  if ((agent.mcpPaths ?? []).length > 0) {
    findings.push({
      severity: 'warning',
      resource: `agent:${agent.slug}`,
      message: "agent-local 'mcp.json' is discovered but not yet projected into the run (adapter parity, #183).",
    });
  }

  if ((agent.hookPaths ?? []).length > 0) {
    findings.push({
      severity: 'warning',
      resource: `agent:${agent.slug}`,
      message: "agent-local 'hooks/' is a reserved namespace and is not yet resolved.",
    });
  }

  return findings;
};

/**
 * Collects validation findings across the effective set. `error` findings always fail validation;
 * `warning` findings (such as shadowed definitions) fail only under `--strict`.
 */
export const validateEffectiveSet = (set: EffectiveResourceSet): readonly ValidationFinding[] => {
  const findings: ValidationFinding[] = [];

  for (const agent of listResources(set, 'agent')) {
    findings.push(...validateAgent(set, agent), ...reservedNamespaceFindings(agent));
  }

  for (const skill of listResources(set, 'skill')) {
    findings.push(...validateSkill(skill));
  }

  for (const [agentSlug] of set.agentResources) {
    if (findResource(set, 'agent', agentSlug) === undefined) {
      findings.push({
        severity: 'error',
        resource: `agent:${agentSlug}`,
        message: 'agent-local resources require a resolvable owning agent.',
      });
    }

    for (const kind of agentLocalKinds) {
      for (const resource of listAgentResources(set, agentSlug, kind)) {
        findings.push(...shadowFindings(resource));
        // Only skills have a document reader today; knowledge/commands are opaque file trees.
        if (kind === 'skill') findings.push(...validateSkill(resource));
      }
    }
  }

  for (const kind of ['agent', 'skill', 'knowledge', 'command'] as const) {
    for (const resource of listResources(set, kind)) {
      findings.push(...shadowFindings(resource));
    }
  }

  return findings;
};
