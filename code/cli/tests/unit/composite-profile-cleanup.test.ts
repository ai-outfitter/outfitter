// Tests composite profile temporary directory cleanup: exit/signal teardown, the --debug
// keep behavior, and the best-effort startup sweep of stale outfitter-* directories.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunCommand } from '../../src/cli/commands/RunCommand.js';
import {
  defaultCompositeProfileSweepMaxAgeMs,
  executeCompositeProfileDirectoryCleanup,
  registerCompositeProfileDirectoryCleanup,
  sweepStaleCompositeProfileDirectories,
} from '../../src/compositeProfile/CompositeProfileCleanup.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-cleanup-'));
  temporaryRoots.push(root);
  return root;
};

interface FakeProcess {
  readonly handlers: Map<string, () => void>;
  readonly killed: { pid: number; signal: string }[];
  readonly processObject: NodeJS.Process;
}

const createFakeProcess = (): FakeProcess => {
  const handlers = new Map<string, () => void>();
  const killed: { pid: number; signal: string }[] = [];
  const processObject = {
    pid: 4242,
    once(event: string, handler: () => void) {
      handlers.set(event, handler);
      return processObject;
    },
    kill(pid: number, signal: string) {
      killed.push({ pid, signal });
      return true;
    },
  } as unknown as NodeJS.Process;

  return { handlers, killed, processObject };
};

const createCompositeDirectoryWithSymlink = (root: string, name: string): { directory: string; target: string } => {
  const directory = join(root, name);
  const target = join(root, `${name}-target.json`);
  mkdirSync(directory, { recursive: true });
  writeFileSync(target, '{"durable":true}\n');
  symlinkSync(target, join(directory, 'auth.json'));
  return { directory, target };
};

const writeRunFixture = (root: string): { homeDirectory: string; projectDirectory: string } => {
  const homeDirectory = join(root, 'home');
  const projectDirectory = join(root, 'project');
  mkdirSync(join(homeDirectory, '.outfitter', 'profiles', 'default'), { recursive: true });
  writeFileSync(
    join(homeDirectory, '.outfitter', 'settings.yml'),
    'default_profile: default\nprofile_sources:\n  - path: ./profiles\n',
  );
  writeFileSync(join(homeDirectory, '.outfitter', 'profiles', 'default', 'profile.yml'), 'id: default\ncontrols: {}\n');
  return { homeDirectory, projectDirectory };
};

afterEach(() => {
  executeCompositeProfileDirectoryCleanup();

  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('composite profile directory cleanup', () => {
  it('removes registered directories without following contained symlinks', () => {
    const root = createTemporaryRoot();
    const { directory, target } = createCompositeDirectoryWithSymlink(root, 'outfitter-default-pi-run');
    registerCompositeProfileDirectoryCleanup(directory, createFakeProcess().processObject);

    const removed = executeCompositeProfileDirectoryCleanup();

    expect(removed).toContain(directory);
    expect(existsSync(directory)).toBe(false);
    // The symlinked auth state target must survive cleanup untouched.
    expect(readFileSync(target, 'utf8')).toBe('{"durable":true}\n');
  });

  it('cleans registered directories from the process exit handler', () => {
    const root = createTemporaryRoot();
    const fakeProcess = createFakeProcess();
    const { directory, target } = createCompositeDirectoryWithSymlink(root, 'outfitter-default-pi-exit');
    registerCompositeProfileDirectoryCleanup(directory, fakeProcess.processObject);

    expect([...fakeProcess.handlers.keys()].sort()).toEqual(['SIGHUP', 'SIGINT', 'SIGTERM', 'exit']);
    fakeProcess.handlers.get('exit')?.();

    expect(existsSync(directory)).toBe(false);
    expect(existsSync(target)).toBe(true);
    expect(fakeProcess.killed).toEqual([]);
  });

  it('cleans registered directories on handled signals, keeps journals, and re-raises', () => {
    const root = createTemporaryRoot();
    const fakeProcess = createFakeProcess();
    const { directory } = createCompositeDirectoryWithSymlink(root, 'outfitter-default-pi-signal');
    const journalPath = join(root, 'state', 'session-journals', 'outfitter-default-pi-signal.json');
    mkdirSync(join(root, 'state', 'session-journals'), { recursive: true });
    writeFileSync(journalPath, '{"undeclaredWrites":["ghost.txt"]}\n');
    registerCompositeProfileDirectoryCleanup(directory, fakeProcess.processObject);

    fakeProcess.handlers.get('SIGTERM')?.();

    expect(existsSync(directory)).toBe(false);
    // The crash journal lives outside the composite directory and must survive signal
    // cleanup so the next invocation can report it.
    expect(existsSync(journalPath)).toBe(true);
    expect(fakeProcess.killed).toEqual([{ pid: 4242, signal: 'SIGTERM' }]);
  });

  it('installs process handlers only once per process object', () => {
    const root = createTemporaryRoot();
    const fakeProcess = createFakeProcess();
    const first = join(root, 'outfitter-first');
    const second = join(root, 'outfitter-second');
    mkdirSync(first);
    mkdirSync(second);

    registerCompositeProfileDirectoryCleanup(first, fakeProcess.processObject);
    const handlerCount = fakeProcess.handlers.size;
    registerCompositeProfileDirectoryCleanup(second, fakeProcess.processObject);

    expect(fakeProcess.handlers.size).toBe(handlerCount);
    fakeProcess.handlers.get('exit')?.();
    expect(existsSync(first)).toBe(false);
    expect(existsSync(second)).toBe(false);
  });

  it('tolerates directories that cannot be removed', () => {
    const root = createTemporaryRoot();
    const removable = join(root, 'outfitter-removable');
    mkdirSync(removable);
    registerCompositeProfileDirectoryCleanup(join(root, 'invalid\0name'), createFakeProcess().processObject);
    registerCompositeProfileDirectoryCleanup(removable, createFakeProcess().processObject);

    const removed = executeCompositeProfileDirectoryCleanup();

    expect(removed).toContain(removable);
    expect(removed).not.toContain(join(root, 'invalid\0name'));
    expect(existsSync(removable)).toBe(false);
  });
});

describe('stale composite profile directory sweep', () => {
  it('removes only stale outfitter-* directories and never follows symlinks', () => {
    const root = createTemporaryRoot();
    const staleAge = new Date(Date.now() - defaultCompositeProfileSweepMaxAgeMs - 60_000);
    const { directory: staleDirectory, target } = createCompositeDirectoryWithSymlink(root, 'outfitter-stale');
    utimesSync(staleDirectory, staleAge, staleAge);
    const freshDirectory = join(root, 'outfitter-fresh');
    mkdirSync(freshDirectory);
    const unrelatedDirectory = join(root, 'other-stale');
    mkdirSync(unrelatedDirectory);
    utimesSync(unrelatedDirectory, staleAge, staleAge);
    const linkedDirectory = join(root, 'linked-real-directory');
    mkdirSync(linkedDirectory);
    writeFileSync(join(linkedDirectory, 'keep.txt'), 'kept\n');
    const staleLink = join(root, 'outfitter-symlink-entry');
    symlinkSync(linkedDirectory, staleLink);

    const removed = sweepStaleCompositeProfileDirectories({ directory: root });

    expect(removed).toEqual([staleDirectory]);
    expect(existsSync(staleDirectory)).toBe(false);
    // The stale directory contained a symlink into durable state; the target survives.
    expect(readFileSync(target, 'utf8')).toBe('{"durable":true}\n');
    expect(existsSync(freshDirectory)).toBe(true);
    expect(existsSync(unrelatedDirectory)).toBe(true);
    // Symlink entries are skipped entirely, even with a stale-looking name.
    expect(existsSync(staleLink)).toBe(true);
    expect(readFileSync(join(linkedDirectory, 'keep.txt'), 'utf8')).toBe('kept\n');
  });

  it('supports injected age thresholds and clocks', () => {
    const root = createTemporaryRoot();
    const swept = join(root, 'outfitter-aged');
    mkdirSync(swept);
    const cutoff = new Date(Date.now() - 5_000);
    utimesSync(swept, cutoff, cutoff);

    expect(sweepStaleCompositeProfileDirectories({ directory: root, maxAgeMs: 60_000 })).toEqual([]);
    expect(sweepStaleCompositeProfileDirectories({ directory: root, maxAgeMs: 1_000 })).toEqual([swept]);
    expect(existsSync(swept)).toBe(false);
  });

  it('returns nothing when the sweep root does not exist', () => {
    expect(sweepStaleCompositeProfileDirectories({ directory: join(createTemporaryRoot(), 'missing') })).toEqual([]);
  });
});

describe('run command composite profile teardown', () => {
  it('registers the composite directory for exit cleanup on normal runs', async () => {
    const root = createTemporaryRoot();
    const { homeDirectory, projectDirectory } = writeRunFixture(root);

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        writeError: () => undefined,
        writeLine: () => undefined,
        launcher: { launch: () => Promise.resolve(0) },
      },
    );

    // The directory stays available after the run and is removed by the deferred cleanup.
    expect(existsSync(result.compositeProfileDirectory)).toBe(true);
    const nativeSettingsPath = join(homeDirectory, '.pi', 'agent', 'settings.json');
    expect(existsSync(nativeSettingsPath)).toBe(true);

    const removed = executeCompositeProfileDirectoryCleanup();

    expect(removed).toContain(result.compositeProfileDirectory);
    expect(existsSync(result.compositeProfileDirectory)).toBe(false);
    // Symlinked native state survives the teardown.
    expect(existsSync(nativeSettingsPath)).toBe(true);
  });

  it('keeps the composite directory and prints its path when --debug is passed', async () => {
    const root = createTemporaryRoot();
    const { homeDirectory, projectDirectory } = writeRunFixture(root);
    const messages: string[] = [];

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory, passThroughArgs: ['--debug'] },
      {
        writeError: () => undefined,
        writeLine: (message) => messages.push(message),
        launcher: { launch: () => Promise.resolve(0) },
      },
    );

    expect(messages).toContain(`--debug: keeping composite profile directory ${result.compositeProfileDirectory}`);

    const removed = executeCompositeProfileDirectoryCleanup();

    expect(removed).not.toContain(result.compositeProfileDirectory);
    expect(existsSync(result.compositeProfileDirectory)).toBe(true);
  });
});
