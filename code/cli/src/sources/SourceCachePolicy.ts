import { mkdirSync, renameSync } from 'node:fs';
import { dirname } from 'node:path';

import { executeSyncCommand } from '../cli/commands/SyncCommand.js';
import type { RepositorySync } from '../cli/commands/SyncCommand.js';
import type { SourceCachePolicy } from '../settings/Settings.js';
import { syncRemoteRepositoryAtomically } from './GitRepository.js';
import { inspectSourceCache, unchangedResult, withSourceLock, writeSourceState } from './SourceState.js';

const fullCommitPattern = /^[a-f0-9]{40}$/u;

export interface PrepareSourceCachesInput {
  readonly homeDirectory: string;
  readonly projectDirectory: string;
  readonly policy: SourceCachePolicy;
}

export interface PrepareSourceCachesResult {
  readonly messages: readonly string[];
}

const quarantine = (cachePath: string): string => {
  const destination = `${cachePath}.outfitter-quarantine-${new Date().toISOString().replace(/[:.]/gu, '-')}-${process.pid}`;
  mkdirSync(dirname(destination), { recursive: true });
  renameSync(cachePath, destination);
  return destination;
};

const policyRepositorySync =
  (input: PrepareSourceCachesInput): RepositorySync =>
  (request) =>
    withSourceLock(request.cachePath, () => {
      if (input.policy === 'locked' && !fullCommitPattern.test(request.source.ref ?? '')) {
        throw new Error('Locked source-cache policy requires a full 40-character commit pin.');
      }
      const state = inspectSourceCache({
        homeDirectory: input.homeDirectory,
        cachePath: request.cachePath,
        source: request.source,
      });

      if (state.health === 'healthy' && state.commit !== undefined) return unchangedResult(state.commit);
      if (input.policy === 'offline') {
        throw new Error(`Source cache is ${state.health}; offline policy prohibits repair.`);
      }

      const quarantined = state.health === 'dirty' ? quarantine(request.cachePath) : undefined;
      const result = syncRemoteRepositoryAtomically(request);
      writeSourceState({
        homeDirectory: input.homeDirectory,
        source: request.source,
        commit: result.commit,
        cachePath: request.cachePath,
      });
      return {
        ...result,
        warnings: result.warnings + (quarantined === undefined ? 0 : 1),
      };
    });

/** Establishes every declared remote before resolution; local layers are never passed to sync. */
export const prepareSourceCaches = (input: PrepareSourceCachesInput): PrepareSourceCachesResult => {
  const result = executeSyncCommand(
    { homeDirectory: input.homeDirectory, projectDirectory: input.projectDirectory },
    { syncRepository: policyRepositorySync(input) },
  );
  if (result.exitCode !== 0) {
    throw new Error(`Source-cache ${input.policy} policy failed before composition: ${result.messages.join('; ')}`);
  }
  return { messages: result.messages };
};
