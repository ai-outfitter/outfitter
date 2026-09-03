// Exercises the link command object through Commander: harness selection, scope, apply, remove, strict.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLinkCommand } from '../../src/cli/commands/LinkCommand.js';
import type { HarnessCommandRunner } from '../../src/links/HarnessLinkApply.js';

const roots: string[] = [];
let previousExitCode: typeof process.exitCode;

const temporary = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-linkcli-'));
  roots.push(root);
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
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const noRunner: HarnessCommandRunner = () => ({ found: false, ok: false, output: '' });

const fixture = () => {
  const root = temporary();
  const home = join(root, 'home');
  const project = join(root, 'project');
  const tree = join(home, '.agents');
  mkdirSync(project, { recursive: true });
  write(join(tree, 'settings.yml'), 'default_agent: leader\n');
  write(join(tree, 'agents.md'), 'Shared.\n');
  write(join(tree, 'skills', 'review', 'SKILL.md'), '---\nname: review\n---\n');
  write(join(tree, 'agents', 'leader', 'agent.md'), '---\nname: leader\nskills: [review]\n---\n\n# Leader\n');
  return { root, home, project, tree };
};

const run = async (
  root: { home: string; project: string },
  args: string[],
  runner: HarnessCommandRunner = noRunner,
  env: Record<string, string | undefined> = {},
): Promise<string[]> => {
  const lines: string[] = [];
  const program = new Command();
  createLinkCommand({
    homeDirectory: root.home,
    projectDirectory: root.project,
    env,
    runHarnessCommand: runner,
    writeLine: (message) => lines.push(message),
  }).register(program);
  await program.parseAsync(['node', 'outfitter', 'link', ...args]);
  return lines;
};

describe('link command object', () => {
  it('refuses to guess a harness when none is installed and rejects unknown harnesses', async () => {
    const root = fixture();
    expect(await run(root, [], noRunner, { PATH: root.root })).toEqual([
      'error: No harness home found. Pass --harness <pi|claude|codex> to create one.',
    ]);
    expect(process.exitCode).toBe(1);
    const lines: string[] = [];
    const program = new Command();
    createLinkCommand({
      homeDirectory: root.home,
      projectDirectory: root.project,
      writeLine: (m) => lines.push(m),
    }).register(program);
    await program.parseAsync(['node', 'outfitter', 'link', '--harness', 'pi']);
    expect(lines).toContain('warning: pi has one native agent identity; composed agent identities are not linked.');

    const unknownLines: string[] = [];
    const unknownProgram = new Command();
    createLinkCommand({
      homeDirectory: root.home,
      projectDirectory: root.project,
      env: { PATH: root.root },
      run: noRunner,
      writeLine: (message) => unknownLines.push(message),
    }).register(unknownProgram);
    await unknownProgram.parseAsync(['node', 'outfitter', 'link', '--harness', 'unknown']);
    expect(unknownLines).toEqual(["error: Unknown harness 'unknown'. link supports: pi, claude, codex."]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.11.6, OFTR-012.1.1, OFTR-012.1.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('links harness_defaults into the selected native harness home', async () => {
    const root = fixture();
    write(
      join(root.tree, 'settings.yml'),
      'default_agent: leader\nharness_defaults:\n  pi:\n    httpIdleTimeoutMs: 3600000\n',
    );

    const lines = await run(root, ['--harness', 'pi']);

    expect(lines).toContain('pi: created setting:settings.json:httpIdleTimeoutMs');
    expect(JSON.parse(readFileSync(join(root.home, '.pi', 'agent', 'settings.json'), 'utf8'))).toEqual({
      httpIdleTimeoutMs: 3600000,
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-012.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('links every installed harness by default and honors harness home overrides', async () => {
    const root = fixture();
    mkdirSync(join(root.home, '.claude'));
    const codexHome = join(root.root, 'codex-home');
    mkdirSync(codexHome);
    const lines = await run(root, [], noRunner, { CODEX_HOME: codexHome });
    expect(lines).toEqual([
      `claude: created CLAUDE.md -> ${join(root.tree, 'agents.md')}`,
      `claude: created skills/review -> ${join(root.tree, 'skills', 'review')}`,
      'claude: created agents/leader.md',
      `claude (${join(root.home, '.claude')}): 3 created`,
      'warning: codex has no native agent definitions; identities for leader are not linked.',
      `codex: created AGENTS.md -> ${join(root.tree, 'agents.md')}`,
      `codex: created skills/review -> ${join(root.tree, 'skills', 'review')}`,
      `codex (${codexHome}): 2 created`,
    ]);
    expect(readlinkSync(join(codexHome, 'skills', 'review'))).toBe(join(root.tree, 'skills', 'review'));
    expect(process.exitCode).toBe(previousExitCode);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-012.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('previews with --dry-run, relinks idempotently, and removes with --remove', async () => {
    const root = fixture();
    const preview = await run(root, ['--harness', 'claude', '--harness', 'claude', '--dry-run']);
    expect(preview[0]).toBe(`claude: would create CLAUDE.md -> ${join(root.tree, 'agents.md')}`);
    expect(existsSync(join(root.home, '.claude'))).toBe(false);
    await run(root, ['--harness', 'claude']);
    const again = await run(root, ['--harness', 'claude', '--agent', 'leader']);
    expect(again.at(-1)).toBe(`claude (${join(root.home, '.claude')}): 3 unchanged`);
    const removed = await run(root, ['--harness', 'claude', '--remove']);
    expect(removed).toEqual([
      `claude: removed CLAUDE.md -> ${join(root.tree, 'agents.md')}`,
      `claude: removed skills/review -> ${join(root.tree, 'skills', 'review')}`,
      'claude: removed agents/leader.md',
      `claude (${join(root.home, '.claude')}): 3 removed`,
    ]);
    expect(await run(root, ['--harness', 'claude', '--remove'])).toEqual([
      `claude (${join(root.home, '.claude')}): nothing to do`,
    ]);
  });

  it('describes updates, prunes, and conflicts in a dry run', async () => {
    const root = fixture();
    await run(root, ['--harness', 'claude']);
    write(join(root.project, '.agents', 'skills', 'review', 'SKILL.md'), '---\nname: review\n---\n');
    rmSync(join(root.tree, 'agents.md'));
    rmSync(join(root.home, '.claude', 'agents', 'leader.md'));
    mkdirSync(join(root.home, '.claude', 'agents', 'leader.md'));
    const lines = await run(root, ['--harness', 'claude', '--dry-run']);
    expect(lines.slice(1)).toEqual([
      `claude: would update skills/review -> ${join(root.project, '.agents', 'skills', 'review')}`,
      'claude: conflict agents/leader.md (an unmanaged symlink or directory already exists here)',
      `claude: would prune CLAUDE.md -> ${join(root.tree, 'agents.md')} (target no longer exists)`,
      `claude (${join(root.home, '.claude')}): 1 updated, 1 conflict, 1 pruned`,
    ]);
    expect(readlinkSync(join(root.home, '.claude', 'skills', 'review'))).toBe(join(root.tree, 'skills', 'review'));
  });

  it('fails on scope and composition errors, invalid settings, and strict warnings', async () => {
    const root = fixture();
    expect(await run(root, ['--harness', 'claude', '--agent', 'ghost'])).toEqual([
      "error: Unknown agent 'ghost'. Run 'outfitter list agents' to see resolvable agents.",
    ]);
    expect(process.exitCode).toBe(1);
    write(join(root.tree, 'agents', 'broken', 'agent.md'), '---\nname: broken\ninherits: [missing]\n---\n');
    const composition = await run(root, ['--harness', 'claude', '--agent', 'broken']);
    expect(composition[0]).toContain('error:');
    process.exitCode = previousExitCode;
    const strict = await run(root, ['--harness', 'codex', '--strict']);
    expect(strict[0]).toContain('warning: codex has no native agent definitions');
    expect(process.exitCode).toBe(1);
    write(join(root.tree, 'settings.yml'), 'default_agent: 7\n');
    await expect(run(root, ['--harness', 'claude'])).rejects.toThrow('Cannot link with invalid settings');
  });

  it('treats ambiguous sources as fatal only under --strict', async () => {
    const root = fixture();
    write(join(root.project, '.agents', 'skills', 'review', 'SKILL.md'), '---\nname: review\n---\n');
    const lenient = await run(root, ['--harness', 'claude']);
    expect(lenient[0]).toContain('warning: Ambiguous skill slug');
    expect(lenient.at(-1)).toBe(`claude (${join(root.home, '.claude')}): 3 created`);
    const strict = await run(root, ['--harness', 'claude', '--strict']);
    expect(strict.at(-1)).toContain('error:');
    expect(process.exitCode).toBe(1);
  });
});
