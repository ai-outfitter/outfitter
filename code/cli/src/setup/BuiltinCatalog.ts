// Provides the minimal network-free `.agents` catalog bundled with Outfitter for degraded setup.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const builtinStarterAgentId = 'starter';

const starterAgent = `---
name: ${builtinStarterAgentId}
description: Built-in network-free Outfitter starter agent.
---

# Starter

You are a helpful coding agent. Follow the instructions and skills available in this .agents tree.
`;

export const createBuiltinCatalogCachePath = (homeDirectory: string): string =>
  join(homeDirectory, '.agents', 'cache', 'builtin-catalog');

/** Materializes bundled files without overwriting an existing fallback customization. */
export const materializeBuiltinCatalog = (homeDirectory: string): string => {
  const root = createBuiltinCatalogCachePath(homeDirectory);
  const agentPath = join(root, 'agents', builtinStarterAgentId, 'agent.md');

  if (!existsSync(agentPath)) {
    mkdirSync(dirname(agentPath), { recursive: true });
    writeFileSync(agentPath, starterAgent);
  }

  return root;
};
