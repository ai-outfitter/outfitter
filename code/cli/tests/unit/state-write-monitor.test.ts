// Tests near-real-time undeclared composite profile write detection and the crash-coverage
// session journal that reports a crashed session's undeclared writes on the next invocation.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import type { FSWatcher, watch } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunCommand } from '../../src/cli/commands/RunCommand.js';
import { createCompositeProfile } from '../../src/compositeProfile/CompositeProfile.js';
import { createCompositeProfileFile } from '../../src/compositeProfile/CompositeProfileFile.js';
import {
  createCompositeProfileSessionJournal,
  fingerprintCompositeProfileStateBaseline,
  reportAndClearCompositeProfileSessionJournals,
} from '../../src/compositeProfile/CompositeProfileSessionJournal.js';
import { watchCompositeProfileStateWrites } from '../../src/compositeProfile/CompositeProfileWatcher.js';
import { isUndeclaredCompositeProfileWritePath } from '../../src/compositeProfile/StatePersistence.js';
import type { CompositeProfileStatePath } from '../../src/compositeProfile/StatePersistence.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-state-monitor-'));
  temporaryRoots.push(root);
  return root;
};

const sleep = (milliseconds: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, milliseconds));

const monitorStatePaths: readonly CompositeProfileStatePath[] = [
  { relativePath: 'settings.json', strategy: 'symlink', sourcePath: '/durable/settings.json', directory: false },
  { relativePath: 'logs/cache/', strategy: 'warn', directory: true },
  { relativePath: 'unknown', strategy: 'warn', directory: false },
];

const createMonitorCompositeProfile = (rootDirectory: string) =>
  createCompositeProfile(
    rootDirectory,
    [
      createCompositeProfileFile({ relativePath: 'outfitter/profile.json', content: '{}\n' }),
      createCompositeProfileFile({ relativePath: '.mcp.json', content: '{}\n' }),
    ],
    monitorStatePaths,
  );

interface FakeWatch {
  readonly watchedPaths: string[];
  emit(filename: string | Buffer | null): void;
  readonly closed: () => boolean;
  readonly factory: typeof watch;
}

const createFakeWatch = (): FakeWatch => {
  const watchedPaths: string[] = [];
  let listener: ((eventType: string, filename: string | Buffer | null) => void) | undefined;
  let closed = false;
  const factory = ((
    path: string,
    _options: unknown,
    callback: (eventType: string, filename: string | Buffer | null) => void,
  ) => {
    watchedPaths.push(path);
    listener = callback;
    return { close: () => (closed = true) } as unknown as FSWatcher;
  }) as unknown as typeof watch;

  return {
    watchedPaths,
    emit: (filename) => listener?.('change', filename),
    closed: () => closed,
    factory,
  };
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('composite profile state write monitor', () => {
  it('classifies undeclared composite profile write paths', () => {
    const generatedFilePaths = ['outfitter/profile.json', '.mcp.json'];

    expect(isUndeclaredCompositeProfileWritePath('unexpected.txt', monitorStatePaths, generatedFilePaths)).toBe(true);
    expect(isUndeclaredCompositeProfileWritePath('notes/deep.txt', monitorStatePaths, generatedFilePaths)).toBe(true);
    expect(isUndeclaredCompositeProfileWritePath('settings.json', monitorStatePaths, generatedFilePaths)).toBe(false);
    expect(isUndeclaredCompositeProfileWritePath('logs/cache/entry.txt', monitorStatePaths, generatedFilePaths)).toBe(
      false,
    );
    expect(isUndeclaredCompositeProfileWritePath('logs', monitorStatePaths, generatedFilePaths)).toBe(false);
    expect(isUndeclaredCompositeProfileWritePath('outfitter/profile.json', monitorStatePaths, generatedFilePaths)).toBe(
      false,
    );
    expect(isUndeclaredCompositeProfileWritePath('outfitter', monitorStatePaths, generatedFilePaths)).toBe(false);
    expect(isUndeclaredCompositeProfileWritePath('.mcp.json', monitorStatePaths, generatedFilePaths)).toBe(false);
    expect(isUndeclaredCompositeProfileWritePath('', monitorStatePaths, generatedFilePaths)).toBe(false);
  });

  it('emits throttled deduplicated notices and records journal entries for undeclared writes', async () => {
    const fakeWatch = createFakeWatch();
    const notices: string[] = [];
    const journalRecords: string[][] = [];

    const handle = watchCompositeProfileStateWrites({
      compositeProfile: createMonitorCompositeProfile('/composite/root'),
      agentId: 'pi',
      notify: (message) => notices.push(message),
      warn: () => undefined,
      journal: { recordUndeclaredWrites: (paths) => journalRecords.push([...paths]) },
      throttleMs: 1,
      watchFactory: fakeWatch.factory,
    });

    expect(fakeWatch.watchedPaths).toEqual(['/composite/root']);
    fakeWatch.emit('unexpected.txt');
    fakeWatch.emit('unexpected.txt');
    fakeWatch.emit('settings.json');
    fakeWatch.emit('outfitter/profile.json');
    fakeWatch.emit('.mcp.json');
    fakeWatch.emit('logs/cache/entry.txt');
    fakeWatch.emit(null);
    fakeWatch.emit('');
    fakeWatch.emit('notes/deep.txt');

    // Journal records are immediate so crashes lose as little accounting as possible.
    expect(journalRecords).toEqual([['unexpected.txt'], ['notes/deep.txt']]);
    expect(notices).toEqual([]);

    await sleep(20);
    expect(notices).toEqual([
      "pi is writing undeclared composite profile state 'unexpected.txt' (undeclared writes are not persisted).",
      "pi is writing undeclared composite profile state 'notes/deep.txt' (undeclared writes are not persisted).",
    ]);

    handle.close();
    expect(fakeWatch.closed()).toBe(true);
    fakeWatch.emit('after-close.txt');
    await sleep(20);
    expect(journalRecords).toHaveLength(2);
  });

  it('drops pending notices on close because the exit-time diff is authoritative', async () => {
    const fakeWatch = createFakeWatch();
    const notices: string[] = [];

    const handle = watchCompositeProfileStateWrites({
      compositeProfile: createMonitorCompositeProfile('/composite/root'),
      agentId: 'pi',
      notify: (message) => notices.push(message),
      warn: () => undefined,
      throttleMs: 1,
      watchFactory: fakeWatch.factory,
    });

    fakeWatch.emit('unexpected.txt');
    handle.close();
    await sleep(20);

    expect(notices).toEqual([]);
  });

  it('does not watch at all when unknown writes are discarded', () => {
    const fakeWatch = createFakeWatch();

    const handle = watchCompositeProfileStateWrites({
      compositeProfile: createCompositeProfile(
        '/composite/root',
        [],
        [{ relativePath: 'unknown', strategy: 'discard', directory: false }],
      ),
      agentId: 'pi',
      notify: () => undefined,
      warn: () => undefined,
      watchFactory: fakeWatch.factory,
    });

    expect(fakeWatch.watchedPaths).toEqual([]);
    handle.close();
  });

  it('warns when the state write watcher cannot be started', () => {
    const warnings: string[] = [];
    const failingWatchFactory = (() => {
      throw new Error('watch unavailable');
    }) as unknown as typeof watch;

    const handle = watchCompositeProfileStateWrites({
      compositeProfile: createMonitorCompositeProfile('/composite/root'),
      agentId: 'pi',
      notify: () => undefined,
      warn: (message) => warnings.push(message),
      watchFactory: failingWatchFactory,
    });

    expect(warnings).toEqual(['Could not watch composite profile state writes: Error: watch unavailable']);
    handle.close();
  });
});

describe('composite profile session journal', () => {
  it('persists a baseline fingerprint at session start and records undeclared writes', () => {
    const root = createTemporaryRoot();
    const journalDirectory = join(root, 'journals');
    const baseline = { fingerprints: new Map([['settings.json', 'file:e30=']]) };

    const journal = createCompositeProfileSessionJournal({
      journalDirectory,
      agentId: 'pi',
      profileId: 'default',
      compositeProfileDirectory: join(root, 'outfitter-default-pi-abc123'),
      baseline,
      now: () => new Date('2026-07-01T00:00:00.000Z'),
    });

    expect(journal.path).toBe(join(journalDirectory, 'outfitter-default-pi-abc123.json'));
    const initial = JSON.parse(readFileSync(journal.path, 'utf8')) as Record<string, unknown>;
    expect(initial.version).toBe(1);
    expect(initial.startedAt).toBe('2026-07-01T00:00:00.000Z');
    expect(initial.baselineFingerprint).toBe(fingerprintCompositeProfileStateBaseline(baseline));
    expect(initial.undeclaredWrites).toEqual([]);

    journal.recordUndeclaredWrites(['b.txt', 'a.txt']);
    journal.recordUndeclaredWrites(['a.txt']);
    const updated = JSON.parse(readFileSync(journal.path, 'utf8')) as Record<string, unknown>;
    expect(updated.undeclaredWrites).toEqual(['a.txt', 'b.txt']);

    journal.discard();
    expect(existsSync(journal.path)).toBe(false);
  });

  it('creates distinct fingerprints for distinct baselines and stable ones for equal baselines', () => {
    const left = { fingerprints: new Map([['a.txt', 'file:one']]) };
    const leftAgain = { fingerprints: new Map([['a.txt', 'file:one']]) };
    const right = { fingerprints: new Map([['a.txt', 'file:two']]) };

    expect(fingerprintCompositeProfileStateBaseline(left)).toBe(fingerprintCompositeProfileStateBaseline(leftAgain));
    expect(fingerprintCompositeProfileStateBaseline(left)).not.toBe(fingerprintCompositeProfileStateBaseline(right));
  });

  it('reports leftover journals with undeclared writes once and clears every leftover journal', () => {
    const root = createTemporaryRoot();
    const journalDirectory = join(root, 'journals');
    mkdirSync(journalDirectory, { recursive: true });
    writeFileSync(
      join(journalDirectory, 'crashed.json'),
      JSON.stringify({
        version: 1,
        agentId: 'pi',
        profileId: 'default',
        compositeProfileDirectory: join(root, 'missing-composite-directory'),
        startedAt: '2026-07-01T00:00:00.000Z',
        baselineFingerprint: 'abc',
        undeclaredWrites: ['ghost.txt', 'notes/deep.txt'],
      }),
    );
    writeFileSync(
      join(journalDirectory, 'clean.json'),
      JSON.stringify({
        version: 1,
        agentId: 'pi',
        profileId: 'default',
        compositeProfileDirectory: join(root, 'other'),
        startedAt: '2026-07-01T00:00:00.000Z',
        baselineFingerprint: 'abc',
        undeclaredWrites: [],
      }),
    );
    writeFileSync(join(journalDirectory, 'malformed.json'), 'not json');
    writeFileSync(join(journalDirectory, 'invalid-shape.json'), JSON.stringify({ undeclaredWrites: 'nope' }));
    const reports: string[] = [];

    reportAndClearCompositeProfileSessionJournals(journalDirectory, (message) => reports.push(message));

    // Reporting works even though the crashed session's composite directory no longer
    // exists (e.g. it was already swept), because the journal lives outside the tmp root.
    expect(reports).toEqual([
      "A previous pi run (profile 'default') ended without cleanup; these undeclared composite profile state " +
        "writes were observed and not persisted: 'ghost.txt', 'notes/deep.txt'.",
    ]);
    expect(readdirSync(journalDirectory)).toEqual([]);
  });

  it('does nothing when the journal directory does not exist', () => {
    const reports: string[] = [];

    reportAndClearCompositeProfileSessionJournals(join(createTemporaryRoot(), 'missing'), (message) =>
      reports.push(message),
    );

    expect(reports).toEqual([]);
  });
});

describe('run command crash coverage', () => {
  it('reports a crashed session journal once on the next invocation and clears it', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    mkdirSync(join(homeDirectory, '.outfitter'), { recursive: true });
    writeFileSync(
      join(homeDirectory, '.outfitter', 'settings.yml'),
      'default_profile: default\nprofile_sources:\n  - path: ./profiles\n',
    );
    mkdirSync(join(homeDirectory, '.outfitter', 'profiles', 'default'), { recursive: true });
    writeFileSync(
      join(homeDirectory, '.outfitter', 'profiles', 'default', 'profile.yml'),
      'id: default\ncontrols: {}\n',
    );
    const journalDirectory = join(homeDirectory, '.outfitter', 'state', 'session-journals');
    mkdirSync(journalDirectory, { recursive: true });
    writeFileSync(
      join(journalDirectory, 'outfitter-default-pi-crashed.json'),
      JSON.stringify({
        version: 1,
        agentId: 'pi',
        profileId: 'default',
        compositeProfileDirectory: join(tmpdir(), 'outfitter-default-pi-crashed'),
        startedAt: '2026-06-30T00:00:00.000Z',
        baselineFingerprint: 'abc',
        undeclaredWrites: ['ghost.txt'],
      }),
    );
    const errors: string[] = [];

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        writeError: (message) => errors.push(message),
        writeLine: () => undefined,
        launcher: { launch: () => Promise.resolve(0) },
      },
    );

    expect(errors).toContain(
      "A previous pi run (profile 'default') ended without cleanup; these undeclared composite profile state " +
        "writes were observed and not persisted: 'ghost.txt'.",
    );
    // Prior-session reports are informational and do not become this run's warnings.
    expect(result.warnings).toEqual([]);
    // Both the leftover journal and this session's own journal are cleared.
    expect(readdirSync(journalDirectory)).toEqual([]);
  });

  it('surfaces a live notice and journals an undeclared write while the agent is still running', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    mkdirSync(join(homeDirectory, '.outfitter'), { recursive: true });
    writeFileSync(
      join(homeDirectory, '.outfitter', 'settings.yml'),
      'default_profile: default\nprofile_sources:\n  - path: ./profiles\n',
    );
    mkdirSync(join(homeDirectory, '.outfitter', 'profiles', 'default'), { recursive: true });
    writeFileSync(
      join(homeDirectory, '.outfitter', 'profiles', 'default', 'profile.yml'),
      'id: default\ncontrols: {}\n',
    );
    const journalDirectory = join(homeDirectory, '.outfitter', 'state', 'session-journals');
    const errors: string[] = [];
    const liveNotice =
      "pi is writing undeclared composite profile state 'unexpected.txt' (undeclared writes are not persisted).";

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        writeError: (message) => errors.push(message),
        writeLine: () => undefined,
        launcher: {
          async launch(plan) {
            writeFileSync(join(plan.env.PI_CODING_AGENT_DIR, 'unexpected.txt'), 'live write\n');

            const deadline = Date.now() + 8000;
            while (!errors.includes(liveNotice) && Date.now() < deadline) {
              await sleep(25);
            }

            expect(errors).toContain(liveNotice);
            const journalFiles = readdirSync(journalDirectory);
            expect(journalFiles).toHaveLength(1);
            const journal = JSON.parse(readFileSync(join(journalDirectory, journalFiles[0] ?? ''), 'utf8')) as Record<
              string,
              unknown
            >;
            expect(journal.undeclaredWrites).toEqual(['unexpected.txt']);
            return 0;
          },
        },
      },
    );

    // The exit-time diff remains authoritative and still reports the undeclared write.
    expect(result.warnings).toContain(
      "pi wrote undeclared composite profile state 'unexpected.txt' and it was not persisted.",
    );
    // The clean exit discards this session's journal.
    expect(readdirSync(journalDirectory)).toEqual([]);
  }, 15000);
});
