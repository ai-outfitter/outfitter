// Removes temporary composite profile directories on process exit and handled signals, and
// sweeps stale leftovers from earlier crashed runs. Composite directories contain symlinks
// into real auth/settings state, so removal must delete the links without ever following
// them to their targets; rmSync satisfies that because it unlinks symlink entries instead of
// traversing into their targets.
import { lstatSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const pendingDirectories = new Set<string>();
const installedProcesses = new WeakSet<NodeJS.Process>();
const cleanupSignals: readonly NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];

// Cleanup is deferred to process exit (rather than performed inline when a run finishes) so
// the composite directory stays inspectable for the rest of the process lifetime, and so a
// single set of handlers covers every registered run.
export const registerCompositeProfileDirectoryCleanup = (
  directory: string,
  processObject: NodeJS.Process = process,
): void => {
  pendingDirectories.add(directory);
  installCompositeProfileCleanupHandlers(processObject);
};

export const executeCompositeProfileDirectoryCleanup = (): readonly string[] => {
  const removed: string[] = [];

  for (const directory of pendingDirectories) {
    try {
      rmSync(directory, { recursive: true, force: true });
      removed.push(directory);
    } catch {
      // Best-effort teardown: a failed removal must not mask the process's own exit path.
    }
  }

  pendingDirectories.clear();
  return removed;
};

const installCompositeProfileCleanupHandlers = (processObject: NodeJS.Process): void => {
  if (installedProcesses.has(processObject)) {
    return;
  }

  installedProcesses.add(processObject);
  processObject.once('exit', () => void executeCompositeProfileDirectoryCleanup());

  for (const signal of cleanupSignals) {
    processObject.once(signal, () => handleCompositeProfileCleanupSignal(processObject, signal));
  }
};

// Session journals are stored under ~/.outfitter/state rather than the composite directory,
// so signal-time cleanup removes the temporary directory while leaving any crash journal in
// place to be reported by the next invocation.
const handleCompositeProfileCleanupSignal = (processObject: NodeJS.Process, signal: NodeJS.Signals): void => {
  executeCompositeProfileDirectoryCleanup();
  // The once-registered handler has already been removed, so re-raising terminates the
  // process with conventional signal semantics unless another handler intervenes.
  processObject.kill(processObject.pid, signal);
};

export const defaultCompositeProfileSweepMaxAgeMs = 7 * 24 * 60 * 60 * 1000;

export interface SweepStaleCompositeProfileDirectoriesInput {
  readonly directory?: string;
  readonly maxAgeMs?: number;
  readonly now?: number;
}

// Best-effort startup sweep of outfitter-* composite directories that crashed runs left in
// the temporary root. Entries are inspected with lstat and symlink entries are skipped, so
// the sweep never follows a symlink; stale directories are removed with rmSync, which
// deletes contained symlinks without touching their targets.
export const sweepStaleCompositeProfileDirectories = (
  input: SweepStaleCompositeProfileDirectoriesInput = {},
): readonly string[] => {
  const rootDirectory = input.directory ?? tmpdir();
  const maxAgeMs = input.maxAgeMs ?? defaultCompositeProfileSweepMaxAgeMs;
  const now = input.now ?? Date.now();
  const removed: string[] = [];

  for (const entryName of listSweepCandidates(rootDirectory)) {
    const entryPath = join(rootDirectory, entryName);

    try {
      const entryStat = lstatSync(entryPath);

      if (!entryStat.isDirectory() || now - entryStat.mtimeMs <= maxAgeMs) {
        continue;
      }

      rmSync(entryPath, { recursive: true, force: true });
      removed.push(entryPath);
      /* v8 ignore next 3 -- entries can vanish between readdir and lstat; the sweep stays best-effort. */
    } catch {
      // Best-effort sweep: unreadable or vanished entries are skipped.
    }
  }

  return removed;
};

const listSweepCandidates = (rootDirectory: string): readonly string[] => {
  try {
    return readdirSync(rootDirectory).filter((entryName) => entryName.startsWith('outfitter-'));
  } catch {
    return [];
  }
};
