// Encodes remote `.agents` source cache paths and normalizes remote source references.
import { isAbsolute, join, posix, relative, resolve } from 'node:path';

/** A remote `.agents` source: a git URI or a `github` shorthand, with an optional ref. */
export type RemoteSourceReference =
  | { readonly uri: string; readonly github?: never; readonly ref?: string; readonly path?: string }
  | { readonly github: string; readonly uri?: never; readonly ref?: string; readonly path?: string };

/** Distinguishes remote (`uri`/`github`) sources from local `path` sources. */
export const isRemoteSource = <T extends { readonly uri?: string; readonly github?: string }>(
  source: T,
): source is T & RemoteSourceReference => source.uri !== undefined || source.github !== undefined;

const fullCommitPattern = /^[a-f0-9]{40}$/u;
const versionTagPattern = /^v\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u;

/** True for a ref that names one immutable revision: a full commit SHA or a version tag. */
export const isImmutableRef = (ref: string): boolean => fullCommitPattern.test(ref) || versionTagPattern.test(ref);

/** True for an immutable ref that must be resolved to a commit via `rev-parse` (a version tag). */
export const isVersionTagRef = (ref: string): boolean => versionTagPattern.test(ref);

export const normalizeGitUri = (uri: string): string => (uri.startsWith('git+') ? uri.slice('git+'.length) : uri);

export const normalizeRemoteSourceUri = (source: RemoteSourceReference): string => {
  if (source.uri !== undefined) {
    return source.uri;
  }

  return `git+https://github.com/${source.github}.git`;
};

export const formatRemoteSourceDisplay = (source: RemoteSourceReference): string =>
  source.github === undefined
    ? redactSourceUriCredentials(source.uri)
    : `github:${source.github}${source.ref === undefined ? '' : `#${source.ref}`}`;

export const redactSourceUriCredentials = (uri: string): string => {
  const prefix = uri.startsWith('git+') ? 'git+' : '';
  const normalizedUri = normalizeGitUri(uri);

  try {
    const parsedUri = new URL(normalizedUri);

    if (parsedUri.username === '' && parsedUri.password === '') {
      return uri;
    }

    parsedUri.username = 'REDACTED';
    parsedUri.password = '';
    return `${prefix}${parsedUri.toString()}`;
  } catch {
    return uri.replace(/\/\/[^/@\s]+@/gu, '//REDACTED@');
  }
};

/** Redacts credentials from every URI embedded in arbitrary command or stderr text. */
export const redactEmbeddedSourceCredentials = (value: string): string =>
  value.replace(/((?:git\+)?[A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/@\s]+@/gu, '$1REDACTED@');

export const encodeSourceUri = (uri: string): string =>
  Buffer.from(redactSourceUriCredentials(uri), 'utf8').toString('base64url');

export const encodeRemoteSource = (source: RemoteSourceReference): string =>
  encodeSourceUri(`${normalizeRemoteSourceUri(source)}#${source.ref ?? ''}`);

// The payload subpath a source selects, canonicalized so identical selections share one identity:
// an omitted path, `.`, `./`, and `foo/..` all normalize to the repository root ('').
const canonicalSourcePath = (path?: string): string => {
  if (path === undefined) return '';
  const normalized = posix.normalize(path).replace(/\/+$/u, '');
  return normalized === '.' ? '' : normalized;
};

/**
 * A source's graph identity for dedup, visited sets, and layer ordering. It differs from
 * {@link encodeRemoteSource} (the *checkout cache* key) in two deliberate ways:
 *
 * - It includes the canonicalized `path`, because two sources into different subpaths of one repo+ref
 *   are distinct layers — deduping them on the path-less cache key would silently drop one.
 * - It keys on the *raw* normalized URI, credentials included, not the redacted cache key. Two entries
 *   for the same repo with different credentials are distinct configured sources; collapsing them
 *   (the cache key redacts credentials, so both share it) could drop a valid source for a broken one.
 *   This value is used only in ephemeral in-memory dedup/visited sets — never persisted or logged —
 *   so carrying credentials here is safe (the cache path and every user-facing display use the
 *   redacted forms).
 */
export const encodeRemoteSourceSelection = (source: RemoteSourceReference): string =>
  `${normalizeRemoteSourceUri(source)}#${source.ref ?? ''} ${canonicalSourcePath(source.path)}`;

/** Resolves the one cache root used by sync, settings, layer discovery, and setup bootstrap. */
export const resolveRemoteRepositoryCacheRoot = (homeDirectory: string, cacheDirectory?: string): string =>
  cacheDirectory ?? join(homeDirectory, '.agents', 'cache');

export const createRemoteRepositoryCachePath = (
  homeDirectory: string,
  source: RemoteSourceReference,
  cacheDirectory?: string,
): string => join(resolveRemoteRepositoryCacheRoot(homeDirectory, cacheDirectory), 'repos', encodeRemoteSource(source));

/** The `.agents` payload root a source selects inside its materialized repository checkout. */
export const resolveSourcePayloadRoot = (repositoryPath: string, source: RemoteSourceReference): string =>
  source.path === undefined ? repositoryPath : resolveRemoteRepositorySubpath(repositoryPath, source.path);

export const resolveRemoteRepositorySubpath = (repositoryPath: string, subpath = ''): string => {
  if (isAbsolute(subpath)) {
    throw new Error(`Remote repository path '${subpath}' must be relative.`);
  }

  const resolvedPath = resolve(repositoryPath, subpath);
  const relativePath = relative(repositoryPath, resolvedPath);

  if (relativePath === '..' || relativePath.startsWith('../') || isAbsolute(relativePath)) {
    throw new Error(`Remote repository path '${subpath}' must stay inside the repository.`);
  }

  return resolvedPath;
};
