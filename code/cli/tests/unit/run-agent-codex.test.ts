// Tests run-command handling of Codex adapter warnings and strict mode.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';

const roots: string[] = [];
const root = (): string => {
  const directory = mkdtempSync(join(tmpdir(), 'outfitter-run-codex-'));
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

describe('run agent with Codex MCP', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('emits the additive warning and makes it fatal under strict mode', async () => {
    const directory = root();
    const homeDirectory = join(directory, 'home');
    const projectDirectory = join(directory, 'project');
    write(join(homeDirectory, '.agents', 'mcp.json'), JSON.stringify({ mcpServers: { gh: { command: 'gh-mcp' } } }));
    write(
      join(projectDirectory, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\nmcp: [gh]\n---\n\nBody.\n',
    );
    let launches = 0;
    let launchPlan: AgentLaunchPlan | undefined;
    const launcher = (plan: AgentLaunchPlan): Promise<number> => {
      launches += 1;
      launchPlan = plan;
      return Promise.resolve(0);
    };

    const warning = await executeRunAgentCommand({
      homeDirectory,
      projectDirectory,
      agent: 'engineer',
      harness: 'codex',
      launcher,
    });
    expect(warning.messages).toContain(
      'codex MCP projection is additive: user and project MCP servers remain active because Codex has no strict isolation mode.',
    );
    expect(launches).toBe(1);
    expect(launchPlan?.command).toBe('codex');
    expect(launchPlan?.args).toEqual(expect.arrayContaining(['-c', 'mcp_servers.gh.command="gh-mcp"']));

    const strict = await executeRunAgentCommand({
      homeDirectory,
      projectDirectory,
      agent: 'engineer',
      harness: 'codex',
      strict: true,
      launcher,
    });
    expect(strict.exitCode).toBe(1);
    expect(strict.messages).toContain(
      'codex MCP projection is additive: user and project MCP servers remain active because Codex has no strict isolation mode.',
    );
    expect(launches).toBe(1);
  });

  it('makes the structured identity gap fatal under strict mode without MCP', async () => {
    const directory = root();
    const homeDirectory = join(directory, 'home');
    const projectDirectory = join(directory, 'project');
    write(join(projectDirectory, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n\nBody.\n');
    let launches = 0;

    const strict = await executeRunAgentCommand({
      homeDirectory,
      projectDirectory,
      agent: 'engineer',
      harness: 'codex',
      strict: true,
      launcher: () => {
        launches += 1;
        return Promise.resolve(0);
      },
    });

    expect(strict.exitCode).toBe(1);
    expect(strict.messages).toContain("harness 'codex' cannot project loadout element 'identity'.");
    expect(strict.messages).not.toContain(
      'codex MCP projection is additive: user and project MCP servers remain active because Codex has no strict isolation mode.',
    );
    expect(launches).toBe(0);
  });
});
