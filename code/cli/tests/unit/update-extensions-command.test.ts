// Tests the `outfitter update extensions` command surface: kind dispatch and unknown-kind
// rejection, text summary shape, the JSON contract, --offline and PI_OFFLINE handling, --dry-run,
// and exit-code semantics (failed entries and strict warnings) — against a fixture cache under a
// temp home with injected seams (never the real cache, never the network).
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import { createUpdateCommand } from '../../src/cli/commands/UpdateCommand.js';
import type { PiInstallSpawner } from '../../src/extensions/PiExtensionCache.js';
import type { PiPeerSpawner } from '../../src/extensions/PiExtensionPeers.js';
import { resolveOutfitterCacheDir } from '../../src/paths/OutfitterCache.js';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  delete process.env.PI_OFFLINE;
});

const fixtureRoot = (): string => {
  const root = join(tmpdir(), `outfitter-update-ext-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });
  roots.push(root);
  return root;
};

const installNpmFixture = (
  home: string,
  name: string,
  requested: string,
  resolved: string,
  manifest: Record<string, unknown> = {},
): void => {
  const npmRoot = join(resolveOutfitterCacheDir({}, home), 'pi-extensions', 'npm');
  mkdirSync(join(npmRoot, 'node_modules', ...name.split('/')), { recursive: true });
  writeFileSync(
    join(npmRoot, 'package.json'),
    JSON.stringify({ name: 'pi-extensions', private: true, dependencies: { [name]: requested } }),
  );
  writeFileSync(
    join(npmRoot, 'node_modules', ...name.split('/'), 'package.json'),
    JSON.stringify({ name, version: resolved, ...manifest }),
  );
};

/** Spawning install seam: rewrites the installed manifest to the requested exact version. */
const installingSpawn = (): PiInstallSpawner => {
  return (request) => {
    const match = /^npm:(.+)@(.+)$/u.exec(request.source);
    if (match === null) return Promise.resolve(1);
    const manifestPath = join(request.cacheAgentDir, 'npm', 'node_modules', ...match[1].split('/'), 'package.json');
    try {
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown as { version?: string };
      writeFileSync(manifestPath, JSON.stringify({ ...manifest, version: match[2] }));
      return Promise.resolve(0);
    } catch {
      return Promise.resolve(1);
    }
  };
};

interface RunOptions {
  readonly args: readonly string[];
  readonly env?: Record<string, string>;
  readonly npmLatest?: (name: string) => string | undefined;
  readonly spawn?: PiInstallSpawner;
  readonly peerSpawn?: PiPeerSpawner;
}

interface RunOutcome {
  readonly lines: readonly string[];
  readonly exitCode: number;
}

const runUpdate = async (home: string, options: RunOptions): Promise<RunOutcome> => {
  const lines: string[] = [];
  const program = new Command();
  createUpdateCommand({
    homeDirectory: home,
    writeLine: (message: string) => lines.push(message),
    npmLatest: options.npmLatest,
    spawn: options.spawn,
    peerSpawn: options.peerSpawn,
  }).register(program);
  const previous = process.env.PI_OFFLINE;
  for (const [key, value] of Object.entries(options.env ?? {})) process.env[key] = value;
  process.exitCode = 0;
  try {
    await program.parseAsync(['node', 'outfitter', 'update', ...options.args]);
  } finally {
    if (previous === undefined) delete process.env.PI_OFFLINE;
    else process.env.PI_OFFLINE = previous;
  }
  return { lines, exitCode: process.exitCode ?? 0 };
};

const runUpdateExpectingError = async (home: string, options: RunOptions): Promise<Error> => {
  let thrown: Error | undefined;
  try {
    await runUpdate(home, options);
  } catch (error) {
    thrown = error as Error;
  }
  expect(thrown).toBeDefined();
  return thrown!;
};

describe('update extensions command surface', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.35).
  // `outfitter update extensions` prints a deterministic summary table with from -> to transitions
  // and one status per entry, without requiring settings or a project.
  it('prints the update summary with from -> to transitions and statuses', async () => {
    const root = fixtureRoot();
    const home = join(root, 'home');
    installNpmFixture(home, 'hashline-pi', '^0.1.0', '0.1.0');
    const { lines } = await runUpdate(home, {
      args: ['extensions'],
      npmLatest: (name) => (name === 'hashline-pi' ? '0.1.1' : undefined),
      spawn: installingSpawn(),
    });
    expect(lines).toEqual(['extensions update:', '  npm:hashline-pi@^0.1.0  0.1.0 -> 0.1.1  updated']);
  });

  it('reports (none) for an empty cache and exits 0', async () => {
    const root = fixtureRoot();
    const { lines, exitCode } = await runUpdate(join(root, 'home'), {
      args: ['extensions'],
      npmLatest: () => undefined,
    });
    expect(lines).toEqual(['extensions update:', '  (none)']);
    expect(exitCode).toBe(0);
  });

  it('rejects kinds other than extensions with an actionable error', async () => {
    const root = fixtureRoot();
    const error = await runUpdateExpectingError(join(root, 'home'), {
      args: ['skills'],
      npmLatest: () => undefined,
    });
    expect(error.message).toContain('extensions');
  });

  it('rejects a missing kind argument with an actionable error', async () => {
    const root = fixtureRoot();
    const error = await runUpdateExpectingError(join(root, 'home'), { args: [], npmLatest: () => undefined });
    expect(error.message).toContain('extensions');
  });

  it('renders an unreadable install as (unreadable) with a failure status', async () => {
    const root = fixtureRoot();
    const home = join(root, 'home');
    const npmRoot = join(resolveOutfitterCacheDir({}, home), 'pi-extensions', 'npm');
    mkdirSync(npmRoot, { recursive: true });
    writeFileSync(
      join(npmRoot, 'package.json'),
      JSON.stringify({ name: 'pi-extensions', private: true, dependencies: { 'ghost-pkg': '^1.0.0' } }),
    );
    const { lines, exitCode } = await runUpdate(home, {
      args: ['extensions'],
      npmLatest: (name) => (name === 'ghost-pkg' ? '1.1.0' : undefined),
      spawn: installingSpawn(),
    });
    expect(lines).toEqual(['extensions update:', '  npm:ghost-pkg@^1.0.0  (unreadable)  failed (unreadable install)']);
    expect(exitCode).toBe(1);
  });

  it('emits stable JSON with ok, dryRun, updates, and diagnostics', async () => {
    const root = fixtureRoot();
    const home = join(root, 'home');
    installNpmFixture(home, 'hashline-pi', '^0.1.0', '0.1.0');
    const { lines } = await runUpdate(home, {
      args: ['extensions', '--json'],
      npmLatest: (name) => (name === 'hashline-pi' ? '0.1.1' : undefined),
      spawn: installingSpawn(),
    });
    const parsed = JSON.parse(lines[0]) as {
      ok: boolean;
      dryRun: boolean;
      updates: readonly { specifier: string; from?: string; to?: string; status: string }[];
      diagnostics: readonly string[];
    };
    expect(parsed.ok).toBe(true);
    expect(parsed.dryRun).toBe(false);
    expect(parsed.updates[0]).toMatchObject({
      specifier: 'npm:hashline-pi@^0.1.0',
      from: '0.1.0',
      to: '0.1.1',
      status: 'updated',
    });
    expect(parsed.diagnostics).toEqual([]);
  });

  it('skips every lookup and mutation offline via the flag and PI_OFFLINE', async () => {
    const root = fixtureRoot();
    const home = join(root, 'home');
    installNpmFixture(home, 'hashline-pi', '^0.1.0', '0.1.0');
    const offlineRuns: readonly RunOptions[] = [
      { args: ['extensions', '--offline'], env: {} },
      { args: ['extensions'], env: { PI_OFFLINE: '1' } },
      { args: ['extensions'], env: { PI_OFFLINE: 'true' } },
    ];
    for (const options of offlineRuns) {
      let consulted = false;
      const { lines, exitCode } = await runUpdate(home, {
        ...options,
        npmLatest: () => {
          consulted = true;
          return '9.9.9';
        },
        spawn: () => Promise.reject(new Error('must not spawn')),
      });
      expect(lines).toEqual(['extensions update:', '  npm:hashline-pi@^0.1.0  0.1.0  offline']);
      expect(exitCode).toBe(0);
      expect(consulted).toBe(false);
    }
  });

  it('reports would-update targets in dry-run without spawning installs', async () => {
    const root = fixtureRoot();
    const home = join(root, 'home');
    installNpmFixture(home, 'hashline-pi', '^0.1.0', '0.1.0');
    const { lines } = await runUpdate(home, {
      args: ['extensions', '--dry-run'],
      npmLatest: (name) => (name === 'hashline-pi' ? '0.2.0' : undefined),
      spawn: () => Promise.reject(new Error('must not spawn')),
    });
    expect(lines).toEqual([
      'extensions update:',
      '  (dry run — no changes were written)',
      '  npm:hashline-pi@^0.1.0  0.1.0  would-update (to 0.2.0)',
    ]);
  });

  it('exits non-zero when an entry fails', async () => {
    const root = fixtureRoot();
    const home = join(root, 'home');
    installNpmFixture(home, 'hashline-pi', '^0.1.0', '0.1.0');
    const { lines, exitCode } = await runUpdate(home, {
      args: ['extensions'],
      npmLatest: (name) => (name === 'hashline-pi' ? '0.2.0' : undefined),
      spawn: () => Promise.resolve(1),
    });
    expect(lines).toEqual([
      'extensions update:',
      '  npm:hashline-pi@^0.1.0  0.1.0  failed (install failed (pi install exited 1))',
    ]);
    expect(exitCode).toBe(1);
  });

  it('keeps peer warnings non-fatal by default and fatal under --strict', async () => {
    const run = async (args: readonly string[]): Promise<RunOutcome> => {
      const home = join(fixtureRoot(), 'home');
      installNpmFixture(home, 'peered-pi', '^1.0.0', '1.0.0', {
        peerDependencies: { 'missing-peer': '^1.0.0' },
      });
      return runUpdate(home, {
        args,
        npmLatest: (name) => (name === 'peered-pi' ? '1.1.0' : undefined),
        spawn: installingSpawn(),
        peerSpawn: () => Promise.resolve(1),
      });
    };
    const lax = await run(['extensions']);
    expect(lax.exitCode).toBe(0);
    expect(lax.lines[1]).toContain('updated');
    expect(lax.lines[2]).toMatch(
      /^warning: extension 'npm:peered-pi@\^1\.0\.0' failed to install peer dependency 'missing-peer'/,
    );
    const strict = await run(['extensions', '--strict']);
    expect(strict.exitCode).toBe(1);
  });
});
