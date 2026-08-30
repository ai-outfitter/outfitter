// Validates an effective resource set: agent + skill definitions, unresolved loadout slugs, shadowing.
import { existsSync, globSync } from 'node:fs';
import { basename, dirname, isAbsolute, resolve } from 'node:path';

import { compose } from '../composer/Composer.js';
import { isInside, isLexicallyInside, realpathOrResolve } from '../dump/Containment.js';
import { isSkillDocumentIssue, readSkillDocument } from '../skills/SkillDocument.js';
import type {
  SkillDocument,
  SkillDocumentIssue,
  SkillMaterializationSection,
  SkillReference,
} from '../skills/SkillDocument.js';
import { skillMaterializationSections } from '../skills/SkillDocument.js';
import { isAgentDefinitionIssue, readAgentDefinition } from './AgentDefinition.js';
import type { AgentDefinitionIssue } from './AgentDefinition.js';
import { inspectReferenceTree } from './ReferenceTreeInspection.js';
import type { ReferenceTreeIssue } from './ReferenceTreeInspection.js';
import type { EffectiveResourceSet, ResolvedResource } from './Resource.js';
import { agentLocalKinds, findResource, listAgentResources, listResources, resourceLabel } from './Resource.js';

export interface ValidationFinding {
  readonly scope: 'agents';
  readonly phase: 'parse' | 'resolve' | 'author' | 'materialize';
  readonly code: ValidationFindingCode;
  readonly severity: 'error' | 'warning';
  readonly resource: string;
  readonly sourcePath: string;
  readonly message: string;
  readonly remediation: string;
}

export type ValidationFindingCode =
  | 'invalid-frontmatter'
  | 'invalid-name'
  | 'missing-description'
  | 'description-too-long'
  | 'description-not-actionable'
  | 'resource-invalid'
  | 'resource-unresolved'
  | 'inheritance-cycle'
  | 'reference-escaped'
  | 'reference-missing'
  | 'path-collision'
  | 'resource-shadowed'
  | 'namespace-reserved'
  | 'settings-invalid'
  | 'settings-warning';

type FindingInput = Omit<ValidationFinding, 'scope'>;

export const validationFinding = (input: FindingInput): ValidationFinding => ({ scope: 'agents', ...input });

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

// Agent and skill documents report the same authoring defects, so one map codes both.
const documentIssueCodes: Partial<
  Record<AgentDefinitionIssue['kind'] | SkillDocumentIssue['kind'], ValidationFindingCode>
> = {
  'invalid-name': 'invalid-name',
  frontmatter: 'invalid-frontmatter',
};

const documentIssueCode = (issue: AgentDefinitionIssue | SkillDocumentIssue): ValidationFindingCode =>
  documentIssueCodes[issue.kind] ?? 'resource-invalid';

const skillDocumentIssueRemediations: Record<SkillDocumentIssue['kind'], string> = {
  read: 'Make SKILL.md readable, then run validation again.',
  'invalid-name': 'Correct the SKILL.md name, then run validation again.',
  'invalid-references': 'Correct the SKILL.md references, then run validation again.',
  frontmatter: 'Correct the SKILL.md frontmatter, then run validation again.',
};

const validateAgent = (
  set: EffectiveResourceSet,
  agent: ResolvedResource,
  options: ValidationOptions,
  projectDirectory?: string,
): readonly ValidationFinding[] => {
  const definition = readAgentDefinition(agent.winner.path, agent.configPaths);

  if (isAgentDefinitionIssue(definition)) {
    return [
      validationFinding({
        phase: 'parse',
        code: documentIssueCode(definition),
        severity: 'error',
        resource: `agent:${agent.slug}`,
        sourcePath: definition.path,
        message: definition.message,
        remediation: 'Correct the agent frontmatter and configuration, then run validation again.',
      }),
    ];
  }

  if (definition.name !== agent.slug) {
    return [
      validationFinding({
        phase: 'parse',
        code: 'invalid-name',
        severity: 'error',
        resource: `agent:${agent.slug}`,
        sourcePath: agent.winner.path,
        message: `agent.md name '${definition.name}' must match its directory '${agent.slug}'.`,
        remediation: `Set the agent name to '${agent.slug}' or rename its directory.`,
      }),
    ];
  }

  const composed = compose(set, agent.slug, { projectDirectory });
  const compositionFindings: ValidationFinding[] = composed.diagnostics.map((diagnostic) =>
    validationFinding({
      phase: 'resolve',
      code: diagnostic.code,
      severity:
        diagnostic.severity === 'warning' &&
        diagnostic.deferInIsolatedSource === true &&
        !options.deferLoadoutResolution
          ? 'error'
          : diagnostic.severity,
      resource: `agent:${agent.slug}`,
      sourcePath: diagnostic.sourcePath ?? agent.winner.path,
      message: diagnostic.message,
      remediation:
        diagnostic.severity === 'error'
          ? 'Correct the referenced resource or inheritance declaration, then run validation again.'
          : 'Correct the referenced resource or remove the unresolved selection.',
    }),
  );

  return compositionFindings;
};

const skillDescriptionFindings = (
  skill: ResolvedResource,
  label: string,
  document: SkillDocument,
): readonly ValidationFinding[] => {
  const description = document.description;

  if (description === undefined || description.trim().length === 0) {
    return [
      validationFinding({
        phase: 'parse',
        code: 'missing-description',
        severity: 'error',
        resource: label,
        sourcePath: skill.winner.path,
        message: 'SKILL.md description must contain 1–1,024 characters.',
        remediation: 'Add a concise description that states what the skill does and when to use it.',
      }),
    ];
  }

  if ([...description].length > 1024) {
    return [
      validationFinding({
        phase: 'parse',
        code: 'description-too-long',
        severity: 'error',
        resource: label,
        sourcePath: skill.winner.path,
        message: `SKILL.md description contains ${[...description].length} characters; the maximum is 1,024.`,
        remediation: 'Shorten the description to 1,024 characters or fewer.',
      }),
    ];
  }

  // Keep this authoring check deliberately narrow. A short tautology is objectively unable to
  // provide both capability and selection guidance; broader natural-language judgments belong in
  // an advisory reviewer, not a strict deterministic gate.
  const words = description.trim().split(/\s+/u);
  if (words.length <= 3) {
    return [
      validationFinding({
        phase: 'author',
        code: 'description-not-actionable',
        severity: 'warning',
        resource: label,
        sourcePath: skill.winner.path,
        message: 'SKILL.md description is too short to identify when it applies.',
        remediation: 'Describe what the skill does and when to use it.',
      }),
    ];
  }

  return [];
};

const referenceValue = (reference: SkillReference): string =>
  'file' in reference ? reference.file : reference.repo_file;

const referenceRoot = (
  skill: ResolvedResource,
  reference: SkillReference,
  projectDirectory: string | undefined,
): string | undefined => ('file' in reference ? skill.winner.layer.root : projectDirectory);

const hasGlobSyntax = (value: string): boolean => /[*?[]/u.test(value);

interface SkillReferenceContext {
  readonly skill: ResolvedResource;
  readonly label: string;
  readonly section: SkillMaterializationSection;
  readonly projectDirectory?: string;
  readonly targets: Map<string, { readonly sourceLabel: string; readonly realPath: string }>;
  readonly visitedDirectories: Set<string>;
}

const materializationFinding = (
  context: SkillReferenceContext,
  code: Extract<
    ValidationFindingCode,
    'reference-escaped' | 'reference-missing' | 'path-collision' | 'resource-invalid'
  >,
  message: string,
  remediation: string,
): ValidationFinding =>
  validationFinding({
    phase: 'materialize',
    code,
    severity: 'error',
    resource: context.label,
    sourcePath: context.skill.winner.path,
    message,
    remediation,
  });

const pathCollisionFinding = (
  context: SkillReferenceContext,
  value: string,
  destinationName: string,
  existingSource: string | undefined,
): ValidationFinding =>
  materializationFinding(
    context,
    'path-collision',
    existingSource === undefined
      ? `SKILL.md '${context.section}' reference '${value}' collides with packaged path '${context.section}/${destinationName}'.`
      : `SKILL.md '${context.section}' references '${existingSource}' and '${value}' have the same destination '${context.section}/${destinationName}'.`,
    'Rename one source so every materialized target has a unique basename.',
  );

const referenceTreeIssueFinding = (
  context: SkillReferenceContext,
  declaredValue: string,
  issue: ReferenceTreeIssue,
): ValidationFinding => {
  if (issue.kind === 'escaped')
    return materializationFinding(
      context,
      'reference-escaped',
      `SKILL.md '${context.section}' reference '${declaredValue}' resolves outside its allowed root at '${issue.path}'.`,
      'Use a relative path inside the allowed root. Remove symlinks that resolve outside the root.',
    );
  if (issue.kind === 'special')
    return materializationFinding(
      context,
      'resource-invalid',
      `SKILL.md '${context.section}' reference '${declaredValue}' path '${issue.path}' is not a regular file or directory.`,
      'Use a regular file or directory, or remove the reference.',
    );
  if (issue.kind === 'directory-unreadable')
    return materializationFinding(
      context,
      'resource-invalid',
      `SKILL.md '${context.section}' reference '${declaredValue}' cannot read directory '${issue.path}'.`,
      'Make the directory readable or remove the reference.',
    );
  return materializationFinding(
    context,
    issue.kind === 'missing' ? 'reference-missing' : 'resource-invalid',
    `SKILL.md '${context.section}' reference '${declaredValue}' cannot access path '${issue.path}'.`,
    'Make the path readable or remove the reference.',
  );
};

const materializeReferenceTarget = (
  context: SkillReferenceContext,
  root: string,
  declaredValue: string,
  sourceLabel: string,
  target: string,
): readonly ValidationFinding[] => {
  const destinationName = basename(target);
  const realTarget = realpathOrResolve(target);
  const existing = context.targets.get(destinationName);
  if (existing?.realPath === realTarget) return [];

  const inspectionFindings = inspectReferenceTree(target, root, context.visitedDirectories).map((issue) =>
    referenceTreeIssueFinding(context, declaredValue, issue),
  );
  if (inspectionFindings.length > 0) return inspectionFindings;

  const shippedDestination = resolve(dirname(context.skill.winner.path), context.section, destinationName);
  const collidesWithShipped = existsSync(shippedDestination) && realpathOrResolve(shippedDestination) !== realTarget;
  if (existing !== undefined || collidesWithShipped) {
    return [pathCollisionFinding(context, sourceLabel, destinationName, existing?.sourceLabel)];
  }

  context.targets.set(destinationName, { sourceLabel, realPath: realTarget });
  return [];
};

/** Every path a reference selects: a glob's sorted matches, or the single declared target. */
const referenceMatches = (root: string, value: string, hasGlob: boolean, targetExists: boolean): readonly string[] => {
  if (hasGlob) {
    return globSync(value, { cwd: root })
      .map((match) => resolve(root, match))
      .sort();
  }
  return targetExists ? [resolve(root, value)] : [];
};

const validateSkillReference = (
  context: SkillReferenceContext,
  reference: SkillReference,
): readonly ValidationFinding[] => {
  const value = referenceValue(reference);
  if (value.length === 0) {
    return [
      materializationFinding(
        context,
        'resource-invalid',
        `SKILL.md '${context.section}' reference must not be empty.`,
        'Set the reference to a file or directory inside its allowed root.',
      ),
    ];
  }
  const root = referenceRoot(context.skill, reference, context.projectDirectory);
  // A `repo_file` reference outside a repository has no root to check it against.
  if (root === undefined) return [];

  const target = resolve(root, value);
  const targetExists = existsSync(target);
  if (isAbsolute(value) || !isLexicallyInside(target, root) || (targetExists && !isInside(target, root))) {
    return [
      materializationFinding(
        context,
        'reference-escaped',
        `SKILL.md '${context.section}' reference '${value}' resolves outside its allowed root.`,
        'Use a relative path inside the allowed root. Remove symlinks that resolve outside the root.',
      ),
    ];
  }

  const hasGlob = hasGlobSyntax(value);
  const matches = referenceMatches(root, value, hasGlob, targetExists);
  if (matches.length === 0) {
    return 'repo_file' in reference
      ? []
      : [
          materializationFinding(
            context,
            'reference-missing',
            `SKILL.md '${context.section}' file reference '${value}' does not exist.`,
            'Create the referenced path or remove the reference.',
          ),
        ];
  }

  return matches.flatMap((match) => materializeReferenceTarget(context, root, value, hasGlob ? match : value, match));
};

const validateSkillReferences = (
  skill: ResolvedResource,
  label: string,
  document: SkillDocument,
  projectDirectory?: string,
): readonly ValidationFinding[] =>
  skillMaterializationSections.flatMap((section) => {
    const context: SkillReferenceContext = {
      skill,
      label,
      section,
      projectDirectory,
      targets: new Map(),
      visitedDirectories: new Set(),
    };
    return document[section].flatMap((reference) => validateSkillReference(context, reference));
  });

const validateSkill = (skill: ResolvedResource, projectDirectory?: string): readonly ValidationFinding[] => {
  const document = readSkillDocument(skill.winner.path);
  const label = resourceLabel(skill);

  if (isSkillDocumentIssue(document)) {
    return [
      validationFinding({
        phase: 'parse',
        code: documentIssueCode(document),
        severity: 'error',
        resource: label,
        sourcePath: document.path,
        message: document.message,
        remediation: skillDocumentIssueRemediations[document.kind],
      }),
    ];
  }

  const nameFindings =
    document.name === skill.slug
      ? []
      : [
          validationFinding({
            phase: 'parse',
            code: 'invalid-name',
            severity: 'error',
            resource: label,
            sourcePath: skill.winner.path,
            message: `SKILL.md name '${document.name}' must match its directory '${skill.slug}'.`,
            remediation: `Set the skill name to '${skill.slug}' or rename its directory.`,
          }),
        ];

  return [
    ...nameFindings,
    ...skillDescriptionFindings(skill, label, document),
    ...validateSkillReferences(skill, label, document, projectDirectory),
  ];
};

const shadowFindings = (resource: ResolvedResource): readonly ValidationFinding[] =>
  resource.shadowed.map((definition) =>
    validationFinding({
      phase: 'resolve',
      code: 'resource-shadowed',
      severity: 'warning',
      resource: resourceLabel(resource),
      sourcePath: definition.path,
      message: `shadowed definition in ${definition.layer.label} is overridden by ${resource.winner.layer.label}.`,
      remediation: 'Remove the duplicate. If the override is intentional, run validation without --strict.',
    }),
  );

// Reserved agent-local resource shapes that resolver discovers but does not yet project into a run.
// Surfaced as warnings (fatal only under --strict) so content placed here is never silently dropped.
const reservedNamespaceFindings = (agent: ResolvedResource): readonly ValidationFinding[] => {
  const findings: ValidationFinding[] = [];

  if (agent.hookPaths !== undefined && agent.hookPaths.length > 0) {
    findings.push(
      validationFinding({
        phase: 'resolve',
        code: 'namespace-reserved',
        severity: 'warning',
        resource: `agent:${agent.slug}`,
        sourcePath: agent.hookPaths[0],
        message: "agent-local 'hooks/' is a reserved namespace and is not yet resolved.",
        remediation: "Remove the reserved 'hooks/' content until the namespace is supported.",
      }),
    );
  }

  return findings;
};

const deduplicateFindings = (findings: readonly ValidationFinding[]): readonly ValidationFinding[] => {
  const deduplicated = new Map<string, ValidationFinding>();
  for (const finding of findings) {
    const key = `${finding.code}\u0000${finding.resource}\u0000${finding.sourcePath}\u0000${finding.message}`;
    if (!deduplicated.has(key)) deduplicated.set(key, finding);
  }
  return [...deduplicated.values()];
};

// Validates one agent's local resources: the owning agent must resolve, and each local skill is
// document-checked; knowledge/commands are opaque file trees today, so only shadowing is surfaced.
const validateAgentLocalResources = (
  set: EffectiveResourceSet,
  agentSlug: string,
  projectDirectory?: string,
): readonly ValidationFinding[] => {
  const findings: ValidationFinding[] = [];

  if (findResource(set, 'agent', agentSlug) === undefined) {
    const localResource = [...agentLocalKinds].flatMap((kind) => listAgentResources(set, agentSlug, kind)).at(0);
    findings.push(
      validationFinding({
        phase: 'resolve',
        code: 'resource-unresolved',
        severity: 'error',
        resource: `agent:${agentSlug}`,
        sourcePath: localResource?.winner.path ?? `agents/${agentSlug}`,
        message: 'agent-local resources require a resolvable owning agent.',
        remediation: `Add a valid agents/${agentSlug}/agent.md or remove the orphaned local resources.`,
      }),
    );
  }

  for (const kind of agentLocalKinds) {
    for (const resource of listAgentResources(set, agentSlug, kind)) {
      findings.push(...shadowFindings(resource));
      if (kind === 'skill') findings.push(...validateSkill(resource, projectDirectory));
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
    findings.push(...validateSkill(skill, projectDirectory));
  }

  for (const [agentSlug] of set.agentResources) {
    findings.push(...validateAgentLocalResources(set, agentSlug, projectDirectory));
  }

  for (const kind of ['agent', 'skill', 'knowledge', 'command'] as const) {
    for (const resource of listResources(set, kind)) {
      findings.push(...shadowFindings(resource));
    }
  }

  return deduplicateFindings(findings);
};
