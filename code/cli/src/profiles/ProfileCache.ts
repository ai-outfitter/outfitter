// Encodes remote profile/source cache paths.
import { isAbsolute, join, relative, resolve } from 'node:path';

import { normalizeRemoteSourceUri, type RemoteSourceReference } from './ProfileSource.js';

export const encodeProfileSourceUri = (uri: string): string =>
  Buffer.from(redactProfileSourceUriCredentials(uri), 'utf8').toString('base64url');

export const encodeRemoteSource = (source: RemoteSourceReference): string =>
  encodeProfileSourceUri(`${normalizeRemoteSourceUri(source)}#${source.ref ?? ''}`);

export const createProfileSourceCachePath = (homeDirectory: string, uri: string): string =>
  join(homeDirectory, '.outfitter', 'cache', 'profiles', encodeProfileSourceUri(uri));

export const createRemoteRepositoryCachePath = (homeDirectory: string, source: RemoteSourceReference): string =>
  join(homeDirectory, '.outfitter', 'cache', 'repos', encodeRemoteSource(source));

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

export const redactProfileSourceUriCredentials = (uri: string): string => {
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
    return uri.replace(/\/\/[^/@\s]+@/u, '//REDACTED@');
  }
};

export const normalizeGitUri = (uri: string): string => (uri.startsWith('git+') ? uri.slice('git+'.length) : uri);
