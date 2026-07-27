// Bootstraps the one canonical default catalog at the immutable revision shipped by Outfitter.
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { runGit, syncRemoteRepositoryAtomically, tryReadCleanHead } from '../sources/GitRepository.js';
import { createRemoteRepositoryCachePath, redactEmbeddedSourceCredentials } from '../sources/SourceCache.js';
import type { RemoteSourceReference } from '../sources/SourceCache.js';

export const defaultCatalogSource = {
  github: 'ai-outfitter/default-profiles',
  // TODO(release-automation): when default-profiles publishes a new Release Please tag, open a
  // conventional dependency-bump commit in Outfitter so its next Release Please release ships it.
  ref: 'v1.1.0',
} as const satisfies RemoteSourceReference;

export interface PinnedCatalogBootstrapInput {
  readonly homeDirectory: string;
  readonly cacheDirectory?: string;
  readonly source: RemoteSourceReference & { readonly ref: string };
}

export interface PinnedCatalogBootstrapResult {
  readonly root: string;
  readonly source: RemoteSourceReference & { readonly ref: string };
}

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
    return tryReadCleanHead(root) === resolveExpectedCommit(root, ref);
  } catch {
    return false;
  }
};

/** Fetches one immutable catalog revision into the same cache path used by normal source resolution. */
export const bootstrapPinnedCatalog = (input: PinnedCatalogBootstrapInput): PinnedCatalogBootstrapResult => {
  assertImmutableRef(input.source.ref);
  const root = createRemoteRepositoryCachePath(input.homeDirectory, input.source, input.cacheDirectory);
  if (isPinnedCatalogCheckout(root, input.source.ref)) return { root, source: input.source };

  try {
    syncRemoteRepositoryAtomically({
      cachePath: root,
      fetchRef: versionTagPattern.test(input.source.ref)
        ? `refs/tags/${input.source.ref}:refs/tags/${input.source.ref}`
        : input.source.ref,
      source: input.source,
      // Validated with the same predicate the read path uses. A fresh checkout is not clean by
      // construction — autocrlf, an LFS smudge, or a fileMode difference can leave it dirty — and
      // accepting a dirty tree here would cache one that `tryReadCleanHead` rejects on every
      // subsequent read, re-fetching forever.
      validate: (temporaryRoot) => {
        if (!isPinnedCatalogCheckout(temporaryRoot, input.source.ref)) {
          throw new Error(`Fetched default catalog did not resolve to ${input.source.ref}.`);
        }
        return 0;
      },
    });
    return { root, source: input.source };
  } catch (error) {
    const detail = redactEmbeddedSourceCredentials(String(error));
    throw new Error(`Could not fetch the default Outfitter catalog at pinned revision ${input.source.ref}. ${detail}`, {
      cause: error,
    });
  }
};

export const bootstrapDefaultCatalog = (homeDirectory: string, cacheDirectory?: string): PinnedCatalogBootstrapResult =>
  bootstrapPinnedCatalog({ homeDirectory, cacheDirectory, source: defaultCatalogSource });
