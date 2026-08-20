// Materializes a CompositionPlan into a runtime configuration directory the harness launches from.
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

import type { ComposedSubagent, CompositionPlan } from '../composer/Composition.js';
import { escapesRoots } from '../dump/Containment.js';
import { removeTargetTypeConflict } from '../fs/TypeConflict.js';
import type { AgentDefinition } from '../resolver/AgentDefinition.js';
import { isAgentDefinitionIssue, readAgentDefinition } from '../resolver/AgentDefinition.js';
import type { ResolvedResource } from '../resolver/Resource.js';
import type { Harness } from '../settings/Settings.js';
import { effectiveToolAllowlist } from './Tools.js';

export interface MaterializedComposition {
  readonly rootDirectory: string;
  /** Absolute path to the composed system prompt written for the run. */
  readonly systemPromptPath: string;
  /** Absolute paths to append-prompt fragments, in composition order. */
  readonly appendPromptPaths: readonly string[];
  /** Absolute paths to materialized skill directories, in slug order. */
  readonly skillDirectories: readonly string[];
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

const serializeMcpConfig = (mcpServers: Readonly<Record<string, unknown>>): string =>
  `${JSON.stringify({ mcpServers }, null, 2)}\n`;

export const writeMcpConfig = (path: string, mcpServers: Readonly<Record<string, unknown>>): void => {
  writeGeneratedFile(path, serializeMcpConfig(mcpServers));
};

const safeName = (value: string): string => value.replace(/[^a-zA-Z0-9._-]+/g, '-');

/** Claude plugin names namespace the plugin's commands and subagents, so keep them slug-shaped. */
const pluginName = (profileSlug: string): string =>
  profileSlug
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'outfitter';

/**
 * Declares the runtime root as a Claude plugin so `--plugin-dir` loads the composition's skills,
 * subagents, and commands into a session that is otherwise the user's own. The manifest is the only
 * file the plugin loader requires; the generated prompt documents beside it are passed by path and
 * ignored here.
 */
export const writeClaudePluginManifest = (rootDirectory: string, profileSlug: string, label?: string): string => {
  const manifestDirectory = join(rootDirectory, '.claude-plugin');
  mkdirSync(manifestDirectory, { recursive: true });
  const name = pluginName(profileSlug);
  const manifest = {
    name,
    description: `Outfitter profile ${label ?? profileSlug}, composed for this run.`,
    version: '0.0.0',
  };
  const manifestPath = join(manifestDirectory, 'plugin.json');
  writeGeneratedFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  return name;
};

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

/** Adds Outfitter's quiet Pi startup default without overriding an explicit profile choice. */
export const applyPiRuntimeDefaults = (rootDirectory: string): void => {
  const settingsPath = join(rootDirectory, 'settings.json');
  if (!existsSync(settingsPath)) {
    writeGeneratedFile(settingsPath, `${JSON.stringify({ quietStartup: true }, null, 2)}\n`);
    return;
  }

  let settings: unknown;
  try {
    settings = JSON.parse(readFileSync(settingsPath, 'utf8')) as unknown;
  } catch {
    // Preserve invalid native configuration so Pi can report it through its normal diagnostics.
    return;
  }
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) return;
  if ('quietStartup' in settings) return;

  const temporaryPath = `${settingsPath}.outfitter-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`;
  try {
    writeFileSync(temporaryPath, `${JSON.stringify({ ...settings, quietStartup: true }, null, 2)}\n`, { flag: 'wx' });
    renameSync(temporaryPath, settingsPath);
  } finally {
    rmSync(temporaryPath, { force: true });
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
  harness: Harness,
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

  if (harness === 'claude' || (harness === 'pi' && composition.loadout.mcp.length > 0)) {
    writeMcpConfig(join(rootDirectory, 'mcp.json'), composition.loadout.mcpServers);
  }
  if (harness === 'pi' && composition.models?.configured) {
    writeGeneratedFile(join(rootDirectory, 'models.json'), `${JSON.stringify(composition.models.document, null, 2)}\n`);
  }
  return {
    rootDirectory,
    systemPromptPath,
    appendPromptPaths,
    skillDirectories,
    skippedSkills,
    skippedSubagents,
  };
};
