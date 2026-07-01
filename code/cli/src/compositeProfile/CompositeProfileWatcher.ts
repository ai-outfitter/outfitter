// Watches composite profile inputs while an agent process runs and rewrites generated compositeProfile files.
import { watch } from 'node:fs';
import type { FSWatcher } from 'node:fs';
import { dirname, join } from 'node:path';

import type { CompositeProfile } from './CompositeProfile.js';
import { writeCompositeProfile } from './CompositeProfileAssembler.js';

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
  let closed = false;

  for (const watchPath of watchPaths) {
    try {
      watchers.push(watch(watchPath, () => updateCompositeProfileFromWatchedInput(input, watchPath)));
    } catch (error) {
      input.warn(`Could not watch composite profile input ${watchPath}: ${formatError(error)}`);
    }
  }

  if (watchPaths.length > 0) {
    setImmediate(() => {
      if (!closed) {
        updateCompositeProfileFromWatchedInput(input, watchPaths[0]);
      }
    });
  }

  return {
    close() {
      closed = true;
      for (const watcher of watchers) {
        watcher.close();
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
    input.warn(`Could not safely update compositeProfile from ${watchPath}: ${formatError(error)}`);
  }
};

const formatError = (error: unknown): string => String(error);
