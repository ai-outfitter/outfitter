import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CompositionPlan } from '../../src/composer/Composition.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';

const roots: string[] = [];
const root = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'outfitter-pi-environment-'));
  roots.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const plan: CompositionPlan = {
  agent: 'agent',
  identity: { agentBody: 'Body.' },
  loadout: {
    skills: [],
    delegateSkills: [],
    subagents: [],
    mcp: [],
    mcpServers: {},
    extensions: [],
    plugins: [],
  },
  warnings: [],
};

describe('projectComposition Pi environment', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.20).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('isolates the composed MCP configuration from host discovery', () => {
    const dir = root();
    const projection = projectComposition(plan, { harness: 'pi', rootDirectory: dir, homeDirectory: dir });

    expect(projection.launch.env.PI_MCP_CONFIG_MODE).toBe('exclusive');
  });

  it.each(['claude', 'codex'] as const)('does not set the Pi MCP isolation control for %s', (harness) => {
    const dir = root();
    const projection = projectComposition(plan, { harness, rootDirectory: dir, homeDirectory: dir });

    expect(projection.launch.env.PI_MCP_CONFIG_MODE).toBeUndefined();
  });
});
