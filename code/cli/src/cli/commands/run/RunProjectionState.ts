// Owns runtime-projection write accounting around one harness process launch.
import { join } from 'node:path';

import { resolveOutfitterCacheDir } from '../../../paths/OutfitterCache.js';
import type { ProjectedStatePath } from '../../../projection/Projection.js';
import {
  createProjectionSessionJournal,
  createProjectionStateBaseline,
  detectUndeclaredProjectionWrites,
  reportAndClearProjectionSessionJournals,
  watchProjectionStateWrites,
} from '../../../projection/ProjectionStateMonitor.js';
import type { ProjectionStateMonitorDependencies } from '../../../projection/ProjectionStateMonitor.js';

export interface RunProjectionStateInput {
  readonly rootDirectory: string;
  readonly homeDirectory: string;
  readonly harness: string;
  readonly agent: string;
  readonly statePaths: readonly ProjectedStatePath[];
  readonly launch: () => Promise<number>;
  readonly notify: (message: string) => void;
  readonly monitor?: ProjectionStateMonitorDependencies;
}

export interface RunProjectionStateResult {
  readonly exitCode: number;
  readonly warnings: readonly string[];
}

const formatWriteWarning = (harness: string, relativePath: string): string =>
  `${harness} wrote undeclared runtime projection state '${relativePath}' and it was not persisted.`;

export const runWithProjectionStateMonitoring = async (
  input: RunProjectionStateInput,
): Promise<RunProjectionStateResult> => {
  const journalDirectory = join(resolveOutfitterCacheDir(process.env, input.homeDirectory), 'session-journals');
  reportAndClearProjectionSessionJournals(journalDirectory, input.notify);

  const baseline = createProjectionStateBaseline(input.rootDirectory);
  const journal = createProjectionSessionJournal({
    journalDirectory,
    harness: input.harness,
    agent: input.agent,
    rootDirectory: input.rootDirectory,
    baseline,
  });
  const monitor = watchProjectionStateWrites({
    rootDirectory: input.rootDirectory,
    harness: input.harness,
    baseline,
    statePaths: input.statePaths,
    notify: input.notify,
    warn: input.notify,
    journal,
    ...input.monitor,
  });

  try {
    const exitCode = await input.launch();
    monitor.close();
    const warnings = detectUndeclaredProjectionWrites(input.rootDirectory, baseline, input.statePaths).map((path) =>
      formatWriteWarning(input.harness, path),
    );
    return { exitCode, warnings };
  } finally {
    monitor.close();
    // Only an abrupt process termination leaves a journal for the next invocation.
    journal.discard();
  }
};
