// Encodes URI-backed profile source cache paths.
import { join } from 'node:path';

export const encodeProfileSourceUri = (uri: string): string =>
  Buffer.from(redactProfileSourceUriCredentials(uri), 'utf8').toString('base64url');

export const createProfileSourceCachePath = (homeDirectory: string, uri: string): string =>
  join(homeDirectory, '.bridl', 'cache', 'profiles', encodeProfileSourceUri(uri));

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

export const normalizeGitUri = (uri: string): string => uri.startsWith('git+') ? uri.slice('git+'.length) : uri;
