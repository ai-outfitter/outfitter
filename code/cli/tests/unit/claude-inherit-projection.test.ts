// Tests the default Claude projection: the composition rides in as a plugin directory over the
// user's own configuration, and `isolated` is what falls back to a config-directory boundary.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CompositionPlan } from '../../src/composer/Composition.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';

const roots: string[] = [];
const root = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'outfitter-claude-inherit-'));
  roots.push(directory);
  return directory;
};

afterEach(() => {
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const planWith = (extensions: readonly string[]): CompositionPlan => ({
  agent: 'agent',
  identity: { agentBody: 'Body.', label: 'Reviewer' },
  loadout: {
    skills: [],
    delegateSkills: [],
    subagents: [],
    mcp: [],
    mcpServers: {},
    extensions: [...extensions],
    plugins: [],
  },
  warnings: [],
});

describe('projectComposition Claude configuration strategy', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.20).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('carries an inherited composition through --plugin-dir and leaves the user configuration in place', () => {
    const dir = root();
    const projection = projectComposition(planWith([]), {
      harness: 'claude',
      rootDirectory: dir,
      homeDirectory: dir,
      profileSlug: 'luce',
    });

    expect(projection.launch.env).toEqual({});
    expect(projection.launch.args).toEqual(expect.arrayContaining(['--plugin-dir', dir]));
    expect(JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'))).toMatchObject({
      name: 'luce',
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.11).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('merges an inherited run with the machine own MCP servers by omitting --strict-mcp-config', () => {
    const dir = root();
    const projection = projectComposition(planWith([]), { harness: 'claude', rootDirectory: dir, homeDirectory: dir });

    expect(projection.launch.args).toEqual(expect.arrayContaining(['--mcp-config', join(dir, 'mcp.json')]));
    expect(projection.launch.args).not.toContain('--strict-mcp-config');
  });

  it('defaults to inheriting, and isolates only when asked', () => {
    const dir = root();
    const inherited = projectComposition(planWith([]), { harness: 'claude', rootDirectory: dir, homeDirectory: dir });
    const isolated = projectComposition(planWith([]), {
      harness: 'claude',
      rootDirectory: dir,
      homeDirectory: dir,
      isolation: 'isolated',
    });

    expect(inherited.launch.env.CLAUDE_CONFIG_DIR).toBeUndefined();
    expect(isolated.launch.env.CLAUDE_CONFIG_DIR).toBe(dir);
    expect(isolated.launch.args).not.toContain('--plugin-dir');
  });

  it('names the generated plugin for the profile even when the slug is not slug-shaped', () => {
    const dir = root();
    projectComposition(planWith([]), {
      harness: 'claude',
      rootDirectory: dir,
      homeDirectory: dir,
      profileSlug: '  Review Bot!  ',
    });

    expect(JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'))).toMatchObject({
      name: 'review-bot',
    });
  });

  it('falls back to an outfitter plugin name when no profile slug and no usable slug reach projection', () => {
    const dir = root();
    projectComposition(planWith([]), { harness: 'claude', rootDirectory: dir, homeDirectory: dir, profileSlug: '!!' });

    expect(JSON.parse(readFileSync(join(dir, '.claude-plugin', 'plugin.json'), 'utf8'))).toMatchObject({
      name: 'outfitter',
    });
  });

  it('leaves pi and codex on their own projection roots whatever the isolation setting says', () => {
    const dir = root();
    for (const harness of ['pi', 'codex'] as const) {
      const projection = projectComposition(planWith([]), {
        harness,
        rootDirectory: dir,
        homeDirectory: dir,
        isolation: 'inherit',
      });
      expect(projection.launch.args).not.toContain('--plugin-dir');
    }
  });
});
