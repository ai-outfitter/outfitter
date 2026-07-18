// Exercises the list/validate command objects through Commander parseAsync (the user-facing path).
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createListCommand } from '../../src/cli/commands/ListCommand.js';
import { createValidateCommand, executeValidateCommand } from '../../src/cli/commands/ValidateCommand.js';

const temporaryRoots: string[] = [];
let previousExitCode: typeof process.exitCode;

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-cli-'));
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

const project = (): string => {
  const root = createTemporaryRoot();
  write(
    join(root, 'project', '.agents', 'agents', 'engineer', 'agent.md'),
    '---\nname: engineer\nskills: [ghost]\n---\n\nBody.\n',
  );
  return root;
};

const buildProgram = (root: string, lines: string[]): Command => {
  const program = new Command();
  const deps = {
    homeDirectory: join(root, 'home'),
    projectDirectory: join(root, 'project'),
    writeLine: (message: string) => lines.push(message),
  };
  createListCommand(deps).register(program);
  createValidateCommand(deps).register(program);
  return program;
};

describe('resolver command objects', () => {
  it('list forwards the positional kind and writes through the injected writer', async () => {
    const lines: string[] = [];
    await buildProgram(project(), lines).parseAsync(['node', 'outfitter', 'list', 'agents']);
    expect(lines.join('\n')).toContain('engineer  [workspace]');
  });

  it('validate forwards --strict/--json and sets a nonzero exit code on failure', async () => {
    const lines: string[] = [];
    await buildProgram(project(), lines).parseAsync(['node', 'outfitter', 'validate', '--json']);
    // The engineer agent references an unknown skill, so validation fails.
    expect(process.exitCode).toBe(1);
    expect(lines[0]).toContain('"ok": false');
    expect(lines[0]).toContain('ghost');
  });

  it('surfaces invalid settings: list throws, validate reports a finding', async () => {
    const root = createTemporaryRoot();
    write(join(root, 'project', '.agents', 'settings.yml'), 'default_harness: bun\n');
    const lines: string[] = [];

    await expect(buildProgram(root, lines).parseAsync(['node', 'outfitter', 'list'])).rejects.toThrow(
      /invalid settings/,
    );

    const validation = executeValidateCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: join(root, 'project'),
    });
    expect(validation.ok).toBe(false);
    expect(validation.findings.some((f) => f.resource === 'settings')).toBe(true);
  });

  it('reports a clean validation when nothing is wrong', () => {
    const root = createTemporaryRoot();
    write(join(root, 'project', '.agents', 'agents', 'ok', 'agent.md'), '---\nname: ok\n---\n\nBody.\n');
    const result = executeValidateCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: join(root, 'project'),
    });
    expect(result.ok).toBe(true);
    expect(result.messages).toContain('✓ No issues found.');
  });

  it('validate through parseAsync prints clean text output and leaves the exit code unset', async () => {
    const root = createTemporaryRoot();
    write(join(root, 'project', '.agents', 'agents', 'ok', 'agent.md'), '---\nname: ok\n---\n\nBody.\n');
    const lines: string[] = [];
    await buildProgram(root, lines).parseAsync(['node', 'outfitter', 'validate']);
    expect(lines.join('\n')).toContain('✓ No issues found.');
    expect(process.exitCode).not.toBe(1);
  });
});
