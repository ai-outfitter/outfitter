// Tests run: resolve → compose → project → launch, and the pi/claude launch mapping.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createRunAgentCommand, executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';

const temporaryRoots: string[] = [];
let previousExitCode: typeof process.exitCode;

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-run-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const captured: AgentLaunchPlan[] = [];
const launcher = async (plan: AgentLaunchPlan): Promise<number> => {
  captured.push(plan);
  return 0;
};

beforeEach(() => {
  previousExitCode = process.exitCode;
  captured.length = 0;
});

afterEach(() => {
  process.exitCode = previousExitCode;
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const tree = (): { home: string; project: string } => {
  const root = createTemporaryRoot();
  const home = join(root, 'home');
  const project = join(root, 'project');
  write(join(project, '.agents', 'system-prompt.md'), 'BASE PROMPT');
  write(join(project, '.agents', 'agents.md'), 'SHARED');
  write(join(project, '.agents', 'skills', 'wiki', 'SKILL.md'), '---\nname: wiki\n---\n');
  write(
    join(project, '.agents', 'agents', 'engineer', 'agent.md'),
    '---\nname: engineer\nskills: [wiki]\nmodel: gpt-5.2\nthinking: high\nextensions: [ext-a]\n---\n\n# Engineer\n',
  );
  return { home, project };
};

describe('run agent', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.1, OFTR-006.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('resolves, composes, projects, and launches an agent in pi', async () => {
    const { home, project } = tree();
    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'pi',
      passThroughArgs: ['--yolo'],
      launcher,
    });

    expect(result.exitCode).toBe(0);
    const plan = result.launchPlan!;
    expect(plan.command).toBe('pi');
    expect(plan.env.PI_CODING_AGENT_DIR).toBeDefined();
    expect(plan.args).toEqual(
      expect.arrayContaining([
        '--system-prompt',
        '--append-system-prompt',
        '--skill',
        'wiki',
        '--model',
        'gpt-5.2',
        '--thinking',
        'high',
        '--yolo',
      ]),
    );
    // system prompt materialized from the composed identity
    const promptIndex = plan.args.indexOf('--system-prompt');
    expect(readFileSync(plan.args[promptIndex + 1]!, 'utf8')).toBe('BASE PROMPT');
  });

  it('maps model/thinking to claude flags and reports pi-only elements as unsupported', async () => {
    const { home, project } = tree();
    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      launcher,
    });

    const plan = result.launchPlan!;
    expect(plan.command).toBe('claude');
    expect(plan.env.CLAUDE_CONFIG_DIR).toBeDefined();
    expect(plan.args).toEqual(expect.arrayContaining(['--effort', 'high']));
    expect(plan.args).not.toContain('--skill'); // claude skills are materialized, not flagged
    expect(result.messages.join(' ')).toContain("cannot project loadout element 'extensions'");
  });

  it('fails under --strict when a loadout element is unsupported', async () => {
    const { home, project } = tree();
    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      strict: true,
      launcher,
    });

    expect(result.exitCode).toBe(1);
    expect(captured).toHaveLength(0); // never launched
    expect(result.messages.join(' ')).toContain('Strict mode');
  });

  it('uses default_agent and default_harness from settings', async () => {
    const { home, project } = tree();
    write(join(project, '.agents', 'settings.yml'), 'default_agent: engineer\ndefault_harness: pi\n');
    const result = await executeRunAgentCommand({ homeDirectory: home, projectDirectory: project, launcher });
    expect(result.launchPlan?.command).toBe('pi');
  });

  it('errors when no agent is selected and none is defaulted', async () => {
    const root = createTemporaryRoot();
    await expect(
      executeRunAgentCommand({ homeDirectory: join(root, 'home'), projectDirectory: join(root, 'project'), launcher }),
    ).rejects.toThrow(/No agent selected/);
  });

  it('returns a nonzero exit with errors for an unknown agent', async () => {
    const { home, project } = tree();
    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'ghost',
      launcher,
    });
    expect(result.exitCode).toBe(1);
    expect(result.messages[0]).toContain("Unknown agent 'ghost'");
  });

  it('drives the run command object through Commander parseAsync', async () => {
    const { home, project } = tree();
    const lines: string[] = [];
    const program = new Command();
    createRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      launcher,
      writeLine: (m) => lines.push(m),
    }).register(program);
    await program.parseAsync(['node', 'outfitter', 'run', 'engineer', '--harness', 'pi']);
    expect(captured[0]?.command).toBe('pi');
    expect(existsSync(captured[0]!.env.PI_CODING_AGENT_DIR)).toBe(true);
  });
});
