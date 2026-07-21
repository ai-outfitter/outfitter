// Bootstraps the one canonical default catalog at the immutable revision shipped by Outfitter.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { createRemoteRepositoryCachePath, normalizeGitUri, normalizeRemoteSourceUri } from '../sources/SourceCache.js';
import type { RemoteSourceReference } from '../sources/SourceCache.js';

export const defaultCatalogSource = {
  github: 'ai-outfitter/default-profiles',
  // TODO(release-automation): when default-profiles publishes a new Release Please tag, open a
  // conventional dependency-bump commit in Outfitter so its next Release Please release ships it.
  ref: 'v1.0.0',
} as const satisfies RemoteSourceReference;

export interface PinnedCatalogBootstrapInput {
  readonly homeDirectory: string;
  readonly source: RemoteSourceReference & { readonly ref: string };
}

export interface PinnedCatalogBootstrapResult {
  readonly root: string;
  readonly source: RemoteSourceReference & { readonly ref: string };
}

const runGit = (arguments_: readonly string[]): string => {
  try {
    return execFileSync('git', [...arguments_], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch (error) {
    throw new Error(`git ${arguments_.join(' ')} failed: ${String(error)}`, { cause: error });
  }
};

const fullCommitPattern = /^[a-f0-9]{40}$/u;
const versionTagPattern = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

const assertImmutableRef = (ref: string): void => {
  if (!fullCommitPattern.test(ref) && !versionTagPattern.test(ref)) {
    throw new Error(`Default catalog ref '${ref}' must be a full commit SHA or version tag.`);
  }
};

const resolveExpectedCommit = (root: string, ref: string): string =>
  fullCommitPattern.test(ref) ? ref : runGit(['-C', root, 'rev-parse', `refs/tags/${ref}^{commit}`]);

const isPinnedCatalogCheckout = (root: string, ref: string): boolean => {
  if (!existsSync(join(root, 'agents'))) return false;
  try {
    return (
      runGit(['-C', root, 'rev-parse', 'HEAD']) === resolveExpectedCommit(root, ref) &&
      runGit(['-C', root, 'status', '--porcelain']) === ''
    );
  } catch {
    return false;
  }
};

/** Fetches one immutable catalog revision into the same cache path used by normal source resolution. */
export const bootstrapPinnedCatalog = (input: PinnedCatalogBootstrapInput): PinnedCatalogBootstrapResult => {
  assertImmutableRef(input.source.ref);
  const root = createRemoteRepositoryCachePath(input.homeDirectory, input.source);
  if (isPinnedCatalogCheckout(root, input.source.ref)) return { root, source: input.source };

  mkdirSync(dirname(root), { recursive: true });
  const nonce = `${process.pid}-${Math.random().toString(16).slice(2)}`;
  const temporaryRoot = `${root}.outfitter-${nonce}.tmp`;
  const staleRoot = `${root}.outfitter-${nonce}.stale`;
  const remote = normalizeGitUri(normalizeRemoteSourceUri(input.source));
  let movedStaleCache = false;

  try {
    runGit(['init', '--quiet', temporaryRoot]);
    runGit(['-C', temporaryRoot, 'remote', 'add', 'origin', remote]);
    const fetchRef = fullCommitPattern.test(input.source.ref)
      ? input.source.ref
      : `refs/tags/${input.source.ref}:refs/tags/${input.source.ref}`;
    runGit(['-C', temporaryRoot, 'fetch', '--quiet', '--depth=1', 'origin', fetchRef]);
    runGit(['-C', temporaryRoot, 'checkout', '--quiet', '--detach', 'FETCH_HEAD']);

    if (!isPinnedCatalogCheckout(temporaryRoot, input.source.ref)) {
      throw new Error(`Fetched default catalog did not resolve to ${input.source.ref}.`);
    }

    if (existsSync(root)) {
      renameSync(root, staleRoot);
      movedStaleCache = true;
    }
    renameSync(temporaryRoot, root);
    if (movedStaleCache) rmSync(staleRoot, { recursive: true, force: true });
    return { root, source: input.source };
  } catch (error) {
    /* v8 ignore next -- only an OS-level failure during the atomic cache rename requires restoration. */
    if (movedStaleCache && !existsSync(root) && existsSync(staleRoot)) renameSync(staleRoot, root);
    const detail = String(error);
    throw new Error(`Could not fetch the default Outfitter catalog at pinned revision ${input.source.ref}. ${detail}`, {
      cause: error,
    });
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true });
    rmSync(staleRoot, { recursive: true, force: true });
  }
};

export const bootstrapDefaultCatalog = (homeDirectory: string): PinnedCatalogBootstrapResult =>
  bootstrapPinnedCatalog({ homeDirectory, source: defaultCatalogSource });
