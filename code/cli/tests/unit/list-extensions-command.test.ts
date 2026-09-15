// Tests the `outfitter list extensions` command surface: cache-state dispatch before resolver
// kinds, text and JSON rendering, offline handling (flag and PI_OFFLINE), --agent rejection, and
// strict fatality of report warnings — against a fixture cache under a temp home (never the real
// cache, never the network).
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { createListCommand } from '../../src/cli/commands/ListCommand.js';
import { resolveOutfitterCacheDir } from '../../src/paths/OutfitterCache.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  delete process.env.PI_OFFLINE;
});

const fixtureRoot = (): string => {
  const root = join(tmpdir(), `outfitter-list-ext-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
};

const homeWithCache = (): { readonly root: string; readonly home: string } => {
  const root = fixtureRoot();
  const home = join(root, 'home');
  const cache = join(resolveOutfitterCacheDir({}, home), 'pi-extensions');
  const npmRoot = join(cache, 'npm');
  mkdirSync(join(npmRoot, 'node_modules', 'hashline-pi'), { recursive: true });
  writeFileSync(
    join(npmRoot, 'package.json'),
    JSON.stringify({ name: 'pi-extensions', private: true, dependencies: { 'hashline-pi': '^0.1.1' } }),
  );
  writeFileSync(
    join(npmRoot, 'node_modules', 'hashline-pi', 'package.json'),
    JSON.stringify({ name: 'hashline-pi', version: '0.1.1' }),
  );
  return { root, home };
};

interface RunOptions {
  readonly args: readonly string[];
  readonly env?: Record<string, string>;
  readonly npmLatest?: (name: string) => string | undefined;
}

const runList = async (home: string, options: RunOptions): Promise<{ readonly lines: readonly string[] }> => {
  const lines: string[] = [];
  const program = new Command();
  createListCommand({
    homeDirectory: home,
    projectDirectory: join(fixtureRoot(), 'project'),
    writeLine: (message: string) => lines.push(message),
    extensionNpmLatest: options.npmLatest,
  }).register(program);
  const previous = process.env.PI_OFFLINE;
  for (const [key, value] of Object.entries(options.env ?? {})) process.env[key] = value;
  try {
    await program.parseAsync(['node', 'outfitter', 'list', ...options.args]);
  } finally {
    if (previous === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previous;
  }
  return { lines };
};

const runListExpectingError = async (home: string, options: RunOptions): Promise<Error> => {
  let thrown: Error | undefined;
  try {
    await runList(home, options);
  } catch (error) {
    thrown = error as Error;
  }
  expect(thrown).toBeDefined();
  return thrown!;
};

describe('list extensions command surface', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.34).
  // `outfitter list extensions` reports the cached packages with statuses, honors --offline and
  // PI_OFFLINE, rejects --agent, makes warnings fatal under --strict, and keeps other kinds intact.
  it('reports cached extensions as text lines under an extensions header', async () => {
    const { home } = homeWithCache();
    const { lines } = await runList(home, {
      args: ['extensions'],
      npmLatest: (name) => (name === 'hashline-pi' ? '0.1.1' : undefined),
    });
    expect(lines).toEqual(['extensions:', '  npm:hashline-pi@^0.1.1  0.1.1  up-to-date']);
  });

  it('reports (none) for an empty cache and exits 0', async () => {
    const root = fixtureRoot();
    const { lines } = await runList(join(root, 'home'), { args: ['extensions'], npmLatest: () => undefined });
    expect(lines).toEqual(['extensions:', '  (none)']);
  });

  it('emits stable JSON with ok, extensions, and diagnostics', async () => {
    const { home } = homeWithCache();
    const { lines } = await runList(home, {
      args: ['extensions', '--json'],
      npmLatest: (name) => (name === 'hashline-pi' ? '0.2.0' : undefined),
    });
    const parsed = JSON.parse(lines[0]) as {
      ok: boolean;
      extensions: readonly { specifier: string; status: string; statusDetail?: string }[];
      diagnostics: readonly string[];
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.extensions).toHaveLength(1);
    expect(parsed.extensions[0]).toMatchObject({
      specifier: 'npm:hashline-pi@^0.1.1',
      status: 'update-available',
      statusDetail: '0.2.0',
    });
    expect(parsed.diagnostics).toEqual([]);
  });
  it('honors --offline and skips upstream lookups', async () => {
    const { home } = homeWithCache();
    const { lines } = await runList(home, {
      args: ['extensions', '--offline'],
      npmLatest: () => {
        throw new Error('network must not be touched offline');
      },
    });
    expect(lines.join('\n')).toContain('npm:hashline-pi@^0.1.1  0.1.1  unknown (offline)');
  });

  it('honors the PI_OFFLINE environment variable', async () => {
    const { home } = homeWithCache();
    const { lines } = await runList(home, {
      args: ['extensions'],
      env: { PI_OFFLINE: '1' },
      npmLatest: () => {
        throw new Error('network must not be touched offline');
      },
    });
    expect(lines.join('\n')).toContain('unknown (offline)');
  });

  it('rejects --agent with an actionable error', async () => {
    const { home } = homeWithCache();
    const error = await runListExpectingError(home, {
      args: ['extensions', '--agent', 'engineer'],
      npmLatest: () => undefined,
    });
    expect(error.message).toContain("does not apply to 'extensions'");
  });

  it('makes lookup warnings fatal under --strict after printing the report', async () => {
    const previousExitCode = process.exitCode;
    const { home } = homeWithCache();
    try {
      const { lines } = await runList(home, {
        args: ['extensions', '--strict'],
        npmLatest: () => undefined,
      });
      expect(lines.join('\n')).toContain('warning:');
      expect(process.exitCode).toBe(1);
    } finally {
      process.exitCode = previousExitCode;
    }
  });

  it('renders git branch pins and unreadable versions in text lines', async () => {
    const root = fixtureRoot();
    const home = join(root, 'home');
    const cache = join(resolveOutfitterCacheDir({}, home), 'pi-extensions');
    const gitRoot = join(cache, 'git', 'github.com', 'user', 'repo');
    const git = (arguments_: readonly string[]): string =>
      execFileSync('git', [...arguments_], { cwd: gitRoot, encoding: 'utf8' }).trim();
    mkdirSync(gitRoot, { recursive: true });
    git(['init', '-q']);
    git(['config', 'user.email', 'fixture@example.com']);
    git(['config', 'user.name', 'Fixture']);
    writeFileSync(join(gitRoot, 'file.txt'), 'x');
    git(['add', '.']);
    git(['commit', '-qm', 'fixture']);
    const head = git(['rev-parse', 'HEAD']);
    writeFileSync(`${gitRoot}.outfitter-ref.json`, JSON.stringify({ ref: 'main', headSha: head }));
    const npmRoot = join(cache, 'npm');
    mkdirSync(join(npmRoot, 'node_modules', 'broken-pkg'), { recursive: true });
    writeFileSync(join(npmRoot, 'package.json'), JSON.stringify({ dependencies: { 'broken-pkg': '^1.0.0' } }));
    writeFileSync(join(npmRoot, 'node_modules', 'broken-pkg', 'package.json'), 'not json {');
    const { lines } = await runList(home, {
      args: ['extensions', '--offline'],
      npmLatest: () => undefined,
    });
    expect(lines).toEqual([
      'extensions:',
      '  npm:broken-pkg@^1.0.0  (unreadable)  unknown (offline)',
      `  git:github.com/user/repo@main  main @ ${head.slice(0, 7)}  unknown (offline)`,
    ]);
  });

  it('keeps the unknown-kind error message for non-extension kinds', async () => {
    const { home } = homeWithCache();
    const error = await runListExpectingError(home, { args: ['bogus'], npmLatest: () => undefined });
    expect(error.message).toContain("Unknown resource kind 'bogus'");
  });
});
