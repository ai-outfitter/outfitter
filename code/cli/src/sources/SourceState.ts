import { mkdirSync, openSync, closeSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { AtomicRepositorySyncResult } from './GitRepository.js';
import { tryReadCleanHead } from './GitRepository.js';
import {
  encodeRemoteSource,
  normalizeRemoteSourceUri,
  redactSourceUriCredentials,
  resolveRemoteRepositoryCacheRoot,
} from './SourceCache.js';
import type { RemoteSourceReference } from './SourceCache.js';

export const SOURCE_STATE_VERSION = 1;

export interface SourceStateManifest {
  readonly version: 1;
  readonly source: string;
  readonly requestedRef: string | null;
  readonly resolvedCommit: string;
  readonly cacheKey: string;
}

export type SourceCacheHealth = 'healthy' | 'missing' | 'dirty' | 'legacy' | 'mismatched' | 'unverified';

export const sourceStatePath = (
  homeDirectory: string,
  source: RemoteSourceReference,
  cacheDirectory?: string,
): string =>
  join(
    resolveRemoteRepositoryCacheRoot(homeDirectory, cacheDirectory),
    'source-state',
    `${encodeRemoteSource(source)}.json`,
  );

const sourceStatePathForCache = (cachePath: string, source: RemoteSourceReference): string =>
  join(dirname(dirname(cachePath)), 'source-state', `${encodeRemoteSource(source)}.json`);

const sourceIdentity = (source: RemoteSourceReference): string =>
  redactSourceUriCredentials(normalizeRemoteSourceUri(source));

export const readSourceState = (path: string): SourceStateManifest | undefined => {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<SourceStateManifest>;
    if (
      value.version !== SOURCE_STATE_VERSION ||
      typeof value.source !== 'string' ||
      !(typeof value.requestedRef === 'string' || value.requestedRef === null) ||
      typeof value.resolvedCommit !== 'string' ||
      typeof value.cacheKey !== 'string'
    )
      return undefined;
    return value as SourceStateManifest;
  } catch {
    return undefined;
  }
};

export const inspectSourceCache = (input: {
  readonly homeDirectory: string;
  readonly cacheDirectory?: string;
  readonly cachePath: string;
  readonly source: RemoteSourceReference;
}): { readonly health: SourceCacheHealth; readonly commit?: string; readonly manifest?: SourceStateManifest } => {
  const commit = tryReadCleanHead(input.cachePath);
  if (commit === undefined) {
    try {
      readFileSync(join(input.cachePath, '.git', 'HEAD'));
      return { health: 'dirty' };
    } catch {
      return { health: 'missing' };
    }
  }
  const manifest = readSourceState(sourceStatePathForCache(input.cachePath, input.source));
  if (manifest === undefined) return { health: 'legacy', commit };
  if (
    manifest.source !== sourceIdentity(input.source) ||
    manifest.requestedRef !== (input.source.ref ?? null) ||
    manifest.cacheKey !== encodeRemoteSource(input.source) ||
    manifest.resolvedCommit !== commit
  )
    return { health: 'mismatched', commit, manifest };
  return { health: 'healthy', commit, manifest };
};

export const writeSourceState = (input: {
  readonly homeDirectory: string;
  readonly cacheDirectory?: string;
  readonly source: RemoteSourceReference;
  readonly commit: string;
  readonly cachePath?: string;
}): void => {
  const path =
    input.cachePath === undefined
      ? sourceStatePath(input.homeDirectory, input.source, input.cacheDirectory)
      : sourceStatePathForCache(input.cachePath, input.source);
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.tmp`;
  const manifest: SourceStateManifest = {
    version: SOURCE_STATE_VERSION,
    source: sourceIdentity(input.source),
    requestedRef: input.source.ref ?? null,
    resolvedCommit: input.commit,
    cacheKey: encodeRemoteSource(input.source),
  };
  writeFileSync(temporary, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
};

export const withSourceLock = <T>(cachePath: string, action: () => T): T => {
  const lock = `${cachePath}.outfitter.lock`;
  mkdirSync(dirname(lock), { recursive: true });
  const deadline = Date.now() + 300_000;
  let descriptor: number | undefined;
  while (descriptor === undefined) {
    try {
      descriptor = openSync(lock, 'wx', 0o600);
    } catch (error) {
      /* v8 ignore next -- non-EEXIST open failures and a five-minute lock timeout are OS boundaries. */
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || Date.now() >= deadline) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
  try {
    return action();
  } finally {
    closeSync(descriptor);
    rmSync(lock, { force: true });
  }
};

export const unchangedResult = (commit: string): AtomicRepositorySyncResult => ({
  commit,
  status: 'unchanged',
  warnings: 0,
});
