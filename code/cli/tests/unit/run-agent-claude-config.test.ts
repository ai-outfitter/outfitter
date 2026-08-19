import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { createRunAgentCommand, executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';

const roots: string[] = [];
const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};
const tree = (): { home: string; project: string } => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-claude-config-run-'));
  roots.push(root);
  const home = join(root, 'home');
  const project = join(root, 'project');
  write(join(project, '.agents', 'skills', 'wiki', 'SKILL.md'), '---\nname: wiki\n---\n\nWiki skill body.\n');
  write(
    join(project, '.agents', 'agents', 'engineer', 'agent.md'),
    '---\nname: engineer\nskills: [wiki]\n---\n\nEngineer.\n',
  );
  return { home, project };
};
afterEach(() => {
  process.exitCode = undefined;
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('run agent Claude configuration', () => {
  it('inherits native configuration and projects skills through a plugin by default', async () => {
    const { home, project } = tree();
    write(join(home, '.claude', 'settings.json'), JSON.stringify({ enabledPlugins: { typescript: true } }));
    write(join(home, '.claude.json'), JSON.stringify({ mcpServers: { personal: { command: 'personal' } } }));

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      launcher: (plan) => {
        expect(plan.env.CLAUDE_CONFIG_DIR).toBeUndefined();
        expect(plan.args).not.toContain('--strict-mcp-config');
        const pluginDir = plan.args[plan.args.indexOf('--plugin-dir') + 1];
        expect(readFileSync(join(pluginDir, 'skills', 'wiki', 'SKILL.md'), 'utf8')).toContain('Wiki skill body');
        expect(readFileSync(join(pluginDir, '.claude-plugin', 'plugin.json'), 'utf8')).toContain(
          'outfitter-composition',
        );
        return Promise.resolve(0);
      },
    });

    expect(result.messages).toContain(
      `Claude configuration: inherited ${join(home, '.claude', 'settings.json')}, 1 user MCP servers, 1 enabled plugins.`,
    );
  });

  it('falls back to isolation when the installed harness lacks plugin support', async () => {
    const { home, project } = tree();
    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      probeClaudeInheritance: () => ['--plugin-dir'],
      launcher: (plan) => {
        expect(plan.env.CLAUDE_CONFIG_DIR).toBeDefined();
        expect(plan.args).toContain('--strict-mcp-config');
        expect(plan.args).not.toContain('--plugin-dir');
        return Promise.resolve(0);
      },
    });

    expect(result.messages).toContain(
      'Claude configuration inheritance requires --plugin-dir; falling back to isolated mode.',
    );
  });

  it('wires --isolated and --retain-projection through Commander', async () => {
    const { home, project } = tree();
    let retained = '';
    const program = new Command();
    createRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      launcher: (plan) => {
        retained = plan.env.CLAUDE_CONFIG_DIR;
        return Promise.resolve(0);
      },
      probeClaudeInheritance: () => {
        throw new Error('isolated mode must not probe Claude');
      },
      writeLine: () => undefined,
    }).register(program);

    await program.parseAsync([
      'node',
      'outfitter',
      'run',
      'engineer',
      '--harness',
      'claude',
      '--isolated',
      '--retain-projection',
    ]);

    expect(existsSync(retained)).toBe(true);
    rmSync(retained, { recursive: true, force: true });
  });
});
