// Managed launch connections supplement the native Pi projection without changing the profile.
import { existsSync, readFileSync } from 'node:fs';
import { isDeepStrictEqual } from 'node:util';

import { validateSchema } from '../validation/SchemaValidator.js';

interface McpDocument {
  readonly mcpServers: Readonly<Record<string, unknown>>;
  readonly [key: string]: unknown;
}

const readMcpDocument = (path: string): McpDocument => {
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    // JSON parser errors may contain credential values; never forward them.
    throw new Error('Could not read managed native MCP configuration.');
  }
  if (!validateSchema('managed-mcp', document).valid) {
    throw new Error('Managed native MCP configuration does not match the MCP schema.');
  }
  return document as McpDocument;
};

const mergeServers = (
  current: Readonly<Record<string, unknown>>,
  incoming: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> => {
  const merged = { ...current };
  for (const [name, definition] of Object.entries(incoming)) {
    if (Object.hasOwn(current, name) && !isDeepStrictEqual(current[name], definition)) {
      throw new Error(`Managed MCP server conflicts with existing native configuration: ${name}`);
    }
    Object.defineProperty(merged, name, { value: definition, enumerable: true, configurable: true });
  }
  return merged;
};

/** Merge only after ordinary profile precedence has produced its native MCP file. */
export const mergeManagedMcpConfig = (target: string, managedPath: string): string => {
  const desired = readMcpDocument(managedPath);
  const existing = readNativeMcpDocument(target);
  const servers = mergeServers(existing.mcpServers, desired.mcpServers);
  return `${JSON.stringify({ ...existing, mcpServers: servers }, null, 2)}\n`;
};

const readNativeMcpDocument = (target: string): McpDocument => {
  if (!existsSync(target)) return { mcpServers: {} };
  let document: unknown;
  try {
    document = JSON.parse(readFileSync(target, 'utf8'));
  } catch {
    throw new Error('Could not read existing native MCP configuration.');
  }
  if (document === null || typeof document !== 'object' || Array.isArray(document)) {
    throw new Error('Existing native MCP configuration must be an object.');
  }
  if (!Object.hasOwn(document, 'mcpServers')) return { ...document, mcpServers: {} };
  const servers = (document as Record<string, unknown>).mcpServers;
  if (servers === null || typeof servers !== 'object' || Array.isArray(servers)) {
    throw new Error('Existing native MCP configuration must contain an mcpServers map.');
  }
  return document as McpDocument;
};
