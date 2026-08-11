// Validates an effective resource set: agent + skill definitions, unresolved loadout slugs, shadowing.
import { compose } from '../composer/Composer.js';
import { isSkillDocumentIssue, readSkillDocument } from '../skills/SkillDocument.js';
import { isAgentDefinitionIssue, readAgentDefinition } from './AgentDefinition.js';
import type { EffectiveResourceSet, ResolvedResource } from './Resource.js';
import { agentLocalKinds, findResource, listAgentResources, listResources } from './Resource.js';

export interface ValidationFinding {
  readonly severity: 'error' | 'warning';
  readonly resource: string;
  readonly message: string;
}

/**
 * Options for {@link validateEffectiveSet}. `deferLoadoutResolution` downgrades an unresolved
 * loadout slug reference from an error to a warning — used when validating a single remote source
 * in isolation during `outfitter sync`, where a catalog may legitimately reference a skill supplied
 * by a catalog it declares as a dependency (OFTR-004.6). Loadout wholeness is then authoritatively
 * enforced against the merged effective set by `outfitter validate`; the run-time composer surfaces
 * an unresolved reference as a non-fatal warning (OFTR-005.3.4), fatal only under `run --strict`.
 */
export interface ValidationOptions {
  readonly deferLoadoutResolution?: boolean;
}

// Matches the composer's top-level unresolved-loadout warning wording (see `compose` in Composer.ts).
// It is deliberately coupled to that message; `resolver-validation.test.ts` drives the real composer,
// so a wording drift fails that test rather than silently disabling deferral.
const isUnresolvedLoadoutReference = (message: string): boolean =>
  /^loadout (?:skills|subagents) references unknown (?:skill|agent) '/.test(message);

const compositionWarningSeverity = (message: string, options: ValidationOptions): ValidationFinding['severity'] =>
  isUnresolvedLoadoutReference(message) && !options.deferLoadoutResolution ? 'error' : 'warning';

const validateAgent = (
  set: EffectiveResourceSet,
  agent: ResolvedResource,
  options: ValidationOptions,
  projectDirectory?: string,
): readonly ValidationFinding[] => {
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

  const composed = compose(set, agent.slug, { projectDirectory });
  const compositionFindings: ValidationFinding[] = [
    ...composed.errors.map((message) => ({ severity: 'error' as const, resource: `agent:${agent.slug}`, message })),
    ...composed.warnings.map((message) => ({
      severity: compositionWarningSeverity(message, options),
      resource: `agent:${agent.slug}`,
      message,
    })),
  ];

  return compositionFindings;
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

// Reserved agent-local resource shapes that resolver discovers but does not yet project into a run.
// Surfaced as warnings (fatal only under --strict) so content placed here is never silently dropped.
const reservedNamespaceFindings = (agent: ResolvedResource): readonly ValidationFinding[] => {
  const findings: ValidationFinding[] = [];

  if ((agent.hookPaths ?? []).length > 0) {
    findings.push({
      severity: 'warning',
      resource: `agent:${agent.slug}`,
      message: "agent-local 'hooks/' is a reserved namespace and is not yet resolved.",
    });
  }

  return findings;
};

const deduplicateFindings = (findings: readonly ValidationFinding[]): readonly ValidationFinding[] => {
  const deduplicated = new Map<string, ValidationFinding>();
  for (const finding of findings) {
    const key = `${finding.resource}\u0000${finding.message}`;
    if (!deduplicated.has(key)) deduplicated.set(key, finding);
  }
  return [...deduplicated.values()];
};

// Validates one agent's local resources: the owning agent must resolve, and each local skill is
// document-checked; knowledge/commands are opaque file trees today, so only shadowing is surfaced.
const validateAgentLocalResources = (set: EffectiveResourceSet, agentSlug: string): readonly ValidationFinding[] => {
  const findings: ValidationFinding[] = [];

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
      if (kind === 'skill') findings.push(...validateSkill(resource));
    }
  }

  return findings;
};

/**
 * Collects validation findings across the effective set. `error` findings always fail validation;
 * `warning` findings (such as shadowed definitions) fail only under `--strict`.
 */
export const validateEffectiveSet = (
  set: EffectiveResourceSet,
  projectDirectory?: string,
  options: ValidationOptions = {},
): readonly ValidationFinding[] => {
  const findings: ValidationFinding[] = [];

  for (const agent of listResources(set, 'agent')) {
    findings.push(...validateAgent(set, agent, options, projectDirectory), ...reservedNamespaceFindings(agent));
  }

  for (const skill of listResources(set, 'skill')) {
    findings.push(...validateSkill(skill));
  }

  for (const [agentSlug] of set.agentResources) {
    findings.push(...validateAgentLocalResources(set, agentSlug));
  }

  for (const kind of ['agent', 'skill', 'knowledge', 'command'] as const) {
    for (const resource of listResources(set, kind)) {
      findings.push(...shadowFindings(resource));
    }
  }

  return deduplicateFindings(findings);
};
