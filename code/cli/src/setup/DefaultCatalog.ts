// Bootstraps the one canonical default catalog at the immutable revision shipped by Outfitter.
import { statSync } from 'node:fs';
import { join } from 'node:path';

import { runGit, syncRemoteRepositoryAtomically, tryReadCleanHead } from '../sources/GitRepository.js';
import {
  createRemoteRepositoryCachePath,
  encodeRemoteSourceSelection,
  formatRemoteSourceDisplay,
  isImmutableRef,
  isVersionTagRef,
  redactEmbeddedSourceCredentials,
} from '../sources/SourceCache.js';
import type { RemoteSourceReference } from '../sources/SourceCache.js';
import { readDeclaredRemoteSources } from '../sources/TransitiveSources.js';

/** Fetches one repository into the cache. Injectable so tests exercise bootstrap hermetically. */
export type RepositorySync = typeof syncRemoteRepositoryAtomically;

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
  readonly syncRepository?: RepositorySync;
  /**
   * Proves a fetched checkout is a usable catalog. Defaults to requiring `agents/` — the picker root
   * must offer agents — but a dependency may legitimately ship only skills, so the closure relaxes
   * this to any recognized `.agents` payload directory.
   */
  readonly requirePayload?: (root: string) => boolean;
}

export interface PinnedCatalogBootstrapResult {
  readonly root: string;
  readonly source: RemoteSourceReference & { readonly ref: string };
}

// A recognized payload marker must be a real directory, not merely a path that exists: a repository
// committing a regular file named `agents` is not a catalog and must not validate as one.
const isDirectory = (path: string): boolean => {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
};

const hasAgentsDirectory = (root: string): boolean => isDirectory(join(root, 'agents'));

// Any directory the resolver treats as a `.agents` payload container, colocated or at the root.
const hasAnyAgentsPayload = (root: string): boolean =>
  ['agents', 'skills', 'knowledge', 'commands'].some((directory) => isDirectory(join(root, directory))) ||
  isDirectory(join(root, '.agents'));

const assertImmutableRef = (ref: string): void => {
  if (!isImmutableRef(ref)) {
    throw new Error(`Default catalog ref '${ref}' must be a full commit SHA or version tag.`);
  }
};

const resolveExpectedCommit = (root: string, ref: string): string =>
  isVersionTagRef(ref) ? runGit(['-C', root, 'rev-parse', `refs/tags/${ref}^{commit}`]) : ref;

const isPinnedCatalogCheckout = (root: string, ref: string, hasPayload: (root: string) => boolean): boolean => {
  if (!hasPayload(root)) return false;
  try {
    return tryReadCleanHead(root) === resolveExpectedCommit(root, ref);
  } catch {
    return false;
  }
};

/** Fetches one immutable catalog revision into the same cache path used by normal source resolution. */
export const bootstrapPinnedCatalog = (input: PinnedCatalogBootstrapInput): PinnedCatalogBootstrapResult => {
  assertImmutableRef(input.source.ref);
  const hasPayload = input.requirePayload ?? hasAgentsDirectory;
  const root = createRemoteRepositoryCachePath(input.homeDirectory, input.source, input.cacheDirectory);
  if (isPinnedCatalogCheckout(root, input.source.ref, hasPayload)) return { root, source: input.source };

  try {
    (input.syncRepository ?? syncRemoteRepositoryAtomically)({
      cachePath: root,
      fetchRef: isVersionTagRef(input.source.ref)
        ? `refs/tags/${input.source.ref}:refs/tags/${input.source.ref}`
        : input.source.ref,
      source: input.source,
      // Validated with the same predicate the read path uses. A fresh checkout is not clean by
      // construction — autocrlf, an LFS smudge, or a fileMode difference can leave it dirty — and
      // accepting a dirty tree here would cache one that `tryReadCleanHead` rejects on every
      // subsequent read, re-fetching forever.
      validate: (temporaryRoot) => {
        if (!isPinnedCatalogCheckout(temporaryRoot, input.source.ref, hasPayload)) {
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

/**
 * Bootstraps a pinned catalog and the pinned `github:` closure it declares, so a fresh install can
 * resolve a default profile whose skills live in a depended-on catalog (the founder profile's
 * persona skills, shipped by community-profiles) without a manual `outfitter sync`. The root failing
 * to fetch is fatal (existing behavior); a declared dependency failing to fetch is best-effort —
 * resolution reports it as unsynchronized rather than blocking setup on it.
 */
export const bootstrapPinnedClosure = (input: PinnedCatalogBootstrapInput): PinnedCatalogBootstrapResult => {
  const rootResult = bootstrapPinnedCatalog(input);
  const visited = new Set([encodeRemoteSourceSelection(input.source)]);

  let frontier: readonly { readonly root: string; readonly label: string }[] = [
    { root: rootResult.root, label: formatRemoteSourceDisplay(input.source) },
  ];
  while (frontier.length > 0) {
    const next: { readonly root: string; readonly label: string }[] = [];

    for (const parent of frontier) {
      // A `github:` closure is always path-less, so the payload root is the checkout root.
      for (const declared of readDeclaredRemoteSources(parent.root, parent.root, parent.label).sources) {
        const key = encodeRemoteSourceSelection(declared.source);
        if (visited.has(key)) continue;
        visited.add(key);
        try {
          next.push({
            root: bootstrapPinnedCatalog({
              homeDirectory: input.homeDirectory,
              cacheDirectory: input.cacheDirectory,
              source: declared.source,
              syncRepository: input.syncRepository,
              // A dependency may ship only skills; do not require it to contain agents/.
              requirePayload: hasAnyAgentsPayload,
            }).root,
            label: formatRemoteSourceDisplay(declared.source),
          });
        } catch {
          // Best-effort: a dependency that cannot be fetched is surfaced by resolution as an
          // unsynchronized source (with `outfitter sync` guidance), never a setup-blocking throw.
        }
      }
    }

    frontier = next;
  }

  return rootResult;
};

/* v8 ignore next 2 -- the production entry fetches the real default catalog from github.com; tests
   drive bootstrapPinnedClosure directly and SetupCommand injects a fake bootstrap. */
export const bootstrapDefaultCatalog = (homeDirectory: string, cacheDirectory?: string): PinnedCatalogBootstrapResult =>
  bootstrapPinnedClosure({ homeDirectory, cacheDirectory, source: defaultCatalogSource });
