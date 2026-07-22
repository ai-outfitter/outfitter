// Parses `agents/<id>/agent.md` frontmatter and merges per-layer config.json loadout overrides.
import { readFileSync } from 'node:fs';

import { validateSchema } from '../validation/SchemaValidator.js';
import { parseYamlDocument } from '../validation/YamlDocument.js';
import type { Loadout } from './Resource.js';
import { emptyLoadout } from './Resource.js';

export interface AgentDefinition {
  readonly name: string;
  /** Human-readable profile name shown in interactive harness UI. */
  readonly label?: string;
  readonly description?: string;
  /** Markdown body after the frontmatter — the agent's identity prose. */
  readonly body: string;
  readonly loadout: Loadout;
}

export interface AgentDefinitionIssue {
  readonly path: string;
  readonly message: string;
}

export const isAgentDefinitionIssue = <T extends object>(
  value: T | AgentDefinitionIssue,
): value is AgentDefinitionIssue => 'message' in value;

/** Loadout fields a per-agent config.json may override; identity fields (`name`) are frontmatter-only. */
export const loadoutKeys = [
  'skills',
  'subagents',
  'mcp',
  'extensions',
  'plugins',
  'model',
  'thinking',
  'tools',
] as const;

/** Restricts an arbitrary record to the loadout keys config.json is allowed to supply. */
export const pickLoadoutKeys = (record: Readonly<Record<string, unknown>>): Record<string, unknown> =>
  Object.fromEntries(loadoutKeys.filter((key) => key in record).map((key) => [key, record[key]]));

interface FrontmatterSplit {
  readonly frontmatter: string;
  readonly body: string;
}

/** Splits leading `---` YAML frontmatter from the markdown body. */
export const splitFrontmatter = (content: string): FrontmatterSplit | undefined => {
  const lines = content.split('\n');

  if (lines[0]?.trimEnd() !== '---') {
    return undefined;
  }

  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trimEnd() === '---');

  if (closingIndex === -1) {
    return undefined;
  }

  return {
    frontmatter: lines.slice(1, closingIndex).join('\n'),
    body: lines
      .slice(closingIndex + 1)
      .join('\n')
      .replace(/^\n/, ''),
  };
};

const asStringArray = (value: unknown): readonly string[] =>
  Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];

const asString = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const readMarkdownHeading = (body: string): string | undefined => /^#\s+(.+)$/mu.exec(body)?.[1]?.trim();

const loadoutFromRecord = (record: Readonly<Record<string, unknown>>): Loadout => {
  const tools = record.tools as { readonly allow?: unknown; readonly deny?: unknown } | undefined;

  return {
    ...emptyLoadout(),
    skills: asStringArray(record.skills),
    subagents: asStringArray(record.subagents),
    mcp: asStringArray(record.mcp),
    extensions: asStringArray(record.extensions),
    plugins: asStringArray(record.plugins),
    model: asString(record.model),
    thinking: asString(record.thinking),
    tools: tools === undefined ? undefined : { allow: asStringArray(tools.allow), deny: asStringArray(tools.deny) },
  };
};

/** Reads one config.json, restricting it to loadout keys; parse/read/non-object failures are issues. */
const readConfigLoadout = (configPath: string): Readonly<Record<string, unknown>> | AgentDefinitionIssue => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    return { path: configPath, message: `config.json is not readable JSON: ${String(error)}` };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { path: configPath, message: 'config.json must be a JSON object of loadout overrides.' };
  }

  return pickLoadoutKeys(parsed as Record<string, unknown>);
};

const parseFrontmatterRecord = (
  content: string,
  agentPath: string,
): { readonly record: Record<string, unknown>; readonly body: string } | AgentDefinitionIssue => {
  const split = splitFrontmatter(content);

  if (split === undefined) {
    return { path: agentPath, message: 'agent.md must start with a `---` YAML frontmatter block.' };
  }

  const parsed = parseYamlDocument(split.frontmatter, agentPath);

  if (!parsed.ok) {
    return { path: agentPath, message: `agent.md frontmatter is not valid YAML: ${parsed.issue.message}` };
  }

  if (parsed.document === null || typeof parsed.document !== 'object' || Array.isArray(parsed.document)) {
    return { path: agentPath, message: 'agent.md frontmatter must be a YAML mapping.' };
  }

  // Validate the frontmatter on its own so config.json cannot supply required identity fields.
  const validation = validateSchema('agent', parsed.document);

  if (!validation.valid) {
    // An invalid document always yields at least one issue.
    return { path: agentPath, message: `agent.md is invalid: ${validation.issues[0].message}` };
  }

  return { record: parsed.document as Record<string, unknown>, body: split.body };
};

/**
 * Parses an agent definition. `configPaths` are highest-precedence first; each is a loadout-only
 * override that JSON-merges by key across layers over the frontmatter loadout.
 */
export const parseAgentDefinition = (
  content: string,
  configPaths: readonly string[],
  agentPath: string,
): AgentDefinition | AgentDefinitionIssue => {
  const frontmatter = parseFrontmatterRecord(content, agentPath);

  if (isAgentDefinitionIssue(frontmatter)) {
    return frontmatter;
  }

  let merged: Record<string, unknown> = { ...frontmatter.record };

  // Apply lowest precedence first so higher layers win per key.
  for (const configPath of [...configPaths].reverse()) {
    const config = readConfigLoadout(configPath);

    if (isAgentDefinitionIssue(config)) {
      return config;
    }

    merged = { ...merged, ...config };
  }

  return {
    name: frontmatter.record.name as string,
    label: asString(frontmatter.record.label)?.trim() || readMarkdownHeading(frontmatter.body),
    description: asString(frontmatter.record.description),
    body: frontmatter.body,
    loadout: loadoutFromRecord(merged),
  };
};

export const readAgentDefinition = (
  agentPath: string,
  configPaths: readonly string[] = [],
): AgentDefinition | AgentDefinitionIssue => {
  let content: string;

  try {
    content = readFileSync(agentPath, 'utf8');
  } catch (error) {
    return { path: agentPath, message: `Could not read agent.md: ${String(error)}` };
  }

  return parseAgentDefinition(content, configPaths, agentPath);
};
