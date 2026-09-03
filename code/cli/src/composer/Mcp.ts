// Resolves selected MCP server ids into their effective definitions, layer- and owner-aware.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { escapesRoots } from '../dump/Containment.js';
import type { EffectiveResourceSet } from '../resolver/Resource.js';
import { findResource } from '../resolver/Resource.js';
import type { DeclaredSlug } from './Defaults.js';

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

const readMcpServers = (path: string, warnings: string[]): Readonly<Record<string, unknown>> => {
  let parsed: unknown;

  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    warnings.push(`MCP configuration '${path}' is not readable JSON: ${String(error)}`);
    return {};
  }

  const document = asRecord(parsed);
  const servers = document === undefined ? undefined : asRecord(document.mcpServers);

  if (servers === undefined) {
    warnings.push(`MCP configuration '${path}' must contain an object-valued 'mcpServers' map.`);
    return {};
  }

  return servers;
};

export const composeMcpServers = (
  set: EffectiveResourceSet,
  selections: readonly DeclaredSlug[],
  warnings: string[],
): Readonly<Record<string, unknown>> => {
  if (selections.length === 0) return {};

  const rootPaths = set.layers.map((layer) => join(layer.root, 'mcp.json')).filter((path) => existsSync(path));
  const roots = set.layers.map((layer) => layer.root);
  const cache = new Map<string, Readonly<Record<string, unknown>>>();
  const serversAt = (path: string): Readonly<Record<string, unknown>> => {
    const cached = cache.get(path);
    if (cached !== undefined) return cached;
    let servers: Readonly<Record<string, unknown>>;
    if (escapesRoots(path, roots)) {
      warnings.push(`MCP configuration '${path}' resolves outside the resource layers and was skipped.`);
      servers = {};
    } else {
      servers = readMcpServers(path, warnings);
    }
    cache.set(path, servers);
    return servers;
  };

  const selected: Record<string, unknown> = {};
  for (const selection of selections) {
    // Settings defaults resolve against tree-root mcp.json only; chain entries also consult the
    // declaring agent's overlays. Resolver annotates every agent resource with mcpPaths.
    const ownerPaths =
      selection.owner === undefined ? [] : [...findResource(set, 'agent', selection.owner)!.mcpPaths!].reverse();
    // Root definitions are shared; only the declaring agent's overlays may override its selection.
    const pathsByPrecedence = [...rootPaths].reverse().concat(ownerPaths);
    let definition: unknown;
    let found = false;

    for (const path of pathsByPrecedence) {
      const servers = serversAt(path);
      if (Object.hasOwn(servers, selection.slug)) {
        definition = servers[selection.slug];
        found = true;
      }
    }

    if (found) selected[selection.slug] = definition;
    else
      warnings.push(
        `${selection.owner === undefined ? 'agent_defaults mcp' : 'loadout mcp'} references unknown server '${selection.slug}'.`,
      );
  }

  return selected;
};
