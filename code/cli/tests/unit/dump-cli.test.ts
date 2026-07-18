// Exercises the dump command object through Commander and covers copy/closure branches.
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createDumpCommand } from '../../src/cli/commands/DumpCommand.js';

const temporaryRoots: string[] = [];
let previousExitCode: typeof process.exitCode;

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-dumpcli-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

beforeEach(() => {
  previousExitCode = process.exitCode;
});

afterEach(() => {
  process.exitCode = previousExitCode;
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const program = (root: string, lines: string[]): Command => {
  const command = new Command();
  createDumpCommand({
    homeDirectory: join(root, 'home'),
    projectDirectory: join(root, 'project'),
    writeLine: (message) => lines.push(message),
  }).register(command);
  return command;
};

describe('dump command object', () => {
  it('dumps via parseAsync using default_agent, copying nested files and skipping inner symlinks', async () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(join(project, '.agents', 'settings.yml'), 'default_agent: engineer\n');
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\nmodel: m\n---\n\n# Engineer\n',
    );
    write(join(project, '.agents', 'agents', 'engineer', 'config.json'), '{"model":"m2"}'); // excluded from raw copy, remerged
    write(join(project, '.agents', 'agents', 'engineer', 'notes', 'deep.md'), 'deep'); // nested dir
    symlinkSync('/etc/hosts', join(project, '.agents', 'agents', 'engineer', 'link')); // inner symlink skipped
    const out = join(createTemporaryRoot(), 'out');
    const lines: string[] = [];

    await program(root, lines).parseAsync(['node', 'outfitter', 'dump', '--out', out]);

    expect(lines.join(' ')).toContain("Dumped 'engineer'");
    expect(existsSync(join(out, '.agents', 'agents', 'engineer', 'notes', 'deep.md'))).toBe(true);
    expect(existsSync(join(out, '.agents', 'agents', 'engineer', 'link'))).toBe(false);
    expect(process.exitCode).not.toBe(1);
  });

  it('sets a nonzero exit code and prints the error for an unknown agent', async () => {
    const root = createTemporaryRoot();
    write(join(root, 'project', '.agents', 'agents', 'x', 'agent.md'), '---\nname: x\n---\n\nBody.\n');
    const out = join(createTemporaryRoot(), 'out');
    const lines: string[] = [];

    await program(root, lines).parseAsync(['node', 'outfitter', 'dump', '--agent', 'ghost', '--out', out]);
    expect(process.exitCode).toBe(1);
    expect(lines.join(' ')).toContain("Unknown agent 'ghost'");
  });

  it('throws on invalid settings', async () => {
    const root = createTemporaryRoot();
    write(join(root, 'project', '.agents', 'settings.yml'), 'default_harness: bun\n');
    await expect(program(root, []).parseAsync(['node', 'outfitter', 'dump', '--agent', 'x'])).rejects.toThrow(
      /invalid settings/,
    );
  });

  it('collects a diamond subagent closure without revisiting shared members', async () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(join(project, '.agents', 'agents', 'lead', 'agent.md'), '---\nname: lead\nsubagents: [a, b]\n---\n\nBody.\n');
    write(join(project, '.agents', 'agents', 'a', 'agent.md'), '---\nname: a\nsubagents: [shared]\n---\n\nBody.\n');
    write(join(project, '.agents', 'agents', 'b', 'agent.md'), '---\nname: b\nsubagents: [shared]\n---\n\nBody.\n');
    write(join(project, '.agents', 'agents', 'shared', 'agent.md'), '---\nname: shared\n---\n\nBody.\n');
    const out = join(createTemporaryRoot(), 'out');
    const lines: string[] = [];

    await program(root, lines).parseAsync(['node', 'outfitter', 'dump', '--agent', 'lead', '--out', out]);
    expect(existsSync(join(out, '.agents', 'agents', 'shared', 'agent.md'))).toBe(true);
  });
});
