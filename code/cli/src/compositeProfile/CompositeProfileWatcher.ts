// Watches composite profile inputs while an agent process runs and rewrites generated compositeProfile files.
import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { sep as posixSeparator } from 'node:path/posix';

import type { CompositeProfile } from './CompositeProfile.js';
import { writeCompositeProfile } from './CompositeProfileAssembler.js';
import { isUndeclaredCompositeProfileWritePath } from './StatePersistence.js';
import type { CompositeProfileSessionJournal } from './CompositeProfileSessionJournal.js';

export interface CompositeProfileWatchPlan {
  readonly paths: readonly string[];
}

export interface CompositeProfileWatcherHandle {
  close(): void;
}

export interface WatchCompositeProfileInput {
  readonly compositeProfile: CompositeProfile;
  readonly warn: (message: string) => void;
  readonly refreshCompositeProfile?: () => CompositeProfile;
  readonly onCompositeProfileWritten?: (compositeProfile: CompositeProfile) => void;
}

export const createCompositeProfileWatchPlan = (paths: readonly string[]): CompositeProfileWatchPlan => ({
  paths,
});

export const createCompositeProfileWatchPlanForCompositeProfile = (
  compositeProfile: CompositeProfile,
): CompositeProfileWatchPlan =>
  createCompositeProfileWatchPlan([...new Set(compositeProfile.files.flatMap((file) => file.sourceInputs))]);

export const watchCompositeProfileInputs = (input: WatchCompositeProfileInput): CompositeProfileWatcherHandle => {
  const watchPaths = createCompositeProfileWatchPlanForCompositeProfile(input.compositeProfile).paths;
  const watchers: FSWatcher[] = [];

  for (const watchPath of watchPaths) {
    try {
      watchers.push(
        watch(
          watchPath,
          /* v8 ignore next -- fs.watch delivery is platform-timed; the static watch plan is covered deterministically. */
          () => updateCompositeProfileFromWatchedInput(input, watchPath),
        ),
      );
    } catch (error) {
      input.warn(`Could not watch composite profile input ${watchPath}: ${formatError(error)}`);
    }
  }

  return {
    close() {
      for (const watcher of watchers) {
        watcher.close();
      }
    },
  };
};

export interface WatchCompositeProfileStateWritesInput {
  readonly compositeProfile: CompositeProfile;
  readonly agentId: string;
  readonly notify: (message: string) => void;
  readonly warn: (message: string) => void;
  readonly journal?: Pick<CompositeProfileSessionJournal, 'recordUndeclaredWrites'>;
  readonly throttleMs?: number;
  readonly watchFactory?: typeof watch;
}

export const defaultStateWriteNoticeThrottleMs = 1000;

// Watches the composite profile root while the agent runs and surfaces undeclared writes in
// near real time. Notices are deduplicated per path and flushed on a throttle interval;
// journal records happen immediately so a crash loses as little accounting as possible. The
// exit-time fingerprint diff remains the authoritative final pass, so pending notices are
// dropped on close instead of double-reporting.
export const watchCompositeProfileStateWrites = (
  input: WatchCompositeProfileStateWritesInput,
): CompositeProfileWatcherHandle => {
  const unknownStatePath = input.compositeProfile.statePaths.find((statePath) => statePath.relativePath === 'unknown');

  if (unknownStatePath?.strategy === 'discard') {
    return { close: () => undefined };
  }

  const monitor = createStateWriteMonitor(input);
  let watcher: FSWatcher | undefined;

  try {
    watcher = (input.watchFactory ?? watch)(
      input.compositeProfile.rootDirectory,
      { recursive: true },
      /* v8 ignore next -- fs.watch delivery is platform-timed; monitor behavior is driven directly through an injected watch factory. */
      (_eventType, filename) => monitor.handleWatchEvent(filename),
    );
  } catch (error) {
    input.warn(`Could not watch composite profile state writes: ${formatError(error)}`);
  }

  return {
    close() {
      monitor.close();
      watcher?.close();
    },
  };
};

const createStateWriteMonitor = (input: WatchCompositeProfileStateWritesInput) => {
  const generatedFilePaths = input.compositeProfile.files.map((file) => file.relativePath);
  const observedPaths = new Set<string>();
  const pendingNotices: string[] = [];
  let flushTimer: NodeJS.Timeout | undefined;
  let closed = false;

  const flush = (): void => {
    flushTimer = undefined;

    for (const relativePath of pendingNotices.splice(0)) {
      input.notify(
        `${input.agentId} is writing undeclared composite profile state '${relativePath}' ` +
          `(undeclared writes are not persisted).`,
      );
    }
  };

  return {
    handleWatchEvent(filename: string | Buffer | null): void {
      if (closed || typeof filename !== 'string' || filename === '') {
        return;
      }

      const relativePath = filename.split(sep).join(posixSeparator);

      if (
        observedPaths.has(relativePath) ||
        !isUndeclaredCompositeProfileWritePath(relativePath, input.compositeProfile.statePaths, generatedFilePaths)
      ) {
        return;
      }

      observedPaths.add(relativePath);
      input.journal?.recordUndeclaredWrites([relativePath]);
      pendingNotices.push(relativePath);
      flushTimer ??= setTimeout(flush, input.throttleMs ?? defaultStateWriteNoticeThrottleMs).unref();
    },
    close(): void {
      closed = true;

      if (flushTimer !== undefined) {
        clearTimeout(flushTimer);
        flushTimer = undefined;
      }
    },
  };
};

export const createProfileWatchPaths = (profilePaths: readonly string[]): readonly string[] => [
  ...new Set(profilePaths.map((profilePath) => dirname(profilePath))),
];

export const compositeProfileFileOutputPath = (compositeProfile: CompositeProfile, relativePath: string): string =>
  join(compositeProfile.rootDirectory, relativePath);

const updateCompositeProfileFromWatchedInput = (input: WatchCompositeProfileInput, watchPath: string): void => {
  try {
    const compositeProfile = input.refreshCompositeProfile?.() ?? input.compositeProfile;
    writeCompositeProfile(compositeProfile, { materializeStatePaths: false });
    input.onCompositeProfileWritten?.(compositeProfile);
  } catch (error) {
    /* v8 ignore next -- unsafe live-update failures are reported defensively; normal refresh behavior is covered. */
    input.warn(`Could not safely update compositeProfile from ${watchPath}: ${formatError(error)}`);
  }
};

const formatError = (error: unknown): string => String(error);
