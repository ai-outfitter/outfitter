// Parses `agents/<id>/agent.md` frontmatter and merges per-layer config.json loadout overrides.
import { readFileSync } from 'node:fs';

import { TOOL_NAME_RULE, invalidToolName } from '../projection/Tools.js';
import { validateSchema } from '../validation/SchemaValidator.js';
import { parseYamlDocument } from '../validation/YamlDocument.js';
import type { PromptSourceReference } from '../composer/PromptSource.js';
import { isPromptSourceReference } from '../composer/PromptSource.js';
import type { Loadout } from './Resource.js';
import { emptyLoadout } from './Resource.js';

export interface AgentDefinition {
  /** The agent.md file that declares identity, inheritance, and prompt controls. */
  readonly sourcePath: string;
  readonly name: string;
  /** Human-readable profile name shown in interactive harness UI. */
  readonly label?: string;
  readonly description?: string;
  /** Markdown body after the frontmatter — the agent's identity prose. */
  readonly body: string;
  readonly loadout: Loadout;
  /** The effective declaration file for each loadout key after config.json overrides. */
  readonly loadoutSourcePaths: Readonly<Record<LoadoutKey, string>>;
  /** Ordered parent agent slugs declared by `inherits`. */
  readonly inherits: readonly string[];
  readonly promptControls: PromptControls;
}

export interface PromptControls {
  readonly systemPrompt?: PromptSourceReference;
  readonly appendSystemPrompt: readonly PromptSourceReference[];
  readonly promptTemplate?: PromptSourceReference;
}

export interface AgentDefinitionIssue {
  readonly kind: 'frontmatter' | 'invalid-name' | 'config' | 'invalid-tools' | 'read';
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

export type LoadoutKey = (typeof loadoutKeys)[number];

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

const asSlugListOrScalar = (value: unknown): readonly string[] => {
  if (typeof value === 'string') return [value];
  return asStringArray(value);
};

const promptControlsFromRecord = (record: Readonly<Record<string, unknown>>): PromptControls => ({
  systemPrompt: isPromptSourceReference(record.system_prompt) ? record.system_prompt : undefined,
  appendSystemPrompt: Array.isArray(record.append_system_prompt)
    ? record.append_system_prompt.filter(isPromptSourceReference)
    : isPromptSourceReference(record.append_system_prompt)
      ? [record.append_system_prompt]
      : [],
  promptTemplate: isPromptSourceReference(record.prompt_template) ? record.prompt_template : undefined,
});

const readMarkdownHeading = (body: string): string | undefined => /^#\s+(.+)$/mu.exec(body)?.[1]?.trim();

const loadoutFromRecord = (record: Readonly<Record<string, unknown>>): Loadout => ({
  ...emptyLoadout(),
  skills: asStringArray(record.skills),
  subagents: asStringArray(record.subagents),
  mcp: asStringArray(record.mcp),
  extensions: asStringArray(record.extensions),
  plugins: asStringArray(record.plugins),
  model: asString(record.model),
  thinking: asString(record.thinking),
  tools: toolSelectionFromRecord(record.tools),
});

/**
 * Narrows a raw `tools` value that `toolsShapeDefect` has already accepted. Key presence is
 * preserved: an absent `allow` stays absent, because "no allowlist declared" and "an empty
 * allowlist" project differently and normalizing one into the other would fabricate a ceiling.
 */
const toolSelectionFromRecord = (value: unknown): Loadout['tools'] => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as { readonly allow?: unknown; readonly deny?: unknown };

  return {
    ...(record.allow === undefined ? {} : { allow: asStringArray(record.allow) }),
    ...(record.deny === undefined ? {} : { deny: asStringArray(record.deny) }),
  };
};

/**
 * The defect in a RAW `tools` value, before any normalization, or `undefined` when the shape is
 * exactly `{allow?: string[], deny?: string[]}` with non-empty entries. This runs at the read
 * boundary because silent normalization fails open: `asStringArray` turns an unknown key, a string
 * where an array was meant, or a non-string entry into an empty or partial selection, and the
 * agent then launches WITHOUT the restriction the author wrote — under `--strict` included, since
 * nothing is left to warn about. A malformed selection must be a hard error naming the defect.
 * `agent.md` frontmatter is shape-checked by `agent.schema.json`; this is the same invariant for
 * the `config.json` overlay path that bypasses the schema.
 */
export const toolsShapeDefect = (tools: unknown): string | undefined => {
  if (tools === undefined) return undefined;

  if (tools === null || typeof tools !== 'object' || Array.isArray(tools)) {
    return `\`tools\` must be an object of the form {allow?: [...], deny?: [...]}, not ${describeValue(tools)}.`;
  }

  const record = tools as Readonly<Record<string, unknown>>;
  const unknownKey = Object.keys(record).find((key) => key !== 'allow' && key !== 'deny');

  if (unknownKey !== undefined) {
    return `\`tools\` has unknown key ${JSON.stringify(unknownKey)}; only "allow" and "deny" are accepted.`;
  }

  return toolListDefect('allow', record.allow) ?? toolListDefect('deny', record.deny);
};

/** Names the value's kind for a shape-defect message. */
const describeValue = (value: unknown): string =>
  value === null ? 'null' : Array.isArray(value) ? 'an array' : `a ${typeof value}`;

/** The defect in one raw `tools.allow`/`tools.deny` list, or `undefined` when it is well formed. */
const toolListDefect = (key: 'allow' | 'deny', value: unknown): string | undefined => {
  if (value === undefined) return undefined;

  if (!Array.isArray(value)) {
    return `\`tools.${key}\` must be an array of tool names, not ${describeValue(value)}.`;
  }

  const badIndex = value.findIndex((entry) => typeof entry !== 'string' || entry === '');

  return badIndex === -1
    ? undefined
    : `\`tools.${key}[${badIndex}]\` must be a non-empty string, not ${JSON.stringify(value[badIndex])}.`;
};

/**
 * Reports a tool name in the merged loadout that projection cannot carry. The shape is already
 * guaranteed here — frontmatter by `agent.schema.json`, each `config.json` layer by
 * `toolsShapeDefect` in `readConfigLoadout` — but the *names* must be re-checked on the merged
 * record, because a `config.json` overlay can replace `tools` wholesale after the schema check.
 */
const toolsIssue = (record: Readonly<Record<string, unknown>>, path: string): AgentDefinitionIssue | undefined => {
  if (record.tools === undefined) return undefined;

  const offending = invalidToolName(toolSelectionFromRecord(record.tools));

  return offending === undefined
    ? undefined
    : {
        kind: 'invalid-tools',
        path,
        message: `declares an unusable tool name ${JSON.stringify(offending)}: ${TOOL_NAME_RULE}`,
      };
};

/** Reads one config.json, restricting it to loadout keys; parse/read/non-object failures are issues. */
const readConfigLoadout = (configPath: string): Readonly<Record<string, unknown>> | AgentDefinitionIssue => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(configPath, 'utf8'));
  } catch (error) {
    return { kind: 'config', path: configPath, message: `config.json is not readable JSON: ${String(error)}` };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { kind: 'config', path: configPath, message: 'config.json must be a JSON object of loadout overrides.' };
  }

  const picked = pickLoadoutKeys(parsed as Record<string, unknown>);

  // Validate the RAW `tools` shape per layer, before any normalization and before the merge can
  // hide which file is malformed. See `toolsShapeDefect` for why silent normalization fails open.
  if ('tools' in picked && picked.tools !== undefined) {
    const defect = toolsShapeDefect(picked.tools);

    if (defect !== undefined) {
      return {
        kind: 'invalid-tools',
        path: configPath,
        message: `config.json declares a malformed tool selection: ${defect}`,
      };
    }
  }

  return picked;
};

const parseFrontmatterRecord = (
  content: string,
  agentPath: string,
): { readonly record: Record<string, unknown>; readonly body: string } | AgentDefinitionIssue => {
  const split = splitFrontmatter(content);

  if (split === undefined) {
    return {
      kind: 'frontmatter',
      path: agentPath,
      message: 'agent.md must start with a `---` YAML frontmatter block.',
    };
  }

  const parsed = parseYamlDocument(split.frontmatter, agentPath);

  if (!parsed.ok) {
    return {
      kind: 'frontmatter',
      path: agentPath,
      message: `agent.md frontmatter is not valid YAML: ${parsed.issue.message}`,
    };
  }

  if (parsed.document === null || typeof parsed.document !== 'object' || Array.isArray(parsed.document)) {
    return { kind: 'frontmatter', path: agentPath, message: 'agent.md frontmatter must be a YAML mapping.' };
  }

  // Validate the frontmatter on its own so config.json cannot supply required identity fields.
  const validation = validateSchema('agent', parsed.document);

  if (!validation.valid) {
    // An invalid document always yields at least one issue.
    return {
      kind: validation.issues[0].path === '/name' ? 'invalid-name' : 'frontmatter',
      path: agentPath,
      message: `agent.md is invalid: ${validation.issues[0].message}`,
    };
  }

  return { record: parsed.document as Record<string, unknown>, body: split.body };
};

interface MergedLoadout {
  readonly record: Record<string, unknown>;
  readonly sourcePaths: Readonly<Record<LoadoutKey, string>>;
}

const mergeLoadoutOverrides = (
  frontmatter: Readonly<Record<string, unknown>>,
  configPaths: readonly string[],
  agentPath: string,
): MergedLoadout | AgentDefinitionIssue => {
  let record = { ...frontmatter };
  const sourcePaths = Object.fromEntries(loadoutKeys.map((key) => [key, agentPath])) as Record<LoadoutKey, string>;

  for (const configPath of [...configPaths].reverse()) {
    const config = readConfigLoadout(configPath);
    if (isAgentDefinitionIssue(config)) return config;
    record = { ...record, ...config };
    for (const key of loadoutKeys) {
      if (key in config) sourcePaths[key] = configPath;
    }
  }

  return { record, sourcePaths };
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

  const merged = mergeLoadoutOverrides(frontmatter.record, configPaths, agentPath);
  if (isAgentDefinitionIssue(merged)) return merged;

  // The JSON Schema only sees the frontmatter, and a config.json overlay can replace `tools`
  // wholesale after that check. Validate the merged loadout so an unprojectable tool name is an
  // error from `outfitter validate`, not a surprise at launch.
  const toolIssue = toolsIssue(merged.record, merged.sourcePaths.tools ?? agentPath);

  if (toolIssue !== undefined) {
    return toolIssue;
  }

  return {
    sourcePath: agentPath,
    name: frontmatter.record.name as string,
    label: asString(frontmatter.record.label)?.trim() || readMarkdownHeading(frontmatter.body),
    description: asString(frontmatter.record.description),
    body: frontmatter.body,
    loadout: loadoutFromRecord(merged.record),
    loadoutSourcePaths: merged.sourcePaths,
    inherits: asSlugListOrScalar(frontmatter.record.inherits),
    promptControls: promptControlsFromRecord(frontmatter.record),
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
    return { kind: 'read', path: agentPath, message: `Could not read agent.md: ${String(error)}` };
  }

  return parseAgentDefinition(content, configPaths, agentPath);
};
