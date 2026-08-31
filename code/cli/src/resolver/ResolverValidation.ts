// Validates an effective resource set: agent + skill definitions, unresolved loadout slugs, shadowing.
import { compose } from '../composer/Composer.js';
import { isSkillDocumentIssue, readSkillDocument } from '../skills/SkillDocument.js';
import { isAgentDefinitionIssue, readAgentDefinition } from './AgentDefinition.js';
import type { EffectiveResourceSet, ResolvedResource } from './Resource.js';
import { agentLocalKinds, findResource, listAgentResources, listResources } from './Resource.js';
import { isWorkflowDefinitionIssue, readWorkflowDefinition } from './WorkflowDefinition.js';
import type { WorkflowDefinition, WorkflowNode } from './WorkflowDefinition.js';

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

const workflowError = (slug: string, message: string): ValidationFinding => ({
  severity: 'error',
  resource: `workflow:${slug}`,
  message,
});

const workflowDefinitions = (
  set: EffectiveResourceSet,
): { readonly definitions: ReadonlyMap<string, WorkflowDefinition>; readonly findings: readonly ValidationFinding[] } => {
  const definitions = new Map<string, WorkflowDefinition>();
  const findings: ValidationFinding[] = [];

  for (const resource of listResources(set, 'workflow')) {
    const definition = readWorkflowDefinition(resource.winner.path);
    if (isWorkflowDefinitionIssue(definition)) {
      findings.push(workflowError(resource.slug, definition.message));
    } else if (definition.id !== resource.slug) {
      findings.push(workflowError(resource.slug, `workflow id '${definition.id}' must match its directory '${resource.slug}'.`));
    } else {
      definitions.set(resource.slug, definition);
    }
  }

  return { definitions, findings };
};

const nodeSkills = (node: WorkflowNode): readonly string[] => [
  ...(node.skill === undefined ? [] : [node.skill]),
  ...(node.skills ?? []),
];

const nodePrompts = (node: WorkflowNode): readonly string[] => [
  ...(node.prompt_fragment === undefined ? [] : [node.prompt_fragment]),
  ...(node.prompt_fragments ?? []),
];

const validateWorkflowAgentNode = (
  set: EffectiveResourceSet,
  workflow: WorkflowDefinition,
  node: WorkflowNode,
  projectDirectory?: string,
): readonly ValidationFinding[] => {
  if (node.actor === undefined) return [];
  const actor = workflow.actors[node.actor];
  if (actor?.kind !== 'agent' || actor.profile === undefined) return [];

  const composed = compose(set, actor.profile, { projectDirectory });
  if (composed.plan === undefined) {
    return composed.errors.map((message) => workflowError(workflow.id, `node '${node.id}' agent '${actor.profile}': ${message}`));
  }

  const availableSkills = new Set(composed.plan.loadout.skills.map((skill) => skill.slug));
  const availablePrompts = new Set(
    [
      composed.plan.identity.systemPromptFragment,
      composed.plan.identity.sharedContextFragment,
      ...(composed.plan.identity.appendSystemPrompts ?? []),
      composed.plan.identity.promptTemplate,
    ]
      .filter((fragment) => fragment?.reference !== undefined)
      .map((fragment) => fragment!.reference!),
  );
  const findings: ValidationFinding[] = [];

  for (const skill of [...(actor.skills ?? []), ...nodeSkills(node)]) {
    if (!availableSkills.has(skill)) {
      findings.push(workflowError(workflow.id, `node '${node.id}' references skill '${skill}' outside agent '${actor.profile}' composed closure.`));
    }
  }

  for (const prompt of nodePrompts(node)) {
    if (!availablePrompts.has(prompt)) {
      findings.push(workflowError(workflow.id, `node '${node.id}' references prompt fragment '${prompt}' outside agent '${actor.profile}' composed closure.`));
    }
  }

  for (const integrationId of node.uses ?? []) {
    const integration = workflow.integrations?.[integrationId];
    if (integration?.kind === 'mcp' && integration.server !== undefined && !composed.plan.loadout.mcp.includes(integration.server)) {
      findings.push(workflowError(workflow.id, `node '${node.id}' references MCP server '${integration.server}' outside agent '${actor.profile}' composed closure.`));
    }
  }

  return findings;
};

const validateWorkflow = (
  set: EffectiveResourceSet,
  workflow: WorkflowDefinition,
  definitions: ReadonlyMap<string, WorkflowDefinition>,
  projectDirectory?: string,
): readonly ValidationFinding[] => {
  const findings: ValidationFinding[] = [];
  const nodeIds = new Set<string>();

  for (const [actorId, actor] of Object.entries(workflow.actors)) {
    if (actor.kind === 'agent' && (actor.profile === undefined || findResource(set, 'agent', actor.profile) === undefined)) {
      findings.push(workflowError(workflow.id, `actor '${actorId}' references unknown agent '${actor.profile ?? ''}'.`));
    }
  }

  for (const node of workflow.nodes) {
    if (nodeIds.has(node.id)) findings.push(workflowError(workflow.id, `duplicate node id '${node.id}'.`));
    nodeIds.add(node.id);
  }

  for (const node of workflow.nodes) {
    if (node.actor !== undefined && workflow.actors[node.actor] === undefined) {
      findings.push(workflowError(workflow.id, `node '${node.id}' references unknown actor '${node.actor}'.`));
    }
    if (node.environment !== undefined && workflow.environments?.[node.environment] === undefined) {
      findings.push(workflowError(workflow.id, `node '${node.id}' references unknown environment '${node.environment}'.`));
    }
    for (const dependency of node.needs ?? []) {
      if (!nodeIds.has(dependency)) findings.push(workflowError(workflow.id, `node '${node.id}' needs unknown node '${dependency}'.`));
    }
    for (const integration of node.uses ?? []) {
      if (workflow.integrations?.[integration] === undefined) {
        findings.push(workflowError(workflow.id, `node '${node.id}' references unknown integration '${integration}'.`));
      }
    }
    if (node.workflow !== undefined && !definitions.has(node.workflow)) {
      findings.push(workflowError(workflow.id, `node '${node.id}' references unknown workflow '${node.workflow}'.`));
    }
    findings.push(...validateWorkflowAgentNode(set, workflow, node, projectDirectory));
  }

  for (const edge of workflow.feedback ?? []) {
    if (!nodeIds.has(edge.from)) findings.push(workflowError(workflow.id, `feedback references unknown source node '${edge.from}'.`));
    if (!nodeIds.has(edge.to)) findings.push(workflowError(workflow.id, `feedback references unknown target node '${edge.to}'.`));
  }

  for (const [integrationId, integration] of Object.entries(workflow.integrations ?? {})) {
    if (integration.kind !== 'artifact') continue;
    if (!/^[0-9a-f]{40}$/.test(integration.ref ?? '')) {
      findings.push(workflowError(workflow.id, `artifact integration '${integrationId}' must pin a full immutable Git commit.`));
    }
    if (!/^[0-9a-f]{64}$/.test(integration.sha256 ?? '')) {
      findings.push(workflowError(workflow.id, `artifact integration '${integrationId}' must declare a SHA-256 digest.`));
    }
    if (integration.repository === undefined || integration.path === undefined) {
      findings.push(workflowError(workflow.id, `artifact integration '${integrationId}' must declare repository and path.`));
    }
  }

  return findings;
};

const workflowCycleFindings = (definitions: ReadonlyMap<string, WorkflowDefinition>): readonly ValidationFinding[] => {
  const findings: ValidationFinding[] = [];
  const visiting = new Set<string>();
  const visited = new Set<string>();

  const visit = (slug: string, path: readonly string[]): void => {
    if (visiting.has(slug)) {
      findings.push(workflowError(slug, `nested workflow cycle: ${[...path, slug].join(' -> ')}.`));
      return;
    }
    if (visited.has(slug)) return;
    visiting.add(slug);
    const nested = definitions.get(slug)?.nodes.flatMap((node) => (node.workflow === undefined ? [] : [node.workflow])) ?? [];
    for (const child of nested) if (definitions.has(child)) visit(child, [...path, slug]);
    visiting.delete(slug);
    visited.add(slug);
  };

  for (const slug of definitions.keys()) visit(slug, []);
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

  const workflows = workflowDefinitions(set);
  findings.push(...workflows.findings);
  for (const workflow of workflows.definitions.values()) {
    findings.push(...validateWorkflow(set, workflow, workflows.definitions, projectDirectory));
  }
  findings.push(...workflowCycleFindings(workflows.definitions));

  for (const [agentSlug] of set.agentResources) {
    findings.push(...validateAgentLocalResources(set, agentSlug));
  }

  for (const kind of ['agent', 'skill', 'knowledge', 'command', 'workflow'] as const) {
    for (const resource of listResources(set, kind)) {
      findings.push(...shadowFindings(resource));
    }
  }

  return deduplicateFindings(findings);
};
