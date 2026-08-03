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

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { createRunAgentCommand, executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';

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

/** The path named by `--system-prompt` or `--system-prompt-file`, whichever the harness takes. */
const systemPromptArg = (args: readonly string[]): { readonly flag: string; readonly path: string } => {
  const index = args.findIndex((arg) => arg === '--system-prompt' || arg === '--system-prompt-file');
  return { flag: args[index], path: args[index + 1] };
};

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('append-prompt projection', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  //
  // Both Claude prompt flags take a prompt *string*, so a path arrives as literal text and the
  // document is silently dropped. The `-file` forms apply the contents. They are undocumented —
  // neither appears in `claude --help` — but both were verified against the shipped 2.1.x binary.
  it('names Claude prompt documents with the -file flags, and pi with the bare ones', async () => {
    const { home, project } = tree();

    for (const [harness, expected] of [
      ['claude', '--system-prompt-file'],
      ['pi', '--system-prompt'],
    ] as const) {
      const result = await executeRunAgentCommand({
        homeDirectory: home,
        projectDirectory: project,
        agent: 'engineer',
        harness,
        passThroughArgs: ['--print'],
        launcher: (plan) => {
          expect(systemPromptArg(plan.args).flag).toBe(expected);
          expect(readFileSync(systemPromptArg(plan.args).path, 'utf8')).toBe('SYSTEM');
          return Promise.resolve(0);
        },
      });

      expect(result.exitCode).toBe(0);
    }
  });

  it('rejects an unreadable --append-prompt path before launching, on either harness', async () => {
    const { home, project, root } = tree();
    const missing = join(root, 'absent.md');

    for (const harness of ['claude', 'pi'] as const) {
      let launched = false;
      // Rejects rather than returning, matching assertNoSettingsIssues; cli.ts prints the message
      // and exits 1. Without this the two harnesses fail differently — a raw ENOENT out of the
      // Claude concatenation, and a harness-generated error on pi, since pi opens the path itself.
      await expect(
        executeRunAgentCommand({
          homeDirectory: home,
          projectDirectory: project,
          agent: 'engineer',
          harness,
          appendPromptPaths: [missing],
          passThroughArgs: ['--print'],
          launcher: () => {
            launched = true;
            return Promise.resolve(0);
          },
        }),
      ).rejects.toThrow(`--append-prompt: not a readable file: ${missing}`);

      expect(launched).toBe(false);
    }
  });

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
        expect(readFileSync(files[0], 'utf8')).toBe('SHARED\n\nENGINEER BODY\n');
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

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.3.1 — "runtime passthrough append prompts",
  // the final element of the composition order).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
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
        expect(readFileSync(files[0], 'utf8')).toBe('SHARED\n\nENGINEER BODY\n\nORG CONTEXT\n\nROLE CONTEXT\n');
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
        // With a single newline these would merge into one Markdown block; `# Second` would
        // become a setext heading for the preceding line rather than its own heading.
        expect(composed).toContain('# First\n\n# Second\n');
        return Promise.resolve(0);
      },
    });

    expect(result.exitCode).toBe(0);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.1.9, OFTR-005.3.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  //
  // Enters through Commander rather than executeRunAgentCommand, so it covers the repeat collector,
  // the kebab-to-camel option name, and the interaction with allowUnknownOption plus the variadic
  // passthrough argument — none of which the direct-call tests exercise.
  it('collects repeated --append-prompt through the public Commander run path', async () => {
    const { home, project, root } = tree();
    const org = join(root, 'org.md');
    const role = join(root, 'role.md');
    write(org, 'ORG CONTEXT');
    write(role, 'ROLE CONTEXT');
    const program = new Command();
    let appended: readonly string[] = [];
    createRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      writeLine: () => undefined,
      launcher: (plan) => {
        appended = appendPaths(plan.args).map((path) => readFileSync(path, 'utf8'));
        return Promise.resolve(0);
      },
    }).register(program);

    await program.parseAsync([
      'node',
      'outfitter',
      'run',
      'engineer',
      '--harness',
      'pi',
      '--append-prompt',
      org,
      '--append-prompt',
      role,
      '--',
      '--print',
      'review this',
    ]);

    expect(appended).toEqual(['SHARED', 'ENGINEER BODY\n', 'ORG CONTEXT', 'ROLE CONTEXT']);
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
