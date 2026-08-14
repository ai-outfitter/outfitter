import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { createRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';

const temporaryRoots: string[] = [];

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const tree = (withDefault = false): { home: string; project: string } => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-run-default-'));
  const home = join(root, 'home');
  const project = join(root, 'project');
  temporaryRoots.push(root);
  write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n\n# Engineer\n');
  if (withDefault) {
    write(join(project, '.agents', 'settings.yml'), 'default_agent: engineer\ndefault_harness: pi\n');
  }
  return { home, project };
};

const parse = async (argv: readonly string[], withDefault = false): Promise<AgentLaunchPlan> => {
  const { home, project } = tree(withDefault);
  let launchPlan: AgentLaunchPlan | undefined;
  const program = new Command();
  createRunAgentCommand({
    homeDirectory: home,
    projectDirectory: project,
    launcher: (plan) => {
      launchPlan = plan;
      return Promise.resolve(0);
    },
    writeLine: () => undefined,
  }).register(program);
  await program.parseAsync(['node', 'outfitter', ...argv]);
  return launchPlan!;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('run as the default command', () => {
  it('forwards -r to the harness', async () => {
    const plan = await parse(['-r'], true);
    expect(plan.command).toBe('pi');
    expect(plan.args).toEqual(expect.arrayContaining(['-r']));
  });

  it('forwards --resume to the harness', async () => {
    const plan = await parse(['--resume'], true);
    expect(plan.command).toBe('pi');
    expect(plan.args).toEqual(expect.arrayContaining(['--resume']));
  });

  it('preserves explicit agent selection', async () => {
    expect((await parse(['engineer'])).command).toBe('pi');
  });

  it('preserves Outfitter-owned run options', async () => {
    expect((await parse(['run', '--harness', 'pi'], true)).command).toBe('pi');
  });
});
