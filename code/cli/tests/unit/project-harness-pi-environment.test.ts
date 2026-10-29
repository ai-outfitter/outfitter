import { mkdtempSync, readFileSync, rmSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { CompositionPlan } from '../../src/composer/Composition.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';

const roots: string[] = [];
const root = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'outfitter-pi-environment-'));
  roots.push(dir);
  return dir;
};
afterEach(() => {
  vi.unstubAllEnvs();
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

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.21).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('merges managed resident servers into the actual Pi directory without changing the profile', () => {
    const dir = root();
    const managed = join(root(), 'mcp.json');
    writeFileSync(managed, JSON.stringify({ mcpServers: { managed: { url: 'https://example.test' } } }));
    const input = { harness: 'pi' as const, rootDirectory: dir, homeDirectory: dir, processEnvironment: {} };
    const before = projectComposition(plan, input);
    const projection = projectComposition(plan, {
      ...input,
      processEnvironment: { OUTFITTER_MANAGED_MCP_CONFIG: managed },
    });
    expect(projection.launch).toEqual(before.launch);
    expect(JSON.parse(readFileSync(join(projection.launch.env.PI_CODING_AGENT_DIR, 'mcp.json'), 'utf8'))).toEqual({
      mcpServers: { managed: { url: 'https://example.test' } },
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.21).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('keeps catalog precedence and does not revive suppressed overlay MCP servers', () => {
    const dir = root(),
      overlay = root(),
      managed = join(root(), 'mcp.json');
    writeFileSync(
      join(overlay, 'mcp.json'),
      JSON.stringify({
        overlayField: true,
        mcpServers: { suppressed: { command: 'do-not-restore' }, catalog: { command: 'old-overlay' } },
      }),
    );
    writeFileSync(managed, JSON.stringify({ mcpServers: { managed: { url: 'https://example.test' } } }));
    const selected = {
      ...plan,
      loadout: { ...plan.loadout, mcp: ['catalog'], mcpServers: { catalog: { command: 'selected-catalog' } } },
    };
    projectComposition(selected, {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
      configurationOverlayDirectories: [overlay],
      processEnvironment: { OUTFITTER_MANAGED_MCP_CONFIG: managed },
    });
    expect(JSON.parse(readFileSync(join(dir, 'mcp.json'), 'utf8'))).toEqual({
      mcpServers: { catalog: { command: 'selected-catalog' }, managed: { url: 'https://example.test' } },
    });
    expect(statSync(join(dir, 'mcp.json')).mode & 0o777).toBe(0o600);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.21).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.21).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('does not consult ambient managed MCP configuration when no launch environment is supplied', () => {
    vi.stubEnv('OUTFITTER_MANAGED_MCP_CONFIG', '/invalid-must-not-be-read');
    const dir = root();
    expect(() => projectComposition(plan, { harness: 'pi', rootDirectory: dir, homeDirectory: dir })).not.toThrow();
  });

  it.each(['claude', 'codex'] as const)('marks managed MCP unsupported for %s', (harness) => {
    const dir = root();
    const projection = projectComposition(plan, {
      harness,
      rootDirectory: dir,
      homeDirectory: dir,
      processEnvironment: { OUTFITTER_MANAGED_MCP_CONFIG: '/should-not-be-read' },
    });
    expect(projection.unsupported).toContain('managed MCP configuration (only supported by pi)');
  });

  it.each(['claude', 'codex'] as const)('does not set the Pi MCP isolation control for %s', (harness) => {
    const dir = root();
    const projection = projectComposition(plan, { harness, rootDirectory: dir, homeDirectory: dir });

    expect(projection.launch.env.PI_MCP_CONFIG_MODE).toBeUndefined();
  });
});
