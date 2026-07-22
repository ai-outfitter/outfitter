// Detects undeclared writes to an ephemeral runtime projection while a harness is running and
// journals live observations so a process killed before cleanup can report them on the next run.
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readdirSync, readFileSync, rmSync, watch, writeFileSync } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { basename, join, sep } from 'node:path';
import { sep as posixSeparator } from 'node:path/posix';

import type { ProjectedStatePath } from './Projection.js';

export interface ProjectionStateBaseline {
  readonly fingerprints: ReadonlyMap<string, string>;
}

export interface ProjectionSessionJournalEntry {
  readonly version: 1;
  readonly harness: string;
  readonly agent: string;
  readonly rootDirectory: string;
  readonly startedAt: string;
  readonly baselineFingerprint: string;
  readonly undeclaredWrites: readonly string[];
}

export interface ProjectionSessionJournal {
  readonly path: string;
  recordUndeclaredWrites(relativePaths: readonly string[]): void;
  discard(): void;
}

export interface ProjectionSessionJournalInput {
  readonly journalDirectory: string;
  readonly harness: string;
  readonly agent: string;
  readonly rootDirectory: string;
  readonly baseline: ProjectionStateBaseline;
  readonly now?: () => Date;
}

export interface ProjectionStateNoticeTimers {
  setTimeout(callback: () => void, delayMs: number): object;
  clearTimeout(handle: object): void;
}

export interface ProjectionStateMonitorDependencies {
  readonly watchFactory?: typeof watch;
  readonly timers?: ProjectionStateNoticeTimers;
  readonly throttleMs?: number;
}

export interface ProjectionStateMonitorInput extends ProjectionStateMonitorDependencies {
  readonly rootDirectory: string;
  readonly harness: string;
  readonly baseline: ProjectionStateBaseline;
  readonly statePaths: readonly ProjectedStatePath[];
  readonly notify: (message: string) => void;
  readonly warn: (message: string) => void;
  readonly journal?: Pick<ProjectionSessionJournal, 'recordUndeclaredWrites'>;
}

export interface ProjectionStateMonitorHandle {
  close(): void;
}

export const defaultProjectionStateNoticeThrottleMs = 1000;

const defaultTimers: ProjectionStateNoticeTimers = {
  setTimeout: (callback, delayMs) => setTimeout(callback, delayMs).unref(),
  clearTimeout: (handle) => clearTimeout(handle as NodeJS.Timeout),
};

const normalizeRelativePath = (path: string): string =>
  path.split(sep).join(posixSeparator).replace(/^\.\//u, '').replace(/\/$/u, '');

const isSafeRelativePath = (path: string): boolean =>
  path !== '' && path !== '..' && !path.startsWith(`..${posixSeparator}`) && !path.startsWith(posixSeparator);

const isWithinDeclaredPath = (path: string, statePath: ProjectedStatePath): boolean => {
  const declared = normalizeRelativePath(statePath.relativePath);
  return path === declared || (statePath.kind === 'directory' && path.startsWith(`${declared}${posixSeparator}`));
};

const isAncestorOfKnownPath = (path: string, knownPaths: Iterable<string>): boolean => {
  for (const knownPath of knownPaths) {
    if (knownPath.startsWith(`${path}${posixSeparator}`)) return true;
  }
  return false;
};

export const isUndeclaredProjectionWritePath = (
  relativePath: string,
  baseline: ProjectionStateBaseline,
  statePaths: readonly ProjectedStatePath[],
): boolean => {
  const path = normalizeRelativePath(relativePath);
  if (!isSafeRelativePath(path) || baseline.fingerprints.has(path)) return false;
  if (isAncestorOfKnownPath(path, baseline.fingerprints.keys())) return false;
  if (statePaths.some((statePath) => isWithinDeclaredPath(path, statePath))) return false;
  return !isAncestorOfKnownPath(
    path,
    statePaths.filter((statePath) => statePath.kind === 'directory').map((statePath) => statePath.relativePath),
  );
};

const fingerprintFile = (path: string): string => {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) return `symlink:${stat.size}`;
  return `file:${createHash('sha256').update(readFileSync(path)).digest('hex')}`;
};

const fingerprintTree = (rootDirectory: string): ReadonlyMap<string, string> => {
  const fingerprints = new Map<string, string>();

  const visit = (directory: string, prefix: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = prefix === '' ? entry.name : `${prefix}${posixSeparator}${entry.name}`;
      const absolutePath = join(directory, entry.name);
      if (entry.isDirectory()) visit(absolutePath, relativePath);
      else fingerprints.set(relativePath, fingerprintFile(absolutePath));
    }
  };

  visit(rootDirectory, '');
  return fingerprints;
};

export const createProjectionStateBaseline = (rootDirectory: string): ProjectionStateBaseline => ({
  fingerprints: fingerprintTree(rootDirectory),
});

export const fingerprintProjectionStateBaseline = (baseline: ProjectionStateBaseline): string => {
  const hash = createHash('sha256');
  for (const [path, fingerprint] of [...baseline.fingerprints].sort(([left], [right]) => left.localeCompare(right))) {
    hash.update(`${path}\0${fingerprint}\0`);
  }
  return hash.digest('hex');
};

export const detectUndeclaredProjectionWrites = (
  rootDirectory: string,
  baseline: ProjectionStateBaseline,
  statePaths: readonly ProjectedStatePath[],
): readonly string[] =>
  [...fingerprintTree(rootDirectory).keys()]
    .filter((path) => isUndeclaredProjectionWritePath(path, baseline, statePaths))
    .sort();

export const createProjectionSessionJournal = (input: ProjectionSessionJournalInput): ProjectionSessionJournal => {
  const path = join(input.journalDirectory, `${basename(input.rootDirectory)}.json`);
  const undeclaredWrites = new Set<string>();
  const startedAt = (input.now?.() ?? new Date()).toISOString();

  const write = (): void => {
    mkdirSync(input.journalDirectory, { recursive: true });
    const entry: ProjectionSessionJournalEntry = {
      version: 1,
      harness: input.harness,
      agent: input.agent,
      rootDirectory: input.rootDirectory,
      startedAt,
      baselineFingerprint: fingerprintProjectionStateBaseline(input.baseline),
      undeclaredWrites: [...undeclaredWrites].sort(),
    };
    writeFileSync(path, `${JSON.stringify(entry, null, 2)}\n`);
  };

  write();
  return {
    path,
    recordUndeclaredWrites(relativePaths): void {
      const size = undeclaredWrites.size;
      for (const relativePath of relativePaths) undeclaredWrites.add(relativePath);
      if (undeclaredWrites.size !== size) write();
    },
    discard: () => rmSync(path, { force: true }),
  };
};

const readJournalEntry = (path: string): ProjectionSessionJournalEntry | undefined => {
  try {
    const entry = JSON.parse(readFileSync(path, 'utf8')) as ProjectionSessionJournalEntry;
    if (
      entry.version !== 1 ||
      typeof entry.harness !== 'string' ||
      typeof entry.agent !== 'string' ||
      !Array.isArray(entry.undeclaredWrites) ||
      entry.undeclaredWrites.some((relativePath) => typeof relativePath !== 'string')
    ) {
      return undefined;
    }
    return entry;
  } catch {
    return undefined;
  }
};

export const reportAndClearProjectionSessionJournals = (
  journalDirectory: string,
  report: (message: string) => void,
): void => {
  let entryNames: readonly string[];
  try {
    entryNames = readdirSync(journalDirectory)
      .filter((entryName) => entryName.endsWith('.json'))
      .sort();
  } catch {
    return;
  }

  for (const entryName of entryNames) {
    const path = join(journalDirectory, entryName);
    const entry = readJournalEntry(path);
    if (entry !== undefined && entry.undeclaredWrites.length > 0) {
      report(
        `A previous ${entry.harness} run (agent '${entry.agent}') ended without cleanup; ` +
          `these undeclared runtime projection writes were observed and not persisted: ` +
          `${entry.undeclaredWrites.map((relativePath) => `'${relativePath}'`).join(', ')}.`,
      );
    }
    rmSync(path, { force: true });
  }
};

const formatError = (error: unknown): string => String(error);

export const watchProjectionStateWrites = (input: ProjectionStateMonitorInput): ProjectionStateMonitorHandle => {
  const timers = input.timers ?? defaultTimers;
  const observed = new Set<string>();
  const pending: string[] = [];
  let flushTimer: object | undefined;
  let watcher: FSWatcher | undefined;
  let closed = false;

  const flush = (): void => {
    flushTimer = undefined;
    for (const path of pending.splice(0)) {
      input.notify(
        `${input.harness} is writing undeclared runtime projection state '${path}' ` +
          `(undeclared writes are not persisted).`,
      );
    }
  };

  const onEvent = (_eventType: string, filename: string | Buffer | null): void => {
    if (closed || typeof filename !== 'string' || filename === '') return;
    const path = normalizeRelativePath(filename);
    if (observed.has(path) || !isUndeclaredProjectionWritePath(path, input.baseline, input.statePaths)) return;
    observed.add(path);
    input.journal?.recordUndeclaredWrites([path]);
    pending.push(path);
    flushTimer ??= timers.setTimeout(flush, input.throttleMs ?? defaultProjectionStateNoticeThrottleMs);
  };

  try {
    watcher = (input.watchFactory ?? watch)(input.rootDirectory, { recursive: true }, onEvent);
  } catch (error) {
    input.warn(`Could not watch runtime projection state writes: ${formatError(error)}`);
  }

  return {
    close(): void {
      closed = true;
      if (flushTimer !== undefined) timers.clearTimeout(flushTimer);
      flushTimer = undefined;
      watcher?.close();
    },
  };
};
