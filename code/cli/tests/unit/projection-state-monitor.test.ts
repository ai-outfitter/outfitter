// Tests near-real-time undeclared runtime-projection writes and crash journals.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import type { FSWatcher, watch } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import {
  createProjectionSessionJournal,
  createProjectionStateBaseline,
  detectUndeclaredProjectionWrites,
  fingerprintProjectionStateBaseline,
  isUndeclaredProjectionWritePath,
  reportAndClearProjectionSessionJournals,
  watchProjectionStateWrites,
} from '../../src/projection/ProjectionStateMonitor.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-projection-state-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

interface FakeWatch {
  readonly watchedPaths: string[];
  readonly closed: () => boolean;
  readonly factory: typeof watch;
  emit(filename: string | Buffer | null): void;
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
    closed: () => closed,
    factory,
    emit: (filename) => listener?.('change', filename),
  };
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('projection state classification', () => {
  it('distinguishes generated, declared, unsafe, and undeclared paths', () => {
    const root = createTemporaryRoot();
    write(join(root, 'system-prompt.md'), 'prompt');
    write(join(root, 'skills', 'wiki', 'SKILL.md'), 'skill');
    const baseline = createProjectionStateBaseline(root);
    const statePaths = [
      { relativePath: 'auth.json', kind: 'file' },
      { relativePath: 'sessions', kind: 'directory' },
    ] as const;

    expect(isUndeclaredProjectionWritePath('unexpected.txt', baseline, statePaths)).toBe(true);
    expect(isUndeclaredProjectionWritePath('system-prompt.md', baseline, statePaths)).toBe(false);
    expect(isUndeclaredProjectionWritePath('skills', baseline, statePaths)).toBe(false);
    expect(isUndeclaredProjectionWritePath('auth.json', baseline, statePaths)).toBe(false);
    expect(isUndeclaredProjectionWritePath('sessions/run.json', baseline, statePaths)).toBe(false);
    expect(isUndeclaredProjectionWritePath('', baseline, statePaths)).toBe(false);
    expect(isUndeclaredProjectionWritePath('../escape', baseline, statePaths)).toBe(false);
  });

  it('finds undeclared files in the authoritative exit-time pass', () => {
    const root = createTemporaryRoot();
    write(join(root, 'agent.md'), 'agent');
    const baseline = createProjectionStateBaseline(root);
    write(join(root, 'sessions', 'one.json'), '{}');
    write(join(root, 'notes', 'deep.txt'), 'state');

    expect(detectUndeclaredProjectionWrites(root, baseline, [{ relativePath: 'sessions', kind: 'directory' }])).toEqual(
      ['notes/deep.txt'],
    );
  });

  it('fingerprints generated symbolic links without reading their targets', () => {
    const root = createTemporaryRoot();
    symlinkSync('missing-target', join(root, 'generated-link'));

    expect(createProjectionStateBaseline(root).fingerprints.get('generated-link')).toBe('symlink:14');
  });
});

describe('projection state live monitor', () => {
  it('journals immediately and emits throttled, deduplicated notices', () => {
    const root = createTemporaryRoot();
    write(join(root, 'agent.md'), 'agent');
    const fakeWatch = createFakeWatch();
    const notices: string[] = [];
    const journalRecords: string[][] = [];
    const scheduled: (() => void)[] = [];
    const monitor = watchProjectionStateWrites({
      rootDirectory: root,
      harness: 'pi',
      baseline: createProjectionStateBaseline(root),
      statePaths: [{ relativePath: 'sessions', kind: 'directory' }],
      notify: (message) => notices.push(message),
      warn: (message) => notices.push(message),
      journal: { recordUndeclaredWrites: (paths) => journalRecords.push([...paths]) },
      watchFactory: fakeWatch.factory,
      timers: {
        setTimeout: (callback) => {
          scheduled.push(callback);
          return callback;
        },
        clearTimeout: () => undefined,
      },
    });

    expect(fakeWatch.watchedPaths).toEqual([root]);
    fakeWatch.emit('unexpected.txt');
    fakeWatch.emit('unexpected.txt');
    fakeWatch.emit('agent.md');
    fakeWatch.emit('sessions/one.json');
    fakeWatch.emit(null);
    fakeWatch.emit('');
    expect(journalRecords).toEqual([['unexpected.txt']]);
    expect(notices).toEqual([]);

    scheduled[0]?.();
    expect(notices).toEqual([
      "pi is writing undeclared runtime projection state 'unexpected.txt' (undeclared writes are not persisted).",
    ]);
    monitor.close();
    expect(fakeWatch.closed()).toBe(true);
    fakeWatch.emit('after-close.txt');
    expect(journalRecords).toHaveLength(1);
  });

  it('drops a pending notice on close and warns if watching cannot start', () => {
    const root = createTemporaryRoot();
    const fakeWatch = createFakeWatch();
    const notices: string[] = [];
    let cleared = false;
    const monitor = watchProjectionStateWrites({
      rootDirectory: root,
      harness: 'claude',
      baseline: createProjectionStateBaseline(root),
      statePaths: [],
      notify: (message) => notices.push(message),
      warn: (message) => notices.push(message),
      watchFactory: fakeWatch.factory,
      timers: {
        setTimeout: (callback) => callback,
        clearTimeout: () => (cleared = true),
      },
    });
    fakeWatch.emit('pending.txt');
    monitor.close();
    expect(cleared).toBe(true);
    expect(notices).toEqual([]);

    const failed = watchProjectionStateWrites({
      rootDirectory: root,
      harness: 'claude',
      baseline: createProjectionStateBaseline(root),
      statePaths: [],
      notify: () => undefined,
      warn: (message) => notices.push(message),
      watchFactory: () => {
        throw new Error('watch unavailable');
      },
    });
    expect(notices).toEqual(['Could not watch runtime projection state writes: Error: watch unavailable']);
    failed.close();
  });

  it('uses unrefed runtime timers for notices and cancels a pending flush on close', async () => {
    const root = createTemporaryRoot();
    const fakeWatch = createFakeWatch();
    const notices: string[] = [];
    const monitor = watchProjectionStateWrites({
      rootDirectory: root,
      harness: 'pi',
      baseline: createProjectionStateBaseline(root),
      statePaths: [],
      notify: (message) => notices.push(message),
      warn: (message) => notices.push(message),
      watchFactory: fakeWatch.factory,
      throttleMs: 1,
    });

    fakeWatch.emit('first.txt');
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(notices).toHaveLength(1);
    fakeWatch.emit('pending.txt');
    monitor.close();
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(notices).toHaveLength(1);
  });
});

describe('projection session journal', () => {
  it('persists a stable baseline fingerprint and sorted unique writes', () => {
    const root = createTemporaryRoot();
    write(join(root, 'agent.md'), 'agent');
    const baseline = createProjectionStateBaseline(root);
    const journal = createProjectionSessionJournal({
      journalDirectory: join(root, 'journals'),
      harness: 'pi',
      agent: 'engineer',
      rootDirectory: join(root, 'outfitter-engineer-pi-abc'),
      baseline,
      now: () => new Date('2026-07-01T00:00:00.000Z'),
    });

    const initial = JSON.parse(readFileSync(journal.path, 'utf8')) as Record<string, unknown>;
    expect(initial.startedAt).toBe('2026-07-01T00:00:00.000Z');
    expect(initial.baselineFingerprint).toBe(fingerprintProjectionStateBaseline(baseline));
    journal.recordUndeclaredWrites(['b.txt', 'a.txt']);
    journal.recordUndeclaredWrites(['a.txt']);
    expect((JSON.parse(readFileSync(journal.path, 'utf8')) as Record<string, unknown>).undeclaredWrites).toEqual([
      'a.txt',
      'b.txt',
    ]);
    journal.discard();
    expect(existsSync(journal.path)).toBe(false);
  });

  it('reports valid crashed journals once and clears invalid or clean entries', () => {
    const root = createTemporaryRoot();
    const journalDirectory = join(root, 'journals');
    mkdirSync(journalDirectory, { recursive: true });
    const entry = {
      version: 1,
      harness: 'claude',
      agent: 'reviewer',
      rootDirectory: '/tmp/missing',
      startedAt: '2026-07-01T00:00:00.000Z',
      baselineFingerprint: 'abc',
      undeclaredWrites: ['ghost.txt'],
    };
    writeFileSync(join(journalDirectory, 'crashed.json'), JSON.stringify(entry));
    writeFileSync(join(journalDirectory, 'clean.json'), JSON.stringify({ ...entry, undeclaredWrites: [] }));
    writeFileSync(join(journalDirectory, 'malformed.json'), 'nope');
    writeFileSync(join(journalDirectory, 'invalid.json'), JSON.stringify({ ...entry, version: 2 }));
    const reports: string[] = [];

    reportAndClearProjectionSessionJournals(journalDirectory, (message) => reports.push(message));
    expect(reports).toEqual([
      "A previous claude run (agent 'reviewer') ended without cleanup; these undeclared runtime projection " +
        "writes were observed and not persisted: 'ghost.txt'.",
    ]);
    expect(readdirSync(journalDirectory)).toEqual([]);
    reportAndClearProjectionSessionJournals(join(root, 'missing'), (message) => reports.push(message));
    expect(reports).toHaveLength(1);
  });
});

describe('run projection state accounting', () => {
  it('reports live and exit-time writes, clears its journal, and honors strict mode', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    write(join(projectDirectory, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n');
    const fakeWatch = createFakeWatch();
    const scheduled: (() => void)[] = [];
    const messages: string[] = [];

    const result = await executeRunAgentCommand({
      homeDirectory,
      projectDirectory,
      agent: 'engineer',
      harness: 'pi',
      strict: true,
      writeLine: (message) => messages.push(message),
      stateWriteMonitor: {
        watchFactory: fakeWatch.factory,
        timers: {
          setTimeout: (callback) => {
            scheduled.push(callback);
            return callback;
          },
          clearTimeout: () => undefined,
        },
      },
      launcher: (plan) => {
        write(join(plan.env.PI_CODING_AGENT_DIR, 'unexpected.txt'), 'write');
        fakeWatch.emit('unexpected.txt');
        const journalDirectory = join(homeDirectory, '.cache', 'outfitter', 'session-journals');
        expect(readdirSync(journalDirectory)).toHaveLength(1);
        scheduled[0]?.();
        return Promise.resolve(0);
      },
    });

    expect(result.exitCode).toBe(1);
    expect(result.messages).toContain(
      "pi wrote undeclared runtime projection state 'unexpected.txt' and it was not persisted.",
    );
    expect(messages).toContain(
      "pi is writing undeclared runtime projection state 'unexpected.txt' (undeclared writes are not persisted).",
    );
    expect(readdirSync(join(homeDirectory, '.cache', 'outfitter', 'session-journals'))).toEqual([]);
  });

  it('reports a prior crashed journal without adding it to current-run warnings', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    write(join(projectDirectory, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n');
    const journalDirectory = join(homeDirectory, '.cache', 'outfitter', 'session-journals');
    write(
      join(journalDirectory, 'crashed.json'),
      JSON.stringify({
        version: 1,
        harness: 'pi',
        agent: 'engineer',
        rootDirectory: '/tmp/gone',
        startedAt: '2026-07-01T00:00:00.000Z',
        baselineFingerprint: 'abc',
        undeclaredWrites: ['ghost.txt'],
      }),
    );
    const messages: string[] = [];
    const result = await executeRunAgentCommand({
      homeDirectory,
      projectDirectory,
      agent: 'engineer',
      writeLine: (message) => messages.push(message),
      launcher: () => Promise.resolve(0),
    });

    expect(result.messages).toEqual([]);
    expect(messages).toContain(
      "A previous pi run (agent 'engineer') ended without cleanup; these undeclared runtime projection writes " +
        "were observed and not persisted: 'ghost.txt'.",
    );
    expect(readdirSync(journalDirectory)).toEqual([]);
  });

  it('keeps the harness exit code while reporting writes outside strict mode', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    write(join(projectDirectory, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n');
    const result = await executeRunAgentCommand({
      homeDirectory,
      projectDirectory,
      agent: 'engineer',
      launcher: (plan) => {
        write(join(plan.env.PI_CODING_AGENT_DIR, 'unexpected.txt'), 'write');
        return Promise.resolve(7);
      },
    });

    expect(result.exitCode).toBe(7);
    expect(result.messages).toContain(
      "pi wrote undeclared runtime projection state 'unexpected.txt' and it was not persisted.",
    );
  });
});
