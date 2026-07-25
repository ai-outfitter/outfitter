// Atomically fetches Git repositories while preserving the last known-good cache on failure.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { normalizeGitUri, normalizeRemoteSourceUri, redactEmbeddedSourceCredentials } from './SourceCache.js';
import type { RemoteSourceReference } from './SourceCache.js';

export interface AtomicRepositorySyncInput<T> {
  readonly cachePath: string;
  /** Optional fetch refspec used when verification needs a local ref (for example an immutable tag). */
  readonly fetchRef?: string;
  readonly source: RemoteSourceReference;
  /** Inspects the fetched checkout before it is swapped in; throwing rejects the fetch. */
  readonly validate?: (repositoryPath: string, commit: string) => T;
}

export interface AtomicRepositorySyncResult<T> {
  readonly commit: string;
  readonly status: 'updated' | 'unchanged';
  readonly validation: T | undefined;
}

/** Runs one git invocation, raising captured stderr as a credential-redacted Error. */
export const runGit = (arguments_: readonly string[]): string => {
  const result = spawnSync('git', [...arguments_], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  if (result.error === undefined && result.status === 0) {
    return result.stdout.trim();
  }

  const detail = [result.error?.message, result.stderr, result.stdout]
    .filter((value): value is string => value !== undefined && value.trim() !== '')
    .join('\n');
  const command = `git ${arguments_.join(' ')}`;
  let suffix = `: ${detail.trim()}`;
  /* v8 ignore else -- spawn failures always provide an Error or captured process output. */
  if (detail === '') suffix = '';
  throw new Error(redactEmbeddedSourceCredentials(`${command} failed${suffix}`));
};

/** Reads the HEAD commit of a checkout, or undefined when it is missing, dirty, or unreadable. */
export const tryReadCleanHead = (root: string): string | undefined => {
  if (!existsSync(join(root, '.git'))) return undefined;

  try {
    if (runGit(['-C', root, 'status', '--porcelain']) !== '') return undefined;
    return runGit(['-C', root, 'rev-parse', 'HEAD']);
  } catch {
    return undefined;
  }
};

const fetchSource = (temporaryRoot: string, source: RemoteSourceReference, fetchRef?: string): string => {
  const remote = normalizeGitUri(normalizeRemoteSourceUri(source));
  const ref = fetchRef ?? source.ref;
  runGit(['init', '--quiet', temporaryRoot]);
  runGit(['-C', temporaryRoot, 'remote', 'add', 'origin', remote]);
  runGit(['-C', temporaryRoot, 'fetch', '--quiet', '--depth=1', 'origin', ...(ref === undefined ? [] : [ref])]);
  runGit(['-C', temporaryRoot, 'checkout', '--quiet', '--detach', 'FETCH_HEAD']);
  return runGit(['-C', temporaryRoot, 'rev-parse', 'HEAD']);
};

/**
 * Fetches into a temporary sibling and swaps only a validated checkout into place. A failed fetch,
 * checkout, validation, or rename leaves an existing cache intact.
 */
export const syncRemoteRepositoryAtomically = <T = void>(
  input: AtomicRepositorySyncInput<T>,
): AtomicRepositorySyncResult<T> => {
  mkdirSync(dirname(input.cachePath), { recursive: true });
  const nonce = `${process.pid}-${Math.random().toString(16).slice(2)}`;
  const temporaryRoot = `${input.cachePath}.outfitter-${nonce}.tmp`;
  const staleRoot = `${input.cachePath}.outfitter-${nonce}.stale`;
  let movedStaleCache = false;

  try {
    const commit = fetchSource(temporaryRoot, input.source, input.fetchRef);
    const validation = input.validate?.(temporaryRoot, commit);

    if (tryReadCleanHead(input.cachePath) === commit) {
      return { commit, status: 'unchanged', validation };
    }

    if (existsSync(input.cachePath)) {
      renameSync(input.cachePath, staleRoot);
      movedStaleCache = true;
    }
    renameSync(temporaryRoot, input.cachePath);
    if (movedStaleCache) rmSync(staleRoot, { recursive: true, force: true });
    return { commit, status: 'updated', validation };
  } catch (error) {
    /* v8 ignore next -- only an OS-level failure during the atomic rename needs restoration. */
    if (movedStaleCache && !existsSync(input.cachePath) && existsSync(staleRoot)) {
      renameSync(staleRoot, input.cachePath);
    }
    throw error;
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
    rmSync(staleRoot, { recursive: true, force: true });
  }
};
