// Merges profile-provided Pi MCP configuration fragments into a composite profile file.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { createCompositeProfileFile, type CompositeProfileFile } from '../../compositeProfile/CompositeProfileFile.js';
import type { MergeableValue } from '../../merge/SettingsValueMerger.js';
import { mergeArrayByPolicy } from '../../merge/ArrayMergePolicy.js';

const piMcpConfigPath = '.mcp.json';

type JsonObject = Readonly<Record<string, MergeableValue | undefined>>;

export const createPiMcpConfigFile = (
  rootDirectory: string,
  profileFolders: readonly string[] = [],
): CompositeProfileFile | undefined => {
  const sourceInputs = findPiMcpConfigSources(profileFolders);

  if (sourceInputs.length === 0) {
    return undefined;
  }

  const mergedConfig = sourceInputs
    .map(readPiMcpConfigSource)
    .reduce<JsonObject>((mergedConfig, config) => mergePiMcpConfigObjects(mergedConfig, config), {});

  return createCompositeProfileFile({
    rootDirectory,
    relativePath: piMcpConfigPath,
    content: `${JSON.stringify(mergedConfig, null, 2)}\n`,
    sourceInputs,
    strategy: 'merge',
  });
};

const findPiMcpConfigSources = (profileFolders: readonly string[]): readonly string[] =>
  profileFolders
    .map((profileFolder) => join(profileFolder, 'cli_specific', 'pi', piMcpConfigPath))
    .filter((candidate) => existsSync(candidate));

const readPiMcpConfigSource = (sourcePath: string): JsonObject => {
  const parsed = parsePiMcpConfigJson(sourcePath);

  if (!isJsonObject(parsed)) {
    throw new Error(`Pi MCP config '${sourcePath}' must contain a JSON object.`);
  }

  return parsed;
};

const parsePiMcpConfigJson = (sourcePath: string): unknown => {
  const content = readPiMcpConfigContent(sourcePath);

  try {
    return JSON.parse(content) as unknown;
  } catch (error) {
    throw new Error(`Pi MCP config '${sourcePath}' must contain valid JSON.`, { cause: error });
  }
};

const readPiMcpConfigContent = (sourcePath: string): string => {
  try {
    return readFileSync(sourcePath, 'utf8');
  } catch (error) {
    throw new Error(`Could not read Pi MCP config '${sourcePath}': ${String(error)}`, { cause: error });
  }
};

const mergePiMcpConfigObjects = (
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
          ? mergePiMcpConfigValue(lowerPrecedence[key], value, [...path, key])
          : clonePiMcpConfigValue(value),
      ]),
  ),
});

const mergePiMcpConfigValue = (
  lowerPrecedence: MergeableValue | undefined,
  higherPrecedence: MergeableValue,
  path: readonly string[],
): MergeableValue => {
  if (Array.isArray(higherPrecedence)) {
    return mergeArrayByPolicy(isMergeableArray(lowerPrecedence) ? lowerPrecedence : undefined, higherPrecedence, {
      mode: 'uniqueBy',
      order: 'append',
      winner: 'last',
      key: piMcpArrayItemIdentity,
    });
  }

  if (isJsonObject(lowerPrecedence) && isJsonObject(higherPrecedence) && !isMcpServerDefinitionPath(path)) {
    return mergePiMcpConfigObjects(lowerPrecedence, higherPrecedence, path);
  }

  return clonePiMcpConfigValue(higherPrecedence);
};

const isMcpServerDefinitionPath = (path: readonly string[]): boolean => path.length === 2 && path[0] === 'mcpServers';

const piMcpArrayItemIdentity = (item: MergeableValue): string => {
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

const clonePiMcpConfigValue = (value: MergeableValue): MergeableValue => {
  if (isMergeableArray(value)) {
    return value.map(clonePiMcpConfigValue);
  }

  if (isJsonObject(value)) {
    return mergePiMcpConfigObjects({}, value);
  }

  return value;
};

const isJsonObject = (value: unknown): value is JsonObject =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

const isMergeableArray = (value: unknown): value is readonly MergeableValue[] => Array.isArray(value);
