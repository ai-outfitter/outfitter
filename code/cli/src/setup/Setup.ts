/* eslint-disable complexity */
// Harness-neutral setup state: applies the original profile-era setup outcomes to `.agents`.
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Harness } from '../settings/Settings.js';
import { HARNESSES } from '../settings/Settings.js';
import { defaultCatalogSource } from './DefaultCatalog.js';

export type SetupScope = 'home' | 'project';
export type SetupMode = 'default' | 'create' | 'catalog' | 'source';

export interface SetupAgentChoice {
  readonly id: string;
  readonly label: string;
  readonly description: string;
}

export interface SetupSelection {
  readonly setupMode: SetupMode;
  readonly agentId?: string;
  readonly agentLabel?: string;
  readonly github?: string;
  readonly ref?: string;
  readonly settingsPath?: string;
  readonly sourceUri?: string;
  readonly harness: Harness;
  readonly privateCatalogsEnabled?: boolean;
  readonly privateCatalogAccepted?: boolean;
  readonly target: SetupScope;
}

export interface SetupInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly selection: SetupSelection;
  readonly availableAgents: readonly SetupAgentChoice[];
  readonly defaultCatalogRoot?: string;
}

export interface SetupResult {
  readonly created: readonly string[];
  readonly updated: readonly string[];
  readonly settingsPath: string;
  readonly defaultAgent?: string;
  readonly defaultHarness: Harness;
  readonly messages: readonly string[];
}

const defaultAgentSlug = 'assistant';
const maxSlugLength = 64;
const agentSlugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export const sanitizeAgentSlug = (raw: string): string => {
  const slug = raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, maxSlugLength)
    .replace(/-+$/g, '');

  return agentSlugPattern.test(slug) ? slug : defaultAgentSlug;
};

const readFrontmatterValue = (content: string, key: string): string | undefined => {
  const match = new RegExp(`^${key}:\\s*([^\\n]+)`, 'mu').exec(content);
  // Strip only a real inline YAML comment (whitespace + '#'), so values like 'C#' survive.
  return match?.[1]
    ?.replace(/\s+#.*$/u, '')
    .trim()
    .replace(/^['"]|['"]$/gu, '');
};

const readMarkdownHeading = (content: string): string | undefined => /^#\s+(.+)$/mu.exec(content)?.[1]?.trim();

const discoverAgentsInCatalog = (root: string): readonly SetupAgentChoice[] => {
  const agentsDirectory = join(root, 'agents');
  if (!existsSync(agentsDirectory)) return [];

  let entries: readonly string[];
  try {
    entries = readdirSync(agentsDirectory).sort();
  } catch {
    return [];
  }

  const choices = entries.flatMap((entry): readonly SetupAgentChoice[] => {
    const agentPath = join(agentsDirectory, entry, 'agent.md');
    try {
      if (!statSync(agentPath).isFile()) return [];
      const content = readFileSync(agentPath, 'utf8');
      const id = sanitizeAgentSlug(readFrontmatterValue(content, 'name') ?? entry);
      if (id !== entry || !agentSlugPattern.test(id)) return [];
      return [
        {
          id,
          label: readFrontmatterValue(content, 'label') ?? readMarkdownHeading(content) ?? id,
          description: readFrontmatterValue(content, 'description') ?? 'Outfitter profile from the default catalog.',
        },
      ];
    } catch {
      return [];
    }
  });
  return choices.sort((left, right) => {
    if (left.id === 'founder') return -1;
    if (right.id === 'founder') return 1;
    return left.id.localeCompare(right.id);
  });
};

/** Returns the profiles shown by the original default-catalog setup picker. */
export const discoverSetupAgentChoices = (input: {
  readonly defaultCatalogRoot?: string;
}): readonly SetupAgentChoice[] => {
  if (input.defaultCatalogRoot === undefined) return [];
  return discoverAgentsInCatalog(input.defaultCatalogRoot);
};

const userProfileMarkdown = (slug: string, label: string): string =>
  `---\nname: "${slug}"\nlabel: "${label}"\ndescription: User-created Outfitter profile.\n---\n\n# ${label}\n\n` +
  'You are a helpful coding agent. Follow the instructions and skills available in this .agents tree.\n';

const replaceOrAppendScalar = (content: string, key: string, value: string): string => {
  const linePattern = new RegExp(`^${key}:.*$`, 'mu');
  if (linePattern.test(content)) return content.replace(linePattern, `${key}: ${value}`);
  return `${content.replace(/\s*$/u, '')}${content.trim() === '' ? '' : '\n'}${key}: ${value}\n`;
};

const upsertDefaultCatalogSource = (content: string): string => {
  const sourceLines = [`  - github: ${defaultCatalogSource.github}`, `    ref: ${defaultCatalogSource.ref}`];
  if (!/^sources:\s*$/mu.test(content)) {
    return `${content.replace(/\s*$/u, '')}\nsources:\n${sourceLines.join('\n')}\n`;
  }

  const lines = content.replace(/\s*$/u, '').split('\n');
  const start = lines.findIndex((line) => /^sources:\s*$/u.test(line));
  let end = start + 1;
  while (end < lines.length && (/^\s/u.test(lines[end] ?? '') || (lines[end] ?? '') === '')) end += 1;
  const existing = lines.findIndex((line, index) => {
    if (index <= start || index >= end) return false;
    const match = /^\s*-\s+github:\s*(.+?)\s*$/u.exec(line);
    return match?.[1]?.replace(/^['"]|['"]$/gu, '') === defaultCatalogSource.github;
  });

  if (existing === -1) {
    lines.splice(start + 1, 0, ...sourceLines);
    return `${lines.join('\n')}\n`;
  }

  let blockEnd = existing + 1;
  while (blockEnd < end && !/^\s*-\s+/u.test(lines[blockEnd] ?? '')) blockEnd += 1;
  const block = lines.slice(existing, blockEnd).filter((line) => !/^\s+path:\s*/u.test(line));
  const refIndex = block.findIndex((line) => /^\s+ref:\s*/u.test(line));
  if (refIndex === -1) block.splice(1, 0, `    ref: ${defaultCatalogSource.ref}`);
  else block[refIndex] = `    ref: ${defaultCatalogSource.ref}`;
  lines.splice(existing, blockEnd - existing, ...block);
  return `${lines.join('\n')}\n`;
};

const createSettingsContent = (existing: string, selection: SetupSelection): string => {
  if (selection.setupMode === 'source') {
    return [
      `default_harness: ${selection.harness}`,
      'remote_settings:',
      `  - uri: ${JSON.stringify(selection.sourceUri)}`,
      '    path: settings.yml',
      '',
    ].join('\n');
  }
  if (selection.setupMode === 'catalog') {
    return [
      ...(selection.privateCatalogsEnabled && selection.target === 'home'
        ? ['enterprise:', '  private_catalogs: true']
        : []),
      `default_harness: ${selection.harness}`,
      'remote_settings:',
      `  - github: ${selection.github}`,
      `    ref: ${selection.ref}`,
      `    path: ${selection.settingsPath}`,
      '',
    ].join('\n');
  }

  let content = replaceOrAppendScalar(existing, 'default_agent', String(selection.agentId));
  content = replaceOrAppendScalar(content, 'default_harness', selection.harness);
  return selection.setupMode === 'default' ? upsertDefaultCatalogSource(content) : content;
};

const enablePrivateCatalogs = (content: string): string => {
  if (/^\s*private_catalogs:\s*true\s*$/mu.test(content)) return content;
  if (/^\s*private_catalogs:\s*(?:true|false)\s*$/mu.test(content)) {
    return content.replace(/^\s*private_catalogs:\s*(?:true|false)\s*$/mu, '  private_catalogs: true');
  }
  if (/^enterprise:\s*$/mu.test(content)) {
    return content.replace(/^enterprise:\s*$/mu, 'enterprise:\n  private_catalogs: true');
  }
  return `${content.replace(/\s*$/u, '')}${content.trim() === '' ? '' : '\n'}enterprise:\n  private_catalogs: true\n`;
};

const atomicWrite = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.outfitter-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`;
  try {
    writeFileSync(temporaryPath, content, { flag: 'wx' });
    renameSync(temporaryPath, path);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
};

const assertSelection = (input: SetupInput): void => {
  const { selection } = input;
  if (!HARNESSES.includes(selection.harness)) {
    throw new Error(`Setup returned unsupported harness '${String(selection.harness)}'.`);
  }
  if (selection.setupMode === 'catalog') {
    if (!selection.github || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(selection.github)) {
      throw new Error('Setup returned an invalid catalog repository.');
    }
    if (
      !selection.ref ||
      !selection.settingsPath ||
      selection.settingsPath.startsWith('/') ||
      selection.settingsPath.includes('..')
    ) {
      throw new Error('Setup returned invalid catalog settings.');
    }
    return;
  }
  if (selection.setupMode === 'source') {
    if (!selection.sourceUri) throw new Error('Setup returned an invalid source URI.');
    return;
  }
  // Validate the exact id that gets written as the agent directory/frontmatter name — do not
  // normalize here, or an id that passes validation could still be written in a schema-invalid form.
  if (!selection.agentId || !agentSlugPattern.test(selection.agentId)) {
    throw new Error(`Setup returned invalid agent id '${selection.agentId}'.`);
  }
  if (selection.setupMode === 'default') {
    if (!input.availableAgents.some((candidate) => candidate.id === selection.agentId)) {
      throw new Error(`Setup selected unavailable agent '${selection.agentId}'.`);
    }
    if (input.defaultCatalogRoot === undefined)
      throw new Error('The default Outfitter profile catalog is unavailable.');
  }
};

/** Applies a UI selection without touching any existing agent resource. */
export const applySetupSelection = (input: SetupInput): SetupResult => {
  assertSelection(input);
  const targetRoot = input.selection.target === 'home' ? input.homeDirectory : input.projectDirectory;
  const settingsPath = join(targetRoot, '.agents', 'settings.yml');
  const created: string[] = [];
  const updated: string[] = [];
  let createdAgentPath: string | undefined;
  let privateHomeSettingsPath: string | undefined;
  let privateHomeSettingsExisted = false;
  let previousPrivateHomeSettings = '';

  if (input.selection.setupMode === 'create') {
    const agentPath = join(targetRoot, '.agents', 'agents', input.selection.agentId!, 'agent.md');
    if (!existsSync(agentPath)) {
      atomicWrite(
        agentPath,
        userProfileMarkdown(input.selection.agentId!, input.selection.agentLabel?.trim() || input.selection.agentId!),
      );
      created.push(agentPath);
      createdAgentPath = agentPath;
    }
  }

  try {
    if (
      input.selection.setupMode === 'catalog' &&
      input.selection.privateCatalogAccepted === true &&
      input.selection.target === 'project'
    ) {
      privateHomeSettingsPath = join(input.homeDirectory, '.agents', 'settings.yml');
      privateHomeSettingsExisted = existsSync(privateHomeSettingsPath);
      previousPrivateHomeSettings = privateHomeSettingsExisted ? readFileSync(privateHomeSettingsPath, 'utf8') : '';
      atomicWrite(privateHomeSettingsPath, enablePrivateCatalogs(previousPrivateHomeSettings));
      (privateHomeSettingsExisted ? updated : created).push(privateHomeSettingsPath);
    }
    const settingsExisted = existsSync(settingsPath);
    const existingSettings = settingsExisted ? readFileSync(settingsPath, 'utf8') : '';
    atomicWrite(settingsPath, createSettingsContent(existingSettings, input.selection));
    (settingsExisted ? updated : created).unshift(settingsPath);
  } catch (error) {
    if (createdAgentPath !== undefined) rmSync(createdAgentPath, { force: true });
    if (privateHomeSettingsPath !== undefined) {
      if (privateHomeSettingsExisted) atomicWrite(privateHomeSettingsPath, previousPrivateHomeSettings);
      else rmSync(privateHomeSettingsPath, { force: true });
    }
    throw error;
  }

  return {
    created,
    updated,
    settingsPath,
    defaultAgent: input.selection.agentId,
    defaultHarness: input.selection.harness,
    messages: [
      ...created.map((path) => `Created ${path}`),
      ...updated.map((path) => `Updated ${path}`),
      ...(input.selection.agentId === undefined
        ? []
        : [
            `Default agent '${input.selection.agentId}' will launch in ${input.selection.harness} on the next Outfitter run.`,
          ]),
    ],
  };
};
