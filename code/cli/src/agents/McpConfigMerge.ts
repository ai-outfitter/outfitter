// Merges profile-provided MCP configuration fragments into a composite profile file for any adapter.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createCompositeProfileFile, type CompositeProfileFile } from '../compositeProfile/CompositeProfileFile.js';
import type { MergeableValue } from '../merge/SettingsValueMerger.js';
import { mergeArrayByPolicy } from '../merge/ArrayMergePolicy.js';

export const mcpConfigFragmentPath = '.mcp.json';

export interface McpConfigMergeInput {
  /** Composite profile root the merged config file is generated into. */
  readonly rootDirectory: string;
  /** Adapter id used to locate `cli_specific/<adapterId>/.mcp.json` fragments. */
  readonly adapterId: string;
  /** Human-readable label used in error messages, e.g. `Pi MCP config`. */
  readonly configLabel: string;
  /** Profile folders ordered from lowest precedence to highest precedence. */
  readonly profileFolders: readonly string[];
}

type JsonObject = Readonly<Record<string, MergeableValue | undefined>>;

export const createMergedMcpConfigFile = (input: McpConfigMergeInput): CompositeProfileFile | undefined => {
  const sourceInputs = findMcpConfigSources(input.adapterId, input.profileFolders);

  if (sourceInputs.length === 0) {
    return undefined;
  }

  const mergedConfig = sourceInputs
    .map((sourcePath) => readMcpConfigSource(input.configLabel, sourcePath))
    .reduce<JsonObject>((mergedConfig, config) => mergeMcpConfigObjects(mergedConfig, config), {});

  return createCompositeProfileFile({
    rootDirectory: input.rootDirectory,
    relativePath: mcpConfigFragmentPath,
    content: `${JSON.stringify(mergedConfig, null, 2)}\n`,
    sourceInputs,
    strategy: 'merge',
  });
};

const findMcpConfigSources = (adapterId: string, profileFolders: readonly string[]): readonly string[] =>
  profileFolders
    .map((profileFolder) => join(profileFolder, 'cli_specific', adapterId, mcpConfigFragmentPath))
    .filter((candidate) => existsSync(candidate));

const readMcpConfigSource = (configLabel: string, sourcePath: string): JsonObject => {
  const parsed = parseMcpConfigJson(configLabel, sourcePath);

  if (!isJsonObject(parsed)) {
    throw new Error(`${configLabel} '${sourcePath}' must contain a JSON object.`);
  }

  return parsed;
};

const parseMcpConfigJson = (configLabel: string, sourcePath: string): unknown => {
  const content = readMcpConfigContent(configLabel, sourcePath);

  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(`${configLabel} '${sourcePath}' must contain valid JSON.`, { cause: error });
  }
};

const readMcpConfigContent = (configLabel: string, sourcePath: string): string => {
  try {
    return readFileSync(sourcePath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read ${configLabel} '${sourcePath}': ${String(error)}`, { cause: error });
  }
};

const mergeMcpConfigObjects = (
  lowerPrecedence: JsonObject,
  higherPrecedence: JsonObject,
  path: readonly string[] = [],
): JsonObject => ({
  ...lowerPrecedence,
  ...Object.fromEntries(
    Object.entries(higherPrecedence)
      .filter((entry): entry is [string, MergeableValue] => entry[1] !== undefined)
      .map(([key, value]) => [
        key,
        key in lowerPrecedence
          ? mergeMcpConfigValue(lowerPrecedence[key], value, [...path, key])
          : cloneMcpConfigValue(value),
      ]),
  ),
});

const mergeMcpConfigValue = (
  lowerPrecedence: MergeableValue | undefined,
  higherPrecedence: MergeableValue,
  path: readonly string[],
): MergeableValue => {
  if (Array.isArray(higherPrecedence)) {
    return mergeArrayByPolicy(isMergeableArray(lowerPrecedence) ? lowerPrecedence : undefined, higherPrecedence, {
      mode: 'uniqueBy',
      order: 'append',
      winner: 'last',
      key: mcpArrayItemIdentity,
    });
  }

  if (isJsonObject(lowerPrecedence) && isJsonObject(higherPrecedence) && !isMcpServerDefinitionPath(path)) {
    return mergeMcpConfigObjects(lowerPrecedence, higherPrecedence, path);
  }

  return cloneMcpConfigValue(higherPrecedence);
};

const isMcpServerDefinitionPath = (path: readonly string[]): boolean => path.length === 2 && path[0] === 'mcpServers';

const mcpArrayItemIdentity = (item: MergeableValue): string => {
  if (isJsonObject(item)) {
    const explicitIdentity = item.identity ?? item.name ?? item.id;
    return explicitIdentity === undefined
      ? `anonymous:${stableJsonStringify(item)}`
      : `explicit:${stringifyExplicitIdentity(explicitIdentity)}`;
  }

  return `anonymous:${stableJsonStringify(item)}`;
};

const stringifyExplicitIdentity = (value: MergeableValue): string => {
  if (typeof value === 'string') {
    return value;
  }

  return stableJsonStringify(value);
};

const stableJsonStringify = (value: MergeableValue): string => JSON.stringify(sortJsonObjectKeys(value));

const sortJsonObjectKeys = (value: MergeableValue): MergeableValue => {
  if (isMergeableArray(value)) {
    return value.map(sortJsonObjectKeys);
  }

  if (isJsonObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, sortJsonObjectKeys(value[key] as MergeableValue)]),
    );
  }

  return value;
};

const cloneMcpConfigValue = (value: MergeableValue): MergeableValue => {
  if (isMergeableArray(value)) {
    return value.map(cloneMcpConfigValue);
  }

  if (isJsonObject(value)) {
    return mergeMcpConfigObjects({}, value);
  }

  return value;
};

const isJsonObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isMergeableArray = (value: unknown): value is readonly MergeableValue[] => Array.isArray(value);
