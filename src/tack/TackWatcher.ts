// Watches tack inputs while an agent process runs and rewrites generated tack files.
import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { dirname, join } from 'node:path';

import type { Tack } from './Tack.js';
import { writeTack } from './TackAssembler.js';

export interface TackWatchPlan {
  readonly paths: readonly string[];
}

export interface TackWatcherHandle {
  close(): void;
}

export interface WatchTackInput {
  readonly tack: Tack;
  readonly warn: (message: string) => void;
  readonly refreshTack?: () => Tack;
  readonly onTackWritten?: (tack: Tack) => void;
}

export const createTackWatchPlan = (paths: readonly string[]): TackWatchPlan => ({
  paths,
});

export const createTackWatchPlanForTack = (tack: Tack): TackWatchPlan =>
  createTackWatchPlan([...new Set(tack.files.flatMap((file) => file.sourceInputs))]);

export const watchTackInputs = (input: WatchTackInput): TackWatcherHandle => {
  const watchPaths = createTackWatchPlanForTack(input.tack).paths;
  const watchers: FSWatcher[] = [];

  for (const watchPath of watchPaths) {
    try {
      watchers.push(
        watch(
          watchPath,
          /* v8 ignore next -- fs.watch delivery is platform-timed; the static watch plan is covered deterministically. */
          () => updateTackFromWatchedInput(input, watchPath),
        ),
      );
    } catch (error) {
      input.warn(`Could not watch tack input ${watchPath}: ${formatError(error)}`);
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

export const createProfileWatchPaths = (profilePaths: readonly string[]): readonly string[] => [
  ...new Set(profilePaths.map((profilePath) => dirname(profilePath))),
];

export const tackFileOutputPath = (tack: Tack, relativePath: string): string => join(tack.rootDirectory, relativePath);

const updateTackFromWatchedInput = (input: WatchTackInput, watchPath: string): void => {
  try {
    const tack = input.refreshTack?.() ?? input.tack;
    writeTack(tack, { materializeStatePaths: false });
    input.onTackWritten?.(tack);
  } catch (error) {
    /* v8 ignore next -- unsafe live-update failures are reported defensively; normal refresh behavior is covered. */
    input.warn(`Could not safely update tack from ${watchPath}: ${formatError(error)}`);
  }
};

const formatError = (error: unknown): string => String(error);
