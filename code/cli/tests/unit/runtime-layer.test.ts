import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, expect, it } from 'vitest';

import { createRunAgentCommand, executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';

const roots: string[] = [];
const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-runtime-layer-'));
  roots.push(root);
  return root;
};
const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

// THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.1.12).
// YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
it('overlays repeatable invocation-only runtime layers in command-line order', async () => {
  const root = temporaryRoot();
  const home = join(root, 'home');
  const project = join(root, 'project');
  const first = join(root, 'first');
  const second = join(root, 'second');
  write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\nskills: [wiki]\n---\n');
  write(join(project, '.agents', 'skills', 'wiki', 'SKILL.md'), '---\nname: wiki\n---\n\nWorkspace.\n');
  write(join(first, 'skills', 'wiki', 'SKILL.md'), '---\nname: wiki\n---\n\nFirst runtime layer.\n');
  write(join(second, 'skills', 'wiki', 'SKILL.md'), '---\nname: wiki\n---\n\nSecond runtime layer.\n');
  const program = new Command();
  createRunAgentCommand({
    homeDirectory: home,
    projectDirectory: project,
    writeLine: () => {},
    launcher: (plan) => {
      const runtime = plan.env.PI_CODING_AGENT_DIR;
      expect(readFileSync(join(runtime, 'skills', 'wiki', 'SKILL.md'), 'utf8')).toContain('First runtime layer.');
      return Promise.resolve(0);
    },
  }).register(program);

  await program.parseAsync([
    'node',
    'outfitter',
    'run',
    'engineer',
    '--runtime-layer',
    first,
    '--runtime-layer',
    second,
  ]);

  expect(existsSync(join(project, '.agents', 'settings.yml'))).toBe(false);
  expect(readFileSync(join(first, 'skills', 'wiki', 'SKILL.md'), 'utf8')).toContain('First runtime layer.');
});

it('rejects a runtime layer that is not a directory', async () => {
  const root = temporaryRoot();

  await expect(
    executeRunAgentCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: join(root, 'project'),
      runtimeLayers: ['missing'],
      agent: 'engineer',
      launcher: () => Promise.resolve(0),
    }),
  ).rejects.toThrow("Runtime layer 'missing' is not a directory.");
});
