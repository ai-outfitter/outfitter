// Parses `agents/<id>/agent.md` frontmatter (plus optional config.json) into an agent identity + loadout.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { validateSchema } from '../validation/SchemaValidator.js';
import { parseYamlDocument } from '../validation/YamlDocument.js';
import type { Loadout } from './Resource.js';
import { emptyLoadout } from './Resource.js';

export interface AgentDefinition {
  readonly name: string;
  readonly description?: string;
  /** Markdown body after the frontmatter — the agent's identity prose. */
  readonly body: string;
  readonly loadout: Loadout;
}

export interface AgentDefinitionIssue {
  readonly path: string;
  readonly message: string;
}

export const isAgentDefinitionIssue = (value: AgentDefinition | AgentDefinitionIssue): value is AgentDefinitionIssue =>
  'message' in value;

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

/** Reads the optional per-agent `config.json` loadout overrides beside `agent.md`. */
const readConfigOverrides = (agentDirectory: string): Readonly<Record<string, unknown>> => {
  const configPath = join(agentDirectory, 'config.json');

  if (!existsSync(configPath)) {
    return {};
  }

  const parsed = JSON.parse(readFileSync(configPath, 'utf8')) as unknown;
  return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)
    ? (parsed as Readonly<Record<string, unknown>>)
    : {};
};

export const parseAgentDefinition = (
  content: string,
  agentDirectory: string,
  agentPath: string,
): AgentDefinition | AgentDefinitionIssue => {
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

  // config.json shallow-merges by key over the frontmatter loadout.
  const record = { ...(parsed.document as Record<string, unknown>), ...readConfigOverrides(agentDirectory) };
  const validation = validateSchema('agent', record);

  if (!validation.valid) {
    return { path: agentPath, message: `agent.md is invalid: ${validation.issues[0]?.message ?? 'schema error'}` };
  }

  return {
    name: record.name as string,
    description: asString(record.description),
    body: split.body,
    loadout: loadoutFromRecord(record),
  };
};

export const readAgentDefinition = (
  agentDirectory: string,
  agentPath: string,
): AgentDefinition | AgentDefinitionIssue => {
  let content: string;

  try {
    content = readFileSync(agentPath, 'utf8');
  } catch (error) {
    return { path: agentPath, message: `Could not read agent.md: ${String(error)}` };
  }

  return parseAgentDefinition(content, agentDirectory, agentPath);
};
