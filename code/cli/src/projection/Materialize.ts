// Materializes a CompositionPlan into a runtime configuration directory the harness launches from.
import { copyFileSync, lstatSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ComposedSubagent, CompositionPlan } from '../composer/Composition.js';
import { escapesRoots } from '../dump/Containment.js';
import { removeTargetTypeConflict } from '../fs/TypeConflict.js';
import type { AgentDefinition } from '../resolver/AgentDefinition.js';
import { isAgentDefinitionIssue, readAgentDefinition } from '../resolver/AgentDefinition.js';
import type { ResolvedResource } from '../resolver/Resource.js';
import { effectiveToolAllowlist } from './Tools.js';

export interface MaterializedComposition {
  readonly rootDirectory: string;
  /** Absolute path to the composed system prompt written for the run. */
  readonly systemPromptPath: string;
  /** Absolute paths to append-prompt fragments, in composition order. */
  readonly appendPromptPaths: readonly string[];
  /** Absolute paths to materialized skill directories, in slug order. */
  readonly skillDirectories: readonly string[];
  /** Absolute path to the generated isolated Claude MCP config. */
  readonly mcpConfigPath: string;
  /** Skills that could not be materialized safely (escaping symlinks). */
  readonly skippedSkills: readonly string[];
  /** Subagents whose merged agent definition could not be materialized. */
  readonly skippedSubagents: readonly string[];
}

/** Recursively copies a directory, skipping symlinked entries so no path escapes the tree. */
const copyDirectory = (sourceDir: string, targetDir: string): void => {
  removeTargetTypeConflict(targetDir, 'directory');
  mkdirSync(targetDir, { recursive: true });

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);

    if (lstatSync(sourcePath).isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      copyDirectory(sourcePath, join(targetDir, entry.name));
    } else if (entry.isFile()) {
      const targetPath = join(targetDir, entry.name);
      removeTargetTypeConflict(targetPath, 'file');
      copyFileSync(sourcePath, targetPath);
    }
  }
};

const writeGeneratedFile = (path: string, content: string): void => {
  removeTargetTypeConflict(path, 'file');
  writeFileSync(path, content);
};

const safeName = (value: string): string => value.replace(/[^a-zA-Z0-9._-]+/g, '-');

/**
 * Overlays native harness configuration into the runtime root. Inputs arrive highest precedence
 * first, so copying in reverse order lets higher layers replace matching files. Symlinked overlay
 * roots and entries are skipped so a catalog cannot make projection read outside its layer.
 */
export const materializeConfigurationOverlays = (sourceDirectories: readonly string[], rootDirectory: string): void => {
  mkdirSync(rootDirectory, { recursive: true });

  for (const sourceDirectory of [...sourceDirectories].reverse()) {
    if (lstatSync(sourceDirectory).isSymbolicLink()) continue;
    copyDirectory(sourceDirectory, rootDirectory);
  }
};

const materializeSkill = (skill: ResolvedResource, rootDirectory: string): string | undefined => {
  const sourceDir = dirname(skill.winner.path);

  // A skill whose directory resolves outside its layer cannot be materialized safely.
  if (escapesRoots(sourceDir, [skill.winner.layer.root])) {
    return undefined;
  }

  const targetDir = join(rootDirectory, 'skills', skill.slug);
  copyDirectory(sourceDir, targetDir);
  return targetDir;
};

const optionalScalar = (name: string, value: string | undefined): readonly string[] =>
  value === undefined ? [] : [`${name}: ${JSON.stringify(value)}`];

const optionalList = (name: string, values: readonly string[]): readonly string[] =>
  values.length === 0 ? [] : [`${name}: ${JSON.stringify(values.join(', '))}`];

const subagentEscapesRoots = (subagent: ResolvedResource): boolean => {
  const roots = [
    subagent.winner.layer.root,
    ...subagent.shadowed.map((definition) => definition.layer.root),
    ...(subagent.configLayerRoots ?? []),
  ];
  const paths = [subagent.winner.path, ...(subagent.configPaths ?? [])];
  return paths.some((path) => escapesRoots(path, roots));
};

const readValidSubagentDefinition = (subagent: ResolvedResource): AgentDefinition | undefined => {
  if (subagentEscapesRoots(subagent)) {
    return undefined;
  }

  const definition = readAgentDefinition(subagent.winner.path, subagent.configPaths);

  return isAgentDefinitionIssue(definition) || definition.name !== subagent.slug ? undefined : definition;
};

const serializeSubagent = (subagent: ResolvedResource): string | undefined => {
  const definition = readValidSubagentDefinition(subagent);

  if (definition === undefined) return undefined;

  const tools = effectiveToolAllowlist(definition.loadout.tools);
  const frontmatter = [
    `name: ${JSON.stringify(subagent.slug)}`,
    `description: ${JSON.stringify(definition.description ?? definition.label ?? `Delegated ${subagent.slug} agent.`)}`,
    ...optionalScalar('model', definition.loadout.model),
    ...optionalScalar('thinking', definition.loadout.thinking),
    ...optionalList('tools', tools ?? []),
    ...optionalList('skills', definition.loadout.skills),
    ...optionalList('extensions', definition.loadout.extensions),
  ];

  return `---\n${frontmatter.join('\n')}\n---\n\n${definition.body}`;
};

const composedSubagentBody = (subagent: ComposedSubagent): string =>
  [
    subagent.identity.systemPrompt,
    subagent.identity.sharedContext,
    ...subagent.identity.appendSystemPrompts.map((fragment) => fragment.content),
    ...subagent.identity.agentBodies.map((fragment) => fragment.content),
  ]
    .filter((fragment): fragment is string => fragment !== undefined && fragment.length > 0)
    .join('\n\n');

const serializeComposedSubagent = (subagent: ComposedSubagent): string => {
  const tools = effectiveToolAllowlist(subagent.tools);
  const description = subagent.identity.description ?? subagent.identity.label;
  const frontmatter = [
    `name: ${JSON.stringify(subagent.resource.slug)}`,
    `description: ${JSON.stringify(description ?? `Delegated ${subagent.resource.slug} agent.`)}`,
    ...optionalScalar('model', subagent.model),
    ...optionalScalar('thinking', subagent.thinking),
    ...optionalList('tools', tools ?? []),
    ...optionalList(
      'skills',
      subagent.skills.map((skill) => skill.slug),
    ),
    ...optionalList('extensions', subagent.extensions),
  ];

  return `---\n${frontmatter.join('\n')}\n---\n\n${composedSubagentBody(subagent)}`;
};

const materializeSubagents = (
  subagents: readonly ResolvedResource[],
  composedSubagents: readonly ComposedSubagent[] | undefined,
  rootDirectory: string,
): readonly string[] => {
  if (subagents.length === 0) {
    return [];
  }

  const agentsDirectory = join(rootDirectory, 'agents');
  rmSync(agentsDirectory, { recursive: true, force: true });
  mkdirSync(agentsDirectory, { recursive: true });
  const skipped: string[] = [];
  const composedBySlug = new Map<string, ComposedSubagent>(
    (composedSubagents ?? []).map((subagent) => [subagent.resource.slug, subagent]),
  );

  for (const subagent of subagents) {
    const composed = composedBySlug.get(subagent.slug);
    const content = composed === undefined ? serializeSubagent(subagent) : serializeComposedSubagent(composed);
    if (content === undefined) {
      skipped.push(subagent.slug);
    } else {
      writeGeneratedFile(join(agentsDirectory, `${subagent.slug}.md`), content);
    }
  }

  return skipped;
};

const materializeIdentity = (
  composition: CompositionPlan,
  rootDirectory: string,
): { readonly systemPromptPath: string; readonly appendPromptPaths: readonly string[] } => {
  const systemPromptPath = join(rootDirectory, 'system-prompt.md');
  writeGeneratedFile(systemPromptPath, composition.identity.systemPrompt ?? '');
  const appendPromptPaths: string[] = [];

  if (composition.identity.sharedContext !== undefined) {
    const contextPath = join(rootDirectory, 'agents.md');
    writeGeneratedFile(contextPath, composition.identity.sharedContext);
    appendPromptPaths.push(contextPath);
  }
  (composition.identity.appendSystemPrompts ?? []).forEach((fragment, index) => {
    const name = `append-${String(index + 1).padStart(2, '0')}-${safeName(fragment.label)}.md`;
    writeGeneratedFile(join(rootDirectory, name), fragment.content);
    appendPromptPaths.push(join(rootDirectory, name));
  });

  const bodies = composition.identity.agentBodies ?? [];
  if (bodies.length <= 1) {
    const path = join(rootDirectory, 'agent.md');
    writeGeneratedFile(path, bodies[0]?.content ?? composition.identity.agentBody);
    appendPromptPaths.push(path);
  } else {
    bodies.forEach((fragment, index) => {
      const name = `${String(index + 1).padStart(2, '0')}-${safeName(fragment.label)}.md`;
      writeGeneratedFile(join(rootDirectory, name), fragment.content);
      appendPromptPaths.push(join(rootDirectory, name));
    });
  }

  if (composition.identity.promptTemplate !== undefined) {
    writeGeneratedFile(join(rootDirectory, 'prompt-template.md'), composition.identity.promptTemplate.content);
  }
  return { systemPromptPath, appendPromptPaths };
};

/** Writes composed identity, skills, subagents, and selected MCP servers into the runtime root. */
export const materializeComposition = (
  composition: CompositionPlan,
  rootDirectory: string,
): MaterializedComposition => {
  mkdirSync(rootDirectory, { recursive: true });
  const { systemPromptPath, appendPromptPaths } = materializeIdentity(composition, rootDirectory);
  const skillDirectories: string[] = [];
  const skippedSkills: string[] = [];

  for (const skill of [...composition.loadout.skills, ...composition.loadout.delegateSkills]) {
    const materialized = materializeSkill(skill, rootDirectory);
    if (materialized === undefined) {
      skippedSkills.push(skill.slug);
    } else {
      skillDirectories.push(materialized);
    }
  }

  const skippedSubagents = materializeSubagents(
    composition.loadout.subagents,
    composition.loadout.composedSubagents,
    rootDirectory,
  );

  const serializedMcp = `${JSON.stringify({ mcpServers: composition.loadout.mcpServers }, null, 2)}\n`;
  if (composition.loadout.mcp.length > 0) {
    writeGeneratedFile(join(rootDirectory, 'mcp.json'), serializedMcp);
  }
  const mcpConfigPath = join(rootDirectory, 'claude-mcp.json');
  writeGeneratedFile(mcpConfigPath, serializedMcp);

  return {
    rootDirectory,
    systemPromptPath,
    appendPromptPaths,
    skillDirectories,
    mcpConfigPath,
    skippedSkills,
    skippedSubagents,
  };
};
