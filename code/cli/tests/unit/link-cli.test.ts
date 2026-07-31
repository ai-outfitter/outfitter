// Exercises `outfitter link` end to end against an isolated home, through Commander.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createLinkCommand, executeLinkCommand } from '../../src/cli/commands/LinkCommand.js';

/** Hook-bearing settings documents, so parsed JSON is typed instead of `any`. */
interface HookSettings {
  readonly hooks: Readonly<Record<string, readonly unknown[]>>;
  readonly [key: string]: unknown;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

/** The shape `outfitter link --json` emits. */
interface LinkJson {
  readonly ok: boolean;
  readonly applied: Readonly<Record<string, number>>;
  readonly plan: { readonly harnesses: readonly string[] };
}

const temporaryRoots: string[] = [];
let previousExitCode: typeof process.exitCode;

const createRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-linkcli-'));
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

/** A home with one skill, one command, an AGENTS.md, and an existing Claude config directory. */
const createCatalogHome = (settingsYaml: string): { readonly home: string; readonly project: string } => {
  const root = createRoot();
  const home = join(root, 'home');
  const project = join(root, 'project');

  write(join(home, '.agents', 'settings.yml'), settingsYaml);
  write(join(home, '.agents', 'AGENTS.md'), '# Global guidance\n');
  write(join(home, '.agents', 'skills', 'research', 'SKILL.md'), '---\nname: research\n---\n\n# Research\n');
  write(join(home, '.agents', 'commands', 'review.md'), '---\ndescription: Review\n---\nDo the review.\n');
  mkdirSync(join(home, '.claude'), { recursive: true });
  mkdirSync(project, { recursive: true });

  return { home, project };
};

const run = (
  home: string,
  project: string,
  overrides: Partial<Parameters<typeof executeLinkCommand>[0]> = {},
): ReturnType<typeof executeLinkCommand> =>
  executeLinkCommand({
    homeDirectory: home,
    projectDirectory: project,
    env: { XDG_STATE_HOME: join(home, 'state') },
    ...overrides,
  });

describe('outfitter link', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.5.1, OFTR-011.5.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('provisions detected harnesses from the catalog and skips uninstalled ones', () => {
    const { home, project } = createCatalogHome('harnesses:\n  link: detected\n');

    const result = run(home, project);

    expect(result.ok).toBe(true);
    expect(readlinkSync(join(home, '.claude', 'skills', 'research'))).toBe(join(home, '.agents', 'skills', 'research'));
    expect(readlinkSync(join(home, '.claude', 'commands', 'review.md'))).toBe(
      join(home, '.agents', 'commands', 'review.md'),
    );
    expect(readlinkSync(join(home, '.claude', 'CLAUDE.md'))).toBe(join(home, '.agents', 'AGENTS.md'));
    // Gemini was never installed in this home, so nothing was created for it.
    expect(existsSync(join(home, '.gemini'))).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.3.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('is idempotent: a second run reports everything unchanged', () => {
    const { home, project } = createCatalogHome('harnesses:\n  link: [claude]\n');

    run(home, project);
    const second = run(home, project);

    expect(second.ok).toBe(true);
    expect(second.messages.join('\n')).toContain('(already up to date)');
    expect(second.messages.join('\n')).toContain('0 created, 0 updated');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.3.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('does not rewrite a harness settings file when the merged hooks are unchanged', () => {
    const { home, project } = createCatalogHome(
      'harnesses:\n  link: [claude]\n  hooks:\n    - event: before_tool\n      command: guard.sh\n',
    );

    run(home, project);
    const settingsPath = join(home, '.claude', 'settings.json');
    const afterFirst = readFileSync(settingsPath, 'utf8');
    const mtimeAfterFirst = statSync(settingsPath).mtimeMs;

    const second = run(home, project);

    expect(readFileSync(settingsPath, 'utf8')).toBe(afterFirst);
    expect(statSync(settingsPath).mtimeMs).toBe(mtimeAfterFirst);
    expect(second.messages.join('\n')).toContain('(already up to date)');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.5.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('provisions a second config directory declared in settings', () => {
    const { home, project } = createCatalogHome(
      'harnesses:\n  claude:\n    enabled: true\n    resources: [skills]\n    config_directories: ["~/.claude", "~/.claude-work"]\n',
    );

    run(home, project);

    expect(existsSync(join(home, '.claude', 'skills', 'research'))).toBe(true);
    expect(existsSync(join(home, '.claude-work', 'skills', 'research'))).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.4.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('generates Gemini TOML commands rather than symlinking Markdown', () => {
    const { home, project } = createCatalogHome('harnesses:\n  link: [gemini]\n');

    run(home, project);

    const generated = readFileSync(join(home, '.gemini', 'commands', 'review.toml'), 'utf8');
    expect(generated).toContain('description = "Review"');
    expect(generated).toContain('prompt = "Do the review."');
    // Skills still take a live symlink on the same harness.
    expect(readlinkSync(join(home, '.gemini', 'skills', 'research'))).toBe(join(home, '.agents', 'skills', 'research'));
  });

  it('translates settings hooks into each harness native schema', () => {
    const { home, project } = createCatalogHome(
      'harnesses:\n  link: [claude, gemini]\n  hooks:\n    - event: before_tool\n      matcher: Bash\n      command: guard.sh\n',
    );

    run(home, project);

    expect(readJson<HookSettings>(join(home, '.claude', 'settings.json')).hooks).toHaveProperty('PreToolUse');
    expect(readJson<HookSettings>(join(home, '.gemini', 'settings.json')).hooks).toHaveProperty('BeforeTool');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.2.3, OFTR-011.2.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('refuses to replace an unmanaged path until --force, and exits non-zero', () => {
    const { home, project } = createCatalogHome('harnesses:\n  claude:\n    enabled: true\n    resources: [skills]\n');
    write(join(home, '.claude', 'skills', 'research'), 'hand written');

    const conflicted = run(home, project);
    expect(conflicted.ok).toBe(false);
    expect(conflicted.messages.join('\n')).toContain('Conflicting paths were left untouched');
    expect(readFileSync(join(home, '.claude', 'skills', 'research'), 'utf8')).toBe('hand written');

    const forced = run(home, project, { force: true });
    expect(forced.ok).toBe(true);
    expect(readlinkSync(join(home, '.claude', 'skills', 'research'))).toBe(join(home, '.agents', 'skills', 'research'));
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.3.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('writes nothing under --dry-run, including the manifest', () => {
    const { home, project } = createCatalogHome('harnesses:\n  link: [claude]\n');

    const result = run(home, project, { dryRun: true });

    expect(result.messages.join('\n')).toContain('dry run — nothing written');
    expect(existsSync(join(home, '.claude', 'skills', 'research'))).toBe(false);
    expect(existsSync(join(home, 'state', 'outfitter', 'links.json'))).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.3.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('prunes a link whose skill was deleted from the catalog', () => {
    const { home, project } = createCatalogHome('harnesses:\n  link: [claude]\n');
    run(home, project);

    rmSync(join(home, '.agents', 'skills', 'research'), { recursive: true, force: true });
    const pruned = run(home, project);

    expect(pruned.ok).toBe(true);
    expect(existsSync(join(home, '.claude', 'skills', 'research'))).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.3.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('removes every managed path and forgets the manifest under --remove', () => {
    const { home, project } = createCatalogHome('harnesses:\n  link: [claude]\n');
    run(home, project);

    const removed = run(home, project, { remove: true });

    expect(removed.ok).toBe(true);
    expect(existsSync(join(home, '.claude', 'skills', 'research'))).toBe(false);
    expect(existsSync(join(home, '.claude', 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(home, 'state', 'outfitter', 'links.json'))).toBe(false);
    // The harness config directory itself is left in place.
    expect(existsSync(join(home, '.claude'))).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.3.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('strips its own hook entries on --remove without deleting the settings file', () => {
    const { home, project } = createCatalogHome(
      'harnesses:\n  link: [claude]\n  hooks:\n    - event: before_tool\n      command: guard.sh\n',
    );
    const settingsPath = join(home, '.claude', 'settings.json');
    writeFileSync(
      settingsPath,
      JSON.stringify({
        model: 'opus',
        hooks: { PreToolUse: [{ matcher: 'Write', hooks: [{ type: 'command', command: 'mine.sh' }] }] },
      }),
    );

    run(home, project);
    expect(readFileSync(settingsPath, 'utf8')).toContain('guard.sh');

    run(home, project, { remove: true });

    const document = readFileSync(settingsPath, 'utf8');
    expect(existsSync(settingsPath)).toBe(true);
    expect(document).not.toContain('guard.sh');
    expect(document).toContain('mine.sh');
    expect(document).toContain('"opus"');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.3.7).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('strips hook entries whose declaration was withdrawn from settings', () => {
    const { home, project } = createCatalogHome(
      'harnesses:\n  link: [claude]\n  hooks:\n    - event: before_tool\n      command: guard.sh\n',
    );
    run(home, project);
    expect(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')).toContain('guard.sh');

    writeFileSync(join(home, '.agents', 'settings.yml'), 'harnesses:\n  link: [claude]\n');
    run(home, project);

    expect(readFileSync(join(home, '.claude', 'settings.json'), 'utf8')).not.toContain('guard.sh');
  });

  it('narrows the settings selection with --harness without editing settings', () => {
    const { home, project } = createCatalogHome('harnesses:\n  link: [claude, gemini]\n');

    run(home, project, { harnesses: ['gemini'] });

    expect(existsSync(join(home, '.gemini', 'skills', 'research'))).toBe(true);
    expect(existsSync(join(home, '.claude', 'skills', 'research'))).toBe(false);
  });

  it('lets --harness override a settings-level enabled flag', () => {
    const { home, project } = createCatalogHome(
      'harnesses:\n  link: none\n  claude:\n    enabled: true\n  gemini:\n    enabled: true\n',
    );

    run(home, project, { harnesses: ['gemini'] });

    expect(existsSync(join(home, '.gemini', 'skills', 'research'))).toBe(true);
    expect(existsSync(join(home, '.claude', 'skills', 'research'))).toBe(false);
  });

  it('reports that nothing was selected when no harness applies', () => {
    const { home, project } = createCatalogHome('harnesses:\n  link: none\n');

    const result = run(home, project);

    expect(result.ok).toBe(true);
    expect(result.messages.join('\n')).toContain('No harnesses selected');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.1.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns on an unsupported combination and fails it only under --strict', () => {
    const { home, project } = createCatalogHome(
      'harnesses:\n  copilot:\n    enabled: true\n    resources: [instructions]\n',
    );

    const warned = run(home, project);
    expect(warned.ok).toBe(true);
    expect(warned.messages.join('\n')).toContain("'instructions' is not a supported surface");

    expect(run(home, project, { strict: true }).ok).toBe(false);
  });

  it('emits machine-readable output under --json', () => {
    const { home, project } = createCatalogHome('harnesses:\n  link: [claude]\n');

    const parsed = JSON.parse(run(home, project, { json: true }).messages[0] ?? '{}') as LinkJson;

    expect(parsed.ok).toBe(true);
    expect(parsed.applied).toMatchObject({ conflicts: 0 });
    expect(parsed.plan.harnesses).toEqual(['claude']);
  });

  it('reports settings errors and links nothing', () => {
    const { home, project } = createCatalogHome('harnesses:\n  link: [not-a-harness]\n');

    const result = run(home, project);

    expect(result.ok).toBe(false);
    expect(result.messages.join('\n')).toContain('harnesses');
    expect(existsSync(join(home, '.claude', 'skills', 'research'))).toBe(false);
  });

  it('surfaces unsynchronized remote source guidance alongside the plan', () => {
    const { home, project } = createCatalogHome('harnesses:\n  link: [claude]\nsources:\n  - github: acme/catalog\n');

    expect(run(home, project).messages.join('\n')).toContain("Run 'outfitter sync'");
  });
  it('skips the instructions link when the catalog has no AGENTS.md', () => {
    const { home, project } = createCatalogHome('harnesses:\n  link: [claude]\n');
    rmSync(join(home, '.agents', 'AGENTS.md'), { force: true });

    const result = run(home, project);

    expect(result.ok).toBe(true);
    expect(existsSync(join(home, '.claude', 'CLAUDE.md'))).toBe(false);
    expect(existsSync(join(home, '.claude', 'skills', 'research'))).toBe(true);
  });
});

describe('link command object', () => {
  it('registers and runs through Commander, honoring --dry-run', async () => {
    const { home, project } = createCatalogHome('harnesses:\n  link: [claude]\n');
    const lines: string[] = [];
    const program = new Command();
    createLinkCommand({
      homeDirectory: home,
      projectDirectory: project,
      env: { XDG_STATE_HOME: join(home, 'state') },
      writeLine: (message) => lines.push(message),
    }).register(program);

    await program.parseAsync(['node', 'outfitter', 'link', '--dry-run']);

    expect(lines.join('\n')).toContain('dry run — nothing written');
    expect(existsSync(join(home, '.claude', 'skills', 'research'))).toBe(false);
  });

  it('accepts a comma-separated --harness list', async () => {
    const { home, project } = createCatalogHome('harnesses:\n  link: [claude, gemini, codex]\n');
    const lines: string[] = [];
    const program = new Command();
    createLinkCommand({
      homeDirectory: home,
      projectDirectory: project,
      env: { XDG_STATE_HOME: join(home, 'state') },
      writeLine: (message) => lines.push(message),
    }).register(program);

    await program.parseAsync(['node', 'outfitter', 'link', '--harness', 'gemini, codex']);

    expect(existsSync(join(home, '.gemini', 'skills', 'research'))).toBe(true);
    expect(existsSync(join(home, '.codex', 'skills', 'research'))).toBe(true);
    expect(existsSync(join(home, '.claude', 'skills', 'research'))).toBe(false);
  });

  it('rejects an unknown harness name', async () => {
    const { home, project } = createCatalogHome('harnesses:\n  link: [claude]\n');
    const program = new Command();
    createLinkCommand({
      homeDirectory: home,
      projectDirectory: project,
      env: { XDG_STATE_HOME: join(home, 'state') },
      writeLine: () => undefined,
    }).register(program);

    await expect(program.parseAsync(['node', 'outfitter', 'link', '--harness', 'emacs'])).rejects.toThrow(
      /Unknown harness/u,
    );
  });

  it('sets a non-zero exit code when the run is not ok', async () => {
    const { home, project } = createCatalogHome('harnesses:\n  claude:\n    enabled: true\n    resources: [skills]\n');
    write(join(home, '.claude', 'skills', 'research'), 'hand written');
    const program = new Command();
    createLinkCommand({
      homeDirectory: home,
      projectDirectory: project,
      env: { XDG_STATE_HOME: join(home, 'state') },
      writeLine: () => undefined,
    }).register(program);

    await program.parseAsync(['node', 'outfitter', 'link']);

    expect(process.exitCode).toBe(1);
  });
});
