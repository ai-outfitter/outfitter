// Encodes remote `.agents` source cache paths and normalizes remote source references.
import { isAbsolute, join, relative, resolve } from 'node:path';

/** A remote `.agents` source: a git URI or a `github` shorthand, with an optional ref. */
export type RemoteSourceReference =
  | { readonly uri: string; readonly github?: never; readonly ref?: string; readonly path?: string }
  | { readonly github: string; readonly uri?: never; readonly ref?: string; readonly path?: string };

/** Distinguishes remote (`uri`/`github`) sources from local `path` sources. */
export const isRemoteSource = <T extends { readonly uri?: string; readonly github?: string }>(
  source: T,
): source is T & RemoteSourceReference => source.uri !== undefined || source.github !== undefined;

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

/** Resolves the one cache root used by sync, settings, layer discovery, and setup bootstrap. */
export const resolveRemoteRepositoryCacheRoot = (homeDirectory: string, cacheDirectory?: string): string =>
  cacheDirectory ?? join(homeDirectory, '.agents', 'cache');

export const createRemoteRepositoryCachePath = (
  homeDirectory: string,
  source: RemoteSourceReference,
  cacheDirectory?: string,
): string => join(resolveRemoteRepositoryCacheRoot(homeDirectory, cacheDirectory), 'repos', encodeRemoteSource(source));

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
