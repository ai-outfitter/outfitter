// Normalizes launch resource identities so semantically equivalent entries can be deduplicated.
import { resolve } from 'node:path';

export const normalizeExtensionResourceIdentity = (source: string): string => {
  const trimmed = source.trim();

  if (trimmed.startsWith('npm:')) {
    return `npm:${normalizeNpmPackageName(trimmed.slice('npm:'.length))}`;
  }

  if (trimmed.startsWith('github:')) {
    return normalizeGitResourceIdentity(`https://github.com/${trimmed.slice('github:'.length)}.git`);
  }

  if (trimmed.startsWith('git:')) {
    return normalizeGitResourceIdentity(trimmed.slice('git:'.length));
  }

  if (trimmed.startsWith('git+')) {
    return normalizeGitResourceIdentity(trimmed.slice('git+'.length));
  }

  if (trimmed.startsWith('https://') || trimmed.startsWith('http://') || trimmed.startsWith('ssh://')) {
    return normalizeGitResourceIdentity(trimmed);
  }

  return normalizePathResourceIdentity(trimmed);
};

export const normalizeLaunchResourceIdentity = (source: string): string => normalizePathResourceIdentity(source.trim());

const normalizeNpmPackageName = (source: string): string => {
  const withoutRange = source.split('#', 1)[0];

  if (withoutRange.startsWith('@')) {
    const separatorIndex = withoutRange.indexOf('@', 1);
    return (separatorIndex === -1 ? withoutRange : withoutRange.slice(0, separatorIndex)).toLowerCase();
  }

  const separatorIndex = withoutRange.indexOf('@');
  return (separatorIndex === -1 ? withoutRange : withoutRange.slice(0, separatorIndex)).toLowerCase();
};

const normalizeGitResourceIdentity = (source: string): string => {
  const withoutRef = source.split('#', 1)[0];
  const urlLike = withoutRef.startsWith('github.com/') ? `https://${withoutRef}` : withoutRef;

  try {
    const url = new URL(urlLike);
    const host = url.hostname.toLowerCase();
    const path = url.pathname.replace(/\/$/u, '').replace(/\.git$/u, '');

    return `git:${url.protocol}//${host}${path}.git`;
  } catch {
    return `git:${urlLike.replace(/\/$/u, '').replace(/\.git$/u, '')}.git`;
  }
};

const normalizePathResourceIdentity = (source: string): string => {
  if (source.startsWith('.') || source.startsWith('/')) {
    return `path:${resolve(source)}`;
  }

  return `resource:${source}`;
};
