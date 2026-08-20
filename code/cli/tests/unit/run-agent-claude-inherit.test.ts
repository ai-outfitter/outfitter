// Tests end-to-end Claude launches: the run stands on the user's own configuration by default and
// bridges no durable state when it does, `--isolated` restores the config-directory boundary, and a
// CLI that cannot inherit falls back to isolation loudly rather than failing the launch.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';

const roots: string[] = [];
const root = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'outfitter-run-inherit-'));
  roots.push(directory);
  return directory;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

afterEach(() => {
  for (const directory of roots.splice(0)) rmSync(directory, { recursive: true, force: true });
});

const inheritCapableHelp = (): string => '--plugin-dir <path> --mcp-config <configs...>';

const captured: { skillPresent: boolean }[] = [];

const launcher = (plan: AgentLaunchPlan): Promise<number> => {
  const pluginDirIndex = plan.args.indexOf('--plugin-dir');
  const runtimeDir = plan.env.CLAUDE_CONFIG_DIR ?? (pluginDirIndex >= 0 ? plan.args[pluginDirIndex + 1] : '');
  captured.push({ skillPresent: existsSync(join(runtimeDir, 'skills', 'wiki', 'SKILL.md')) });
  return Promise.resolve(0);
};

const tree = (): { home: string; project: string } => {
  const directory = root();
  const home = join(directory, 'home');
  const project = join(directory, 'project');
  write(join(project, '.agents', 'system-prompt.md'), 'BASE PROMPT');
  write(join(project, '.agents', 'skills', 'wiki', 'SKILL.md'), '---\nname: wiki\n---\n\nWiki skill body.\n');
  write(
    join(project, '.agents', 'agents', 'engineer', 'agent.md'),
    '---\nname: engineer\nskills: [wiki]\nmodel: gpt-5.2\nthinking: high\nextensions: [ext-a]\n---\n\n# Engineer\n',
  );
  return { home, project };
};

describe('run agent on the Claude harness', () => {
  it('maps model/thinking to claude flags and stays silent about the agent pi extensions', async () => {
    const { home, project } = tree();
    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      isolated: true,
      launcher,
    });

    const plan = result.launchPlan!;
    expect(plan.command).toBe('claude');
    expect(plan.env.CLAUDE_CONFIG_DIR).toBeDefined();
    expect(plan.args).toEqual(expect.arrayContaining(['--effort', 'high']));
    expect(plan.args).not.toContain('--skill'); // claude skills are materialized, not flagged
    // The engineer's `extensions: [ext-a]` is pi-only, a mismatch a claude user cannot act on.
    expect(result.messages.join(' ')).not.toContain('extensions');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.1, OFTR-006.5.20).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('launches claude over the user own configuration by default', async () => {
    const { home, project } = tree();
    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      harnessHelpReader: inheritCapableHelp,
      launcher,
    });

    const plan = result.launchPlan!;
    // No CLAUDE_CONFIG_DIR: the session keeps the machine trust, permissions, plugins, and MCP servers.
    expect(plan.env.CLAUDE_CONFIG_DIR).toBeUndefined();
    // The composition still reaches the session, as one plugin directory rather than a whole config dir.
    expect(plan.args).toContain('--plugin-dir');
    expect(captured[0].skillPresent).toBe(true);
    expect(plan.args).not.toContain('--strict-mcp-config');
    expect(result.messages.join(' ')).not.toContain('falling back');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.21).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('seeds and copies back no durable Claude state when the run inherits it', async () => {
    const { home, project } = tree();
    write(join(home, '.claude', '.credentials.json'), '{"claudeAiOauth":{"accessToken":"secret"}}');
    let projectionRoot = '';

    await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      harnessHelpReader: inheritCapableHelp,
      launcher: (plan) => {
        projectionRoot = plan.args[plan.args.indexOf('--plugin-dir') + 1];
        expect(existsSync(join(projectionRoot, '.credentials.json'))).toBe(false);
        expect(existsSync(join(projectionRoot, '.claude.json'))).toBe(false);
        return Promise.resolve(0);
      },
    });

    expect(readFileSync(join(home, '.claude', '.credentials.json'), 'utf8')).toBe(
      '{"claudeAiOauth":{"accessToken":"secret"}}',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.22).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('falls back to an isolated launch, loudly, when the installed claude cannot inherit', async () => {
    const { home, project } = tree();
    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      harnessHelpReader: () => '--mcp-config <configs...>',
      launcher,
    });

    expect(result.launchPlan!.env.CLAUDE_CONFIG_DIR).toBeDefined();
    expect(result.launchPlan!.args).toContain('--strict-mcp-config');
    expect(result.messages.join(' ')).toContain('--plugin-dir');
  });

  it('does not fail a --strict run because the installed claude cannot inherit', async () => {
    const { home, project } = tree();
    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      strict: true,
      harnessHelpReader: () => '',
      launcher,
    });

    expect(result.exitCode).toBe(0);
    expect(result.messages.join(' ')).toContain('isolated run');
  });
});
