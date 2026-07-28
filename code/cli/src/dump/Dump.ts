// Writes a deterministic, self-contained `.agents/` tree for one agent's transitive closure.
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import type { CompositionPlan } from '../composer/Composition.js';
import type { PromptFragment } from '../composer/PromptSource.js';
import { compose } from '../composer/Composer.js';
import { removeTargetTypeConflict } from '../fs/TypeConflict.js';
import { pickLoadoutKeys } from '../resolver/AgentDefinition.js';
import { compareSlugs, findResource } from '../resolver/Resource.js';
import type { EffectiveResourceSet, Layer, ResolvedResource } from '../resolver/Resource.js';
import { escapesRoots, overlaps } from './Containment.js';

export interface DumpResult {
  readonly writtenPaths: readonly string[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

// Tree-root files carried into the dump so loadout selections (mcp/models) are not dangling.
const rootFileNames = ['system-prompt.md', 'agents.md', 'mcp.json', 'models.json'] as const;

const layerRoots = (set: EffectiveResourceSet): readonly string[] => set.layers.map((layer) => layer.root);

/** Recursively copies a directory, skipping symlinked entries so no path escapes the tree. */
const copyResourceDirectory = (
  sourceDir: string,
  targetDir: string,
  written: string[],
  excludeNames: readonly string[] = [],
): void => {
  const entries = readdirSync(sourceDir, { withFileTypes: true }).sort((a, b) => compareSlugs(a.name, b.name));

  for (const entry of entries) {
    if (excludeNames.includes(entry.name)) {
      continue;
    }

    const sourcePath = join(sourceDir, entry.name);
    const targetPath = join(targetDir, entry.name);

    if (lstatSync(sourcePath).isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      removeTargetTypeConflict(targetPath, 'directory');
      copyResourceDirectory(sourcePath, targetPath, written);
    } else if (entry.isFile()) {
      removeTargetTypeConflict(targetPath, 'file');
      mkdirSync(dirname(targetPath), { recursive: true });
      copyFileSync(sourcePath, targetPath);
      written.push(targetPath);
    }
  }
};

/** Shallow-merges the effective per-agent config.json (loadout keys) across layers, highest wins. */
const mergeEffectiveConfig = (configPaths: readonly string[]): Record<string, unknown> => {
  let merged: Record<string, unknown> = {};

  for (const configPath of [...configPaths].reverse()) {
    const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as Record<string, unknown>;
    merged = { ...merged, ...pickLoadoutKeys(parsed) };
  }

  return merged;
};

// Copies the highest-precedence tree-root file, matching what the composer reads; escaping targets error.
const writeRootFiles = (set: EffectiveResourceSet, outRoot: string, written: string[]): readonly string[] => {
  const errors: string[] = [];
  const roots = layerRoots(set);

  for (const fileName of rootFileNames) {
    const source = set.layers.map((layer) => join(layer.root, fileName)).find((candidate) => existsSync(candidate));

    if (source === undefined) {
      continue;
    }

    if (escapesRoots(source, roots)) {
      errors.push(`root file '${fileName}' resolves outside the tree and cannot be safely dumped.`);
      continue;
    }

    const target = join(outRoot, fileName);
    writeFileSync(target, readFileSync(source, 'utf8'));
    written.push(target);
  }

  return errors;
};

interface PromptProvenance {
  readonly order: number;
  readonly role: 'system_prompt' | 'shared_context' | 'append_system_prompt' | 'agent_body';
  readonly kind: PromptFragment['kind'];
  readonly reference?: string;
  readonly declaringAgent?: string;
  readonly layer?: string;
  readonly trust: PromptFragment['trust'];
}

interface CompositionProvenance {
  readonly agent: string;
  readonly inheritanceChain: readonly string[];
  readonly prompts: readonly PromptProvenance[];
  readonly promptTemplate?: Omit<PromptProvenance, 'order' | 'role'>;
}

interface ClosureCompose {
  readonly agents: readonly ResolvedResource[];
  readonly skills: readonly ResolvedResource[];
  readonly promptFiles: readonly { readonly reference: string; readonly content: string }[];
  readonly provenance: readonly CompositionProvenance[];
  readonly warnings: readonly string[];
  readonly errors: readonly string[];
}

const collectContributingAgents = (
  set: EffectiveResourceSet,
  slugs: readonly string[],
  agents: ResolvedResource[],
): void => {
  const existing = new Set(agents.map((agent) => agent.slug));
  for (const slug of slugs) {
    const agent = findResource(set, 'agent', slug);
    if (agent !== undefined && !existing.has(slug)) {
      agents.push(agent);
      existing.add(slug);
    }
  }
};

const fragmentProvenance = (fragment: PromptFragment): Omit<PromptProvenance, 'order' | 'role'> => ({
  kind: fragment.kind,
  reference: fragment.reference,
  declaringAgent: fragment.declaringAgent,
  layer: fragment.layer?.label,
  trust: fragment.trust,
});

const compositionProvenance = (plan: CompositionPlan): CompositionProvenance => {
  const ordered: readonly { readonly role: PromptProvenance['role']; readonly fragment?: PromptFragment }[] = [
    { role: 'system_prompt', fragment: plan.identity.systemPromptFragment },
    { role: 'shared_context', fragment: plan.identity.sharedContextFragment },
    ...plan.identity.appendSystemPrompts!.map((fragment) => ({
      role: 'append_system_prompt' as const,
      fragment,
    })),
    ...plan.identity.agentBodies!.map((fragment) => ({ role: 'agent_body' as const, fragment })),
  ];

  return {
    agent: plan.agent,
    inheritanceChain: plan.inheritanceChain!,
    prompts: ordered
      .filter(
        (entry): entry is { readonly role: PromptProvenance['role']; readonly fragment: PromptFragment } =>
          entry.fragment !== undefined,
      )
      .map((entry, order) => ({ order, role: entry.role, ...fragmentProvenance(entry.fragment) })),
    promptTemplate:
      plan.identity.promptTemplate === undefined ? undefined : fragmentProvenance(plan.identity.promptTemplate),
  };
};

const collectPromptFiles = (plan: CompositionPlan, promptFiles: Map<string, string>, errors: string[]): void => {
  const fragments = [
    plan.identity.systemPromptFragment,
    plan.identity.promptTemplate,
    ...plan.identity.appendSystemPrompts!,
  ];
  for (const fragment of fragments) {
    if (fragment?.kind === 'file' && fragment.reference !== undefined) {
      const existing = promptFiles.get(fragment.reference);
      if (existing !== undefined && existing !== fragment.content) {
        errors.push(
          `dump closure resolves conflicting contents for prompt file '${fragment.reference}' and cannot flatten both.`,
        );
      } else {
        promptFiles.set(fragment.reference, fragment.content);
      }
    }
  }
};

const collectSkills = (
  selected: readonly ResolvedResource[],
  skills: Map<string, ResolvedResource>,
  errors: string[],
): void => {
  for (const skill of selected) {
    const existing = skills.get(skill.slug);
    if (existing !== undefined && existing.winner.path !== skill.winner.path) {
      errors.push(`dump closure resolves conflicting definitions for skill '${skill.slug}' and cannot flatten both.`);
    } else {
      skills.set(skill.slug, skill);
    }
  }
};

/** BFS over the selected agent and its delegated-agent closure. */
const composeClosure = (set: EffectiveResourceSet, rootSlug: string, projectDirectory?: string): ClosureCompose => {
  const seen = new Set<string>();
  const agents: ResolvedResource[] = [];
  const skills = new Map<string, ResolvedResource>();
  const warnings: string[] = [];
  const errors: string[] = [];
  const promptFiles = new Map<string, string>();
  const provenance: CompositionProvenance[] = [];
  const queue = [rootSlug];

  while (queue.length > 0) {
    const slug = queue.shift()!;

    if (seen.has(slug)) {
      continue;
    }
    seen.add(slug);

    // compose surfaces an unknown/invalid root agent as an error; every queued subagent is already
    // resolved by the composer, so a plan implies findResource returns the agent.
    const composed = compose(set, slug, { projectDirectory });

    if (composed.plan === undefined) {
      errors.push(...composed.errors);
      warnings.push(...composed.warnings);
      continue;
    }

    collectContributingAgents(set, composed.plan.inheritanceChain!, agents);
    provenance.push(compositionProvenance(composed.plan));
    warnings.push(...composed.plan.warnings);
    collectPromptFiles(composed.plan, promptFiles, errors);
    collectSkills(composed.plan.loadout.skills, skills, errors);
    queue.push(...composed.plan.loadout.subagents.map((subagent) => subagent.slug).sort(compareSlugs));
  }

  return {
    agents,
    skills: [...skills.values()].sort((left, right) => compareSlugs(left.slug, right.slug)),
    promptFiles: [...promptFiles.entries()]
      .map(([reference, content]) => ({ reference, content }))
      .sort((left, right) => compareSlugs(left.reference, right.reference)),
    provenance,
    warnings,
    errors,
  };
};

const closureResources = (closure: ClosureCompose): readonly ResolvedResource[] => [
  ...closure.agents,
  ...closure.skills,
];

// A defining file or its config that resolves outside every layer root cannot be safely dumped.
const containmentErrors = (resources: readonly ResolvedResource[], roots: readonly string[]): readonly string[] => {
  const errors: string[] = [];

  for (const resource of resources) {
    const files = [resource.winner.path, ...(resource.configPaths ?? []), ...(resource.piConfigDirectories ?? [])];
    if (files.some((file) => escapesRoots(file, roots))) {
      errors.push(`${resource.kind} '${resource.slug}' resolves outside the tree and cannot be safely dumped.`);
    }
  }

  return errors;
};

const overlapError = (outRoot: string, layers: readonly Layer[]): string | undefined => {
  const clash = layers.find((layer) => overlaps(outRoot, layer.root));
  return clash === undefined
    ? undefined
    : `dump output ${outRoot} overlaps source layer '${clash.label}'; choose an --out outside the tree.`;
};

const writeMergedConfig = (agent: ResolvedResource, agentTarget: string, written: string[]): void => {
  const mergedConfig = mergeEffectiveConfig(agent.configPaths!);

  if (Object.keys(mergedConfig).length > 0) {
    const configTarget = join(agentTarget, 'config.json');
    mkdirSync(agentTarget, { recursive: true });
    writeFileSync(configTarget, `${JSON.stringify(mergedConfig, null, 2)}\n`);
    written.push(configTarget);
  }
};

const failure = (errors: readonly string[], warnings: readonly string[] = []): DumpResult => ({
  writtenPaths: [],
  warnings,
  errors,
});

const promptTargetCollisions = (outRoot: string, prompts: ClosureCompose['promptFiles']): readonly string[] => {
  const errors: string[] = [];

  for (const prompt of prompts) {
    const target = join(outRoot, prompt.reference);
    if (!existsSync(target)) continue;

    const matches = lstatSync(target).isFile() && readFileSync(target, 'utf8') === prompt.content;
    if (!matches) {
      errors.push(`dump prompt file '${prompt.reference}' conflicts with another flattened file.`);
    }
  }

  return errors;
};

/** Writes the composed closure of `agentSlug` into a freshly cleaned `<outDirectory>/.agents/`. */
export const dumpAgent = (
  set: EffectiveResourceSet,
  agentSlug: string,
  outDirectory: string,
  projectDirectory?: string,
): DumpResult => {
  // composeClosure composes the root once and surfaces an unknown/invalid root agent as an error.
  const closure = composeClosure(set, agentSlug, projectDirectory);

  if (closure.errors.length > 0) {
    return failure(closure.errors, closure.warnings);
  }

  const roots = layerRoots(set);
  const safety = containmentErrors(closureResources(closure), roots);

  if (safety.length > 0) {
    return failure(safety, closure.warnings);
  }

  const outRoot = join(outDirectory, '.agents');
  const clash = overlapError(outRoot, set.layers);

  if (clash !== undefined) {
    return failure([clash], closure.warnings);
  }

  rmSync(outRoot, { recursive: true, force: true }); // clean destination so the dump is closure-scoped
  mkdirSync(outRoot, { recursive: true });
  const written: string[] = [];
  const rootErrors = writeRootFiles(set, outRoot, written);

  if (rootErrors.length > 0) {
    return failure(rootErrors, closure.warnings);
  }

  const provenanceTarget = join(outRoot, '.outfitter', 'composition.json');
  mkdirSync(dirname(provenanceTarget), { recursive: true });
  writeFileSync(provenanceTarget, `${JSON.stringify({ version: 1, compositions: closure.provenance }, null, 2)}\n`);
  written.push(provenanceTarget);

  for (const agent of closure.agents) {
    const agentTarget = join(outRoot, 'agents', agent.slug);
    // Local resources are flattened below so the dumped tree is directly consumable by harnesses.
    copyResourceDirectory(dirname(agent.winner.path), agentTarget, written, ['config.json', 'skills', 'pi']);
    writeMergedConfig(agent, agentTarget, written);
    // Overlay each layer's pi config into a single `pi/` dir, highest precedence last so it wins.
    for (const piConfigDirectory of [...agent.piConfigDirectories!].reverse()) {
      copyResourceDirectory(piConfigDirectory, join(agentTarget, 'pi'), written);
    }
  }

  for (const skill of closure.skills) {
    copyResourceDirectory(dirname(skill.winner.path), join(outRoot, 'skills', skill.slug), written);
  }

  const promptCollisions = promptTargetCollisions(outRoot, closure.promptFiles);
  if (promptCollisions.length > 0) {
    rmSync(outRoot, { recursive: true, force: true });
    return failure(promptCollisions, closure.warnings);
  }

  for (const prompt of closure.promptFiles) {
    const target = join(outRoot, prompt.reference);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, prompt.content);
    written.push(target);
  }

  return { writtenPaths: [...new Set(written)].sort(compareSlugs), warnings: closure.warnings, errors: [] };
};
