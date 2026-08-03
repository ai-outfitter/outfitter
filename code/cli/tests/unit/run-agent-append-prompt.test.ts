// Tests harness-aware projection of append-prompt documents, and the --append-prompt run flag.
//
// pi and Claude Code take these documents through incompatible flags. Verified against the shipped
// binaries: pi's `--append-system-prompt` reads a file path and accumulates across repeats, while
// Claude's takes a prompt *string* — handed a path it appends the path text — and needs
// `--append-system-prompt-file`, which pi rejects outright, and keeps only the last occurrence.
// Emitting pi's form to Claude therefore drops every document without an error, which is what these
// tests exist to prevent regressing.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';

const roots: string[] = [];

const temporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-run-append-prompt-'));
  roots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const tree = (): { readonly home: string; readonly project: string; readonly root: string } => {
  const root = temporaryRoot();
  const project = join(root, 'project');
  write(join(project, '.agents', 'system-prompt.md'), 'SYSTEM');
  write(join(project, '.agents', 'agents.md'), 'SHARED');
  write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n\nENGINEER BODY\n');
  return { home: join(root, 'home'), project, root };
};

/** Paths named by each `--append-system-prompt`, in order. */
const appendPaths = (args: readonly string[]): readonly string[] =>
  args
    .map((arg, index) => (arg === '--append-system-prompt' ? args[index + 1] : undefined))
    .filter((path): path is string => path !== undefined);

/** Paths named by each `--append-system-prompt-file`, in order. */
const appendFilePaths = (args: readonly string[]): readonly string[] =>
  args
    .map((arg, index) => (arg === '--append-system-prompt-file' ? args[index + 1] : undefined))
    .filter((path): path is string => path !== undefined);

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('append-prompt projection', () => {
  it('gives Claude one --append-system-prompt-file over a concatenation, never a repeated flag', async () => {
    const { home, project } = tree();

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      passThroughArgs: ['--print'],
      launcher: (plan) => {
        // A bare --append-system-prompt would append the literal path and silently lose the content.
        expect(appendPaths(plan.args)).toEqual([]);

        const files = appendFilePaths(plan.args);
        expect(files).toHaveLength(1);
        // Repeats are last-wins on Claude, so every document has to arrive in the one file.
        expect(readFileSync(files[0], 'utf8')).toBe('SHARED\nENGINEER BODY\n\n');
        return Promise.resolve(0);
      },
    });

    expect(result.exitCode).toBe(0);
  });

  it('keeps pi on repeated --append-system-prompt, which it accumulates natively', async () => {
    const { home, project } = tree();

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'pi',
      passThroughArgs: ['--print'],
      launcher: (plan) => {
        expect(appendFilePaths(plan.args)).toEqual([]);
        expect(appendPaths(plan.args).map((path) => readFileSync(path, 'utf8'))).toEqual(['SHARED', 'ENGINEER BODY\n']);
        return Promise.resolve(0);
      },
    });

    expect(result.exitCode).toBe(0);
  });

  it('appends --append-prompt documents after the agent composition, in the order given', async () => {
    const { home, project, root } = tree();
    const org = join(root, 'org.md');
    const role = join(root, 'role.md');
    write(org, 'ORG CONTEXT');
    write(role, 'ROLE CONTEXT');

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'pi',
      appendPromptPaths: [org, role],
      passThroughArgs: ['--print'],
      launcher: (plan) => {
        expect(appendPaths(plan.args).map((path) => readFileSync(path, 'utf8'))).toEqual([
          'SHARED',
          'ENGINEER BODY\n',
          'ORG CONTEXT',
          'ROLE CONTEXT',
        ]);
        return Promise.resolve(0);
      },
    });

    expect(result.exitCode).toBe(0);
  });

  it('folds --append-prompt documents into the Claude concatenation in the same order', async () => {
    const { home, project, root } = tree();
    const org = join(root, 'org.md');
    const role = join(root, 'role.md');
    write(org, 'ORG CONTEXT');
    write(role, 'ROLE CONTEXT');

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      appendPromptPaths: [org, role],
      passThroughArgs: ['--print'],
      launcher: (plan) => {
        const files = appendFilePaths(plan.args);
        expect(files).toHaveLength(1);
        expect(readFileSync(files[0], 'utf8')).toBe('SHARED\nENGINEER BODY\n\nORG CONTEXT\nROLE CONTEXT\n');
        return Promise.resolve(0);
      },
    });

    expect(result.exitCode).toBe(0);
  });

  it('separates documents that lack a trailing newline', async () => {
    const { home, project, root } = tree();
    const first = join(root, 'first.md');
    const second = join(root, 'second.md');
    write(first, '# First');
    write(second, '# Second');

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      appendPromptPaths: [first, second],
      passThroughArgs: ['--print'],
      launcher: (plan) => {
        const composed = readFileSync(appendFilePaths(plan.args)[0], 'utf8');
        // Without the separator the two headings would glue into `# First# Second`.
        expect(composed).toContain('# First\n# Second\n');
        return Promise.resolve(0);
      },
    });

    expect(result.exitCode).toBe(0);
  });

  it('keeps passthrough arguments last so a caller can still override the harness', async () => {
    const { home, project, root } = tree();
    const persona = join(root, 'persona.md');
    write(persona, 'PERSONA');

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      appendPromptPaths: [persona],
      passThroughArgs: ['--print', 'review this'],
      launcher: (plan) => {
        expect(plan.args.slice(-2)).toEqual(['--print', 'review this']);
        return Promise.resolve(0);
      },
    });

    expect(result.exitCode).toBe(0);
  });
});
