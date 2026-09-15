// Materializes a CompositionPlan into a runtime configuration directory the harness launches from.
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join } from 'node:path';

import type { ComposedIdentity, ComposedSubagent, CompositionPlan } from '../composer/Composition.js';
import { escapesRoots, isInside } from '../dump/Containment.js';
import { removeTargetTypeConflict } from '../fs/TypeConflict.js';
import type { AgentDefinition } from '../resolver/AgentDefinition.js';
import { isAgentDefinitionIssue, readAgentDefinition } from '../resolver/AgentDefinition.js';
import type { Loadout, ResolvedResource } from '../resolver/Resource.js';
import type { Harness, HarnessDefaultSettings } from '../settings/Settings.js';
import { mergeObjectsWithPolicy } from '../merge/SettingsValueMerger.js';
import { effectiveToolAllowlist } from './Tools.js';
import { copyOverlayFile, type OverlayCopyOptions } from './OverlayJsonMerge.js';

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

/**
 * Recursively copies a directory, skipping symlinked entries so no path escapes the tree, and
 * returns the root-relative POSIX paths of every regular file it wrote. File writes go through
 * copyOverlayFile, whose JSON deep-merge activates only when a warnings sink and the lower tiers'
 * written-path set are passed — skill materialization keeps plain whole-file copy semantics.
 */
const copyDirectory = (sourceDir: string, targetDir: string, options: OverlayCopyOptions = {}): readonly string[] => {
  removeTargetTypeConflict(targetDir, 'directory');
  mkdirSync(targetDir, { recursive: true });
  const written: string[] = [];

  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const sourcePath = join(sourceDir, entry.name);

    if (lstatSync(sourcePath).isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      const nestedTargetDirectory = join(targetDir, entry.name);
      for (const relativePath of copyDirectory(sourcePath, nestedTargetDirectory, options)) {
        written.push(`${entry.name}/${relativePath}`);
      }
    } else if (entry.isFile()) {
      copyOverlayFile(sourcePath, join(targetDir, entry.name), entry.name, options);
      written.push(entry.name);
    }
  }
  return written;
};

const writeGeneratedFile = (path: string, content: string): void => {
  removeTargetTypeConflict(path, 'file');
  writeFileSync(path, content);
};

const serializeMcpConfig = (mcpServers: Readonly<Record<string, unknown>>): string =>
  `${JSON.stringify({ mcpServers }, null, 2)}\n`;

/**
 * The subagent materialization's rebuild manifest: its own record of the agent definition files it
 * generated into one runtime root. A later rebuild removes only manifest-tracked regular files that
 * stay inside the root, so `agents/` content from the pi/ overlay or any other delivery mechanism
 * (nothing else ever writes the manifest) is foreign and survives every rebuild. Entries are root-
 * relative POSIX paths and nothing else is recorded, so the manifest is deterministic across runs.
 */
interface SubagentManifest {
  readonly version: number;
  readonly files: readonly string[];
}

const subagentManifestPath = (rootDirectory: string): string => join(rootDirectory, '.outfitter', 'subagents.json');

const parseSubagentManifest = (raw: string): readonly string[] | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
  const { version, files } = parsed as Record<string, unknown>;
  if (version !== 1) return undefined;
  if (!Array.isArray(files) || !files.every((entry): entry is string => typeof entry === 'string')) return undefined;
  return files;
};

/** Returns the previously generated relative paths, or undefined when no usable manifest exists. */
const readGeneratedSubagentPaths = (rootDirectory: string): readonly string[] | undefined => {
  let raw: string;
  try {
    raw = readFileSync(subagentManifestPath(rootDirectory), 'utf8');
  } catch {
    return undefined;
  }
  return parseSubagentManifest(raw);
};

const writeSubagentManifest = (rootDirectory: string, files: readonly string[]): void => {
  mkdirSync(dirname(subagentManifestPath(rootDirectory)), { recursive: true });
  const manifest: SubagentManifest = { version: 1, files: [...files].sort() };
  writeGeneratedFile(subagentManifestPath(rootDirectory), `${JSON.stringify(manifest, null, 2)}\n`);
};

/** Resolves one manifest entry to an absolute path inside the root, or undefined when unusable. */
const containedManifestEntry = (rootDirectory: string, entry: string): string | undefined => {
  if (isAbsolute(entry)) return undefined;
  const segments = entry.split('/');
  if (segments.some((segment) => segment === '' || segment === '.' || segment === '..')) return undefined;
  const absolutePath = join(rootDirectory, ...segments);
  // Realpath-aware containment: a tracked path that has become a link out of the root is unusable.
  return isInside(absolutePath, rootDirectory) ? absolutePath : undefined;
};

const removeStaleGeneratedSubagents = (rootDirectory: string): void => {
  const previous = readGeneratedSubagentPaths(rootDirectory);
  if (previous === undefined) return;

  for (const entry of previous) {
    const path = containedManifestEntry(rootDirectory, entry);
    // Only regular files are removal candidates: never a symlink (lstat does not follow links),
    // never a directory, never anything outside the root.
    if (path !== undefined && lstatSync(path, { throwIfNoEntry: false })?.isFile()) {
      rmSync(path, { force: true });
    }
  }
};

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
 * first, so applying in reverse order lets higher layers replace matching files. A same-relative-
 * path JSON object document that a lower tier of this call wrote deep-merges with the incoming
 * layer instead — lower layers first, higher layer's values winning — while pre-existing root
 * content (generated defaults, retained-root files) and every non-JSON file replace whole-file. A
 * warnings sink both enables the merge behavior and receives a diagnostic when a higher-precedence
 * JSON file cannot be read as JSON. Symlinked overlay roots and entries are skipped so a catalog
 * cannot make projection read outside its layer.
 */
export const materializeConfigurationOverlays = (
  sourceDirectories: readonly string[],
  rootDirectory: string,
  options: OverlayCopyOptions = {},
): void => {
  mkdirSync(rootDirectory, { recursive: true });
  const lowerTierPaths = new Set<string>();

  for (const sourceDirectory of [...sourceDirectories].reverse()) {
    if (lstatSync(sourceDirectory).isSymbolicLink()) continue;
    for (const relativePath of copyDirectory(sourceDirectory, rootDirectory, {
      warnings: options.warnings,
      mergeablePaths: lowerTierPaths,
    })) {
      lowerTierPaths.add(relativePath);
    }
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

/**
 * Writes generated extension configuration files as the lowest tier of runtime-file precedence:
 * materialization runs before overlay materialization, so a per-agent pi/ overlay or a
 * settings-layer pi_overlay file replaces a same-named generated file wholesale. Keys are
 * validated to safe file-name characters at the settings read boundary.
 */
export const applyExtensionConfigDefaults = (
  rootDirectory: string,
  configs: Readonly<Record<string, unknown>> | undefined,
): void => {
  if (configs === undefined) return;
  for (const [name, config] of Object.entries(configs)) {
    const targetPath = join(rootDirectory, 'extensions', `${name}.json`);
    mkdirSync(dirname(targetPath), { recursive: true });
    writeGeneratedFile(targetPath, `${JSON.stringify(config, null, 2)}\n`);
  }
};

/** Reads the generated settings.json when it is a mergeable JSON object document, else undefined. */
const readMergeableSettingsDocument = (settingsPath: string): Record<string, unknown> | undefined => {
  let existing: unknown;
  try {
    existing = JSON.parse(readFileSync(settingsPath, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
  if (typeof existing !== 'object' || existing === null || Array.isArray(existing)) return undefined;
  return existing as Record<string, unknown>;
};

/** Returns the document's existing extension paths, or undefined when the key is not a string array. */
const declaredExtensionEntries = (document: Record<string, unknown>): readonly string[] | undefined => {
  const declared = document.extensions;
  if (declared === undefined) return [];
  if (!Array.isArray(declared)) return undefined;
  return declared.every((entry): entry is string => typeof entry === 'string') ? declared : undefined;
};

/** Deduplicates paths by exact string, keeping the first occurrence's position. */
const dedupeEntries = (paths: readonly (readonly string[])[]): readonly string[] => {
  const merged: string[] = [];
  for (const entry of paths.flat()) {
    if (!merged.includes(entry)) merged.push(entry);
  }
  return merged;
};

/**
 * Merges cached npm extension entry-file paths into the generated pi settings.json `extensions`
 * array — the inheritance surface fresh loaders (pi-subagents child sessions, SDK sessions) build
 * from the agent dir. Entries already in the file (overlay- or harness-default-delivered) keep their
 * order and the npm entries follow in declared loadout order, deduped by exact string with first
 * occurrence winning. An unparseable or non-object document is left untouched so pi reports it
 * through its own diagnostics, matching applyPiRuntimeDefaults' invalid-settings policy.
 */
export const applyPiExtensionSettingsEntries = (
  rootDirectory: string,
  entries: readonly string[] | undefined,
): void => {
  if (entries === undefined || entries.length === 0) return;
  const settingsPath = join(rootDirectory, 'settings.json');
  if (!existsSync(settingsPath)) {
    writeGeneratedFile(settingsPath, `${JSON.stringify({ extensions: [...entries] }, null, 2)}\n`);
    return;
  }
  const document = readMergeableSettingsDocument(settingsPath);
  if (document === undefined) return;
  const declared = declaredExtensionEntries(document);
  if (declared === undefined) return;
  const merged = dedupeEntries([declared, entries]);
  writeGeneratedFile(settingsPath, `${JSON.stringify({ ...document, extensions: merged }, null, 2)}\n`);
};

/** Returns the document's existing package roots, or undefined when the key is not a string array. */
const declaredPackageEntries = (document: Record<string, unknown>): readonly string[] | undefined => {
  const declared = document.packages;
  if (declared === undefined) return [];
  if (!Array.isArray(declared)) return undefined;
  return declared.every((entry): entry is string => typeof entry === 'string') ? declared : undefined;
};

/**
 * Merges the served pi extension load directories into the generated pi settings.json `packages`
 * array — pi resolves a local-path packages entry through its own package rules, so fresh loaders
 * (pi-subagents child sessions, SDK sessions) inherit package-declared themes, skills, prompt
 * templates, and extensions with the same semantics the main session gets from `--extension <dir>`.
 * Outfitter projects package roots only (existence verified by the serving flow) and delegates
 * manifest parsing, glob expansion, and override patterns to pi, so both sessions can never
 * disagree about what a package contains. Entries already in the file (overlay- or
 * harness-default-delivered) keep their order; generated entries follow in declared loadout order,
 * deduped by exact string with first occurrence winning. An unparseable or non-object document —
 * or a non-array `packages` value — is left untouched so pi reports it through its own
 * diagnostics, matching applyPiExtensionSettingsEntries' invalid-settings policy.
 */
export const applyPiPackageSettingsEntries = (
  rootDirectory: string,
  packageDirs: readonly string[] | undefined,
): void => {
  if (packageDirs === undefined || packageDirs.length === 0) return;
  const settingsPath = join(rootDirectory, 'settings.json');
  if (!existsSync(settingsPath)) {
    writeGeneratedFile(settingsPath, `${JSON.stringify({ packages: [...packageDirs] }, null, 2)}\n`);
    return;
  }
  const document = readMergeableSettingsDocument(settingsPath);
  if (document === undefined) return;
  const declared = declaredPackageEntries(document);
  if (declared === undefined) return;
  const merged = dedupeEntries([declared, packageDirs]);
  writeGeneratedFile(settingsPath, `${JSON.stringify({ ...document, packages: merged }, null, 2)}\n`);
};

/** Merges catalog defaults below an existing native JSON settings document. */
export const applyJsonSettingsDefaults = (
  rootDirectory: string,
  defaults: HarnessDefaultSettings | undefined,
): string | undefined => {
  if (defaults === undefined || Object.keys(defaults).length === 0) return undefined;
  const settingsPath = join(rootDirectory, 'settings.json');
  if (!existsSync(settingsPath)) {
    writeGeneratedFile(settingsPath, `${JSON.stringify(defaults, null, 2)}\n`);
    return settingsPath;
  }

  let existing: unknown;
  try {
    existing = JSON.parse(readFileSync(settingsPath, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
  if (existing === null || typeof existing !== 'object' || Array.isArray(existing)) return undefined;
  const merged = mergeObjectsWithPolicy(defaults, existing as Record<string, unknown>);
  writeGeneratedFile(settingsPath, `${JSON.stringify(merged, null, 2)}\n`);
  return settingsPath;
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

/** Harness-neutral inputs for one native Claude agent definition document. */
export interface ClaudeAgentDocumentInput {
  readonly slug: string;
  readonly description?: string;
  readonly model?: string;
  readonly thinking?: string;
  readonly tools?: Loadout['tools'];
  readonly skills: readonly string[];
  readonly extensions: readonly string[];
  readonly body: string;
}

/** Serializes frontmatter plus body in the shape Claude Code reads from its `agents/` directory. */
export const serializeClaudeAgentDocument = (input: ClaudeAgentDocumentInput): string => {
  const tools = effectiveToolAllowlist(input.tools);
  const frontmatter = [
    `name: ${JSON.stringify(input.slug)}`,
    `description: ${JSON.stringify(input.description ?? `Delegated ${input.slug} agent.`)}`,
    ...optionalScalar('model', input.model),
    ...optionalScalar('thinking', input.thinking),
    ...optionalList('tools', tools ?? []),
    ...optionalList('skills', input.skills),
    ...optionalList('extensions', input.extensions),
  ];

  return `---\n${frontmatter.join('\n')}\n---\n\n${input.body}`;
};

/** Joins the composed identity parts in composition order, dropping empty fragments. */
export const composedIdentityBody = (identity: ComposedIdentity): string =>
  [
    identity.systemPrompt,
    identity.sharedContext,
    ...(identity.appendSystemPrompts ?? []).map((fragment) => fragment.content),
    ...(identity.agentBodies ?? []).map((fragment) => fragment.content),
  ]
    .filter((fragment): fragment is string => fragment !== undefined && fragment.length > 0)
    .join('\n\n');

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

  return serializeClaudeAgentDocument({
    slug: subagent.slug,
    description: definition.description ?? definition.label,
    model: definition.loadout.model,
    thinking: definition.loadout.thinking,
    tools: definition.loadout.tools,
    skills: definition.loadout.skills,
    extensions: definition.loadout.extensions,
    body: definition.body,
  });
};

const serializeComposedSubagent = (subagent: ComposedSubagent): string =>
  serializeClaudeAgentDocument({
    slug: subagent.resource.slug,
    description: subagent.identity.description ?? subagent.identity.label,
    model: subagent.model,
    thinking: subagent.thinking,
    tools: subagent.tools,
    skills: subagent.skills.map((skill) => skill.slug),
    extensions: subagent.extensions,
    body: composedIdentityBody(subagent.identity),
  });

const materializeSubagents = (
  subagents: readonly ResolvedResource[],
  composedSubagents: readonly ComposedSubagent[] | undefined,
  rootDirectory: string,
): readonly string[] => {
  removeStaleGeneratedSubagents(rootDirectory);

  const agentsDirectory = join(rootDirectory, 'agents');
  mkdirSync(agentsDirectory, { recursive: true });
  const skipped: string[] = [];
  const generated: string[] = [];
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
      generated.push(`agents/${subagent.slug}.md`);
    }
  }

  // Record this run's generated files, or retire the manifest when nothing is generated so a
  // retained root never advertises ownership it no longer has.
  if (generated.length > 0) writeSubagentManifest(rootDirectory, generated);
  else rmSync(subagentManifestPath(rootDirectory), { force: true });

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
