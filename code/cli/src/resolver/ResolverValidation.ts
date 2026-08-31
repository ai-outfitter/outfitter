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
): {
  readonly definitions: ReadonlyMap<string, WorkflowDefinition>;
  readonly findings: readonly ValidationFinding[];
} => {
  const definitions = new Map<string, WorkflowDefinition>();
  const findings: ValidationFinding[] = [];

  for (const resource of listResources(set, 'workflow')) {
    const definition = readWorkflowDefinition(resource.winner.path);
    if (isWorkflowDefinitionIssue(definition)) {
      findings.push(workflowError(resource.slug, definition.message));
    } else if (definition.id !== resource.slug) {
      findings.push(
        workflowError(resource.slug, `workflow id '${definition.id}' must match its directory '${resource.slug}'.`),
      );
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

const missingClosureFindings = (
  workflowId: string,
  nodeId: string,
  profile: string,
  kind: 'skill' | 'prompt fragment',
  requested: readonly string[],
  available: ReadonlySet<string>,
): readonly ValidationFinding[] =>
  requested
    .filter((slug) => !available.has(slug))
    .map((slug) =>
      workflowError(
        workflowId,
        `node '${nodeId}' references ${kind} '${slug}' outside agent '${profile}' composed closure.`,
      ),
    );

const selectedMcpFindings = (
  workflow: WorkflowDefinition,
  node: WorkflowNode,
  profile: string,
  selected: readonly string[],
): readonly ValidationFinding[] =>
  (node.uses ?? []).flatMap((integrationId) => {
    const integration = workflow.integrations?.[integrationId];
    return integration?.kind === 'mcp' && integration.server !== undefined && !selected.includes(integration.server)
      ? [
          workflowError(
            workflow.id,
            `node '${node.id}' references MCP server '${integration.server}' outside agent '${profile}' composed closure.`,
          ),
        ]
      : [];
  });

const hasAgentClosureAssertions = (workflow: WorkflowDefinition, node: WorkflowNode): boolean =>
  nodeSkills(node).length > 0 ||
  nodePrompts(node).length > 0 ||
  (node.uses ?? []).some((integrationId) => workflow.integrations?.[integrationId]?.kind === 'mcp');

const validateWorkflowAgentNode = (
  set: EffectiveResourceSet,
  workflow: WorkflowDefinition,
  node: WorkflowNode,
  projectDirectory?: string,
): readonly ValidationFinding[] => {
  const actor = node.actor === undefined ? undefined : workflow.actors[node.actor];
  if (actor?.kind !== 'agent') {
    return hasAgentClosureAssertions(workflow, node)
      ? [workflowError(workflow.id, `node '${node.id}' has agent-closure assertions but no agent actor.`)]
      : [];
  }

  const composed = compose(set, actor.profile, { projectDirectory });
  if (composed.plan === undefined) {
    return composed.errors.map((message) =>
      workflowError(workflow.id, `node '${node.id}' agent '${actor.profile}': ${message}`),
    );
  }

  const availableSkills = new Set(composed.plan.loadout.skills.map((skill) => skill.slug));
  const availablePrompts = new Set(
    [
      composed.plan.identity.systemPromptFragment,
      composed.plan.identity.sharedContextFragment,
      .../* v8 ignore next -- compose normalizes this optional source field to an array. */
      (composed.plan.identity.appendSystemPrompts ?? []),
      composed.plan.identity.promptTemplate,
    ]
      .filter((fragment) => fragment?.reference !== undefined)
      .map((fragment) => fragment!.reference!),
  );
  return [
    ...missingClosureFindings(
      workflow.id,
      node.id,
      actor.profile,
      'skill',
      [...(actor.skills ?? []), ...nodeSkills(node)],
      availableSkills,
    ),
    ...missingClosureFindings(
      workflow.id,
      node.id,
      actor.profile,
      'prompt fragment',
      nodePrompts(node),
      availablePrompts,
    ),
    ...selectedMcpFindings(workflow, node, actor.profile, composed.plan.loadout.mcp),
  ];
};

const validateWorkflowActors = (
  set: EffectiveResourceSet,
  workflow: WorkflowDefinition,
): readonly ValidationFinding[] =>
  Object.entries(workflow.actors).flatMap(([actorId, actor]) =>
    actor.kind === 'agent' && findResource(set, 'agent', actor.profile) === undefined
      ? [workflowError(workflow.id, `actor '${actorId}' references unknown agent '${actor.profile}'.`)]
      : [],
  );

const optionalReferenceFinding = (
  workflowId: string,
  nodeId: string,
  kind: string,
  reference: string | undefined,
  known: (reference: string) => boolean,
): readonly ValidationFinding[] =>
  reference !== undefined && !known(reference)
    ? [workflowError(workflowId, `node '${nodeId}' references unknown ${kind} '${reference}'.`)]
    : [];

const unknownListFindings = (
  workflowId: string,
  nodeId: string,
  kind: string,
  references: readonly string[],
  known: (reference: string) => boolean,
): readonly ValidationFinding[] =>
  references
    .filter((reference) => !known(reference))
    .map((reference) => workflowError(workflowId, `node '${nodeId}' references unknown ${kind} '${reference}'.`));

const validateWorkflowNodeReferences = (
  workflow: WorkflowDefinition,
  node: WorkflowNode,
  nodeIds: ReadonlySet<string>,
  definitions: ReadonlyMap<string, WorkflowDefinition>,
): readonly ValidationFinding[] => {
  const needs = (node.needs ?? [])
    .filter((dependency) => !nodeIds.has(dependency))
    .map((dependency) => workflowError(workflow.id, `node '${node.id}' needs unknown node '${dependency}'.`));
  return [
    ...optionalReferenceFinding(
      workflow.id,
      node.id,
      'actor',
      node.actor,
      (actor) => workflow.actors[actor] !== undefined,
    ),
    ...optionalReferenceFinding(
      workflow.id,
      node.id,
      'environment',
      node.environment,
      (environment) => workflow.environments?.[environment] !== undefined,
    ),
    ...needs,
    ...unknownListFindings(
      workflow.id,
      node.id,
      'integration',
      node.uses ?? [],
      (integration) => workflow.integrations?.[integration] !== undefined,
    ),
    ...optionalReferenceFinding(workflow.id, node.id, 'workflow', node.workflow, (nested) => definitions.has(nested)),
  ];
};

const validateWorkflowArtifacts = (workflow: WorkflowDefinition): readonly ValidationFinding[] =>
  Object.entries(workflow.integrations ?? {}).flatMap(([id, artifact]) => {
    if (artifact.kind !== 'artifact') return [];
    const findings: ValidationFinding[] = [];
    if (!/^[0-9a-f]{40}$/.test(artifact.ref ?? ''))
      findings.push(workflowError(workflow.id, `artifact integration '${id}' must pin a full immutable Git commit.`));
    if (!/^[0-9a-f]{64}$/.test(artifact.sha256 ?? ''))
      findings.push(workflowError(workflow.id, `artifact integration '${id}' must declare a SHA-256 digest.`));
    if (artifact.repository === undefined || artifact.path === undefined)
      findings.push(workflowError(workflow.id, `artifact integration '${id}' must declare repository and path.`));
    return findings;
  });

const validateWorkflow = (
  set: EffectiveResourceSet,
  workflow: WorkflowDefinition,
  definitions: ReadonlyMap<string, WorkflowDefinition>,
  projectDirectory?: string,
): readonly ValidationFinding[] => {
  const findings: ValidationFinding[] = [];
  const nodeIds = new Set<string>();

  findings.push(...validateWorkflowActors(set, workflow));

  for (const node of workflow.nodes) {
    if (nodeIds.has(node.id)) findings.push(workflowError(workflow.id, `duplicate node id '${node.id}'.`));
    nodeIds.add(node.id);
  }

  for (const node of workflow.nodes) {
    findings.push(...validateWorkflowNodeReferences(workflow, node, nodeIds, definitions));
    findings.push(...validateWorkflowAgentNode(set, workflow, node, projectDirectory));
  }

  for (const edge of workflow.feedback ?? []) {
    if (!nodeIds.has(edge.from))
      findings.push(workflowError(workflow.id, `feedback references unknown source node '${edge.from}'.`));
    if (!nodeIds.has(edge.to))
      findings.push(workflowError(workflow.id, `feedback references unknown target node '${edge.to}'.`));
  }

  findings.push(...validateWorkflowArtifacts(workflow));

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
    const nested = definitions.get(slug)!.nodes.flatMap((node) => (node.workflow === undefined ? [] : [node.workflow]));
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
