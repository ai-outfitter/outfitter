// Tests remote source URI normalization, credential redaction, and cache path encoding.
import { describe, expect, it } from 'vitest';

import {
  createRemoteRepositoryCachePath,
  encodeRemoteSource,
  formatRemoteSourceDisplay,
  normalizeGitUri,
  normalizeRemoteSourceUri,
  redactEmbeddedSourceCredentials,
  redactSourceUriCredentials,
  resolveRemoteRepositoryCacheRoot,
  resolveRemoteRepositorySubpath,
} from '../../src/sources/SourceCache.js';

describe('source cache', () => {
  it('normalizes github shorthands and git+ URIs', () => {
    expect(normalizeRemoteSourceUri({ github: 'example/.agent' })).toBe('git+https://github.com/example/.agent.git');
    expect(normalizeRemoteSourceUri({ uri: 'git+ssh://git@example.test/a.git' })).toBe(
      'git+ssh://git@example.test/a.git',
    );
    expect(normalizeGitUri('git+https://example.test/a.git')).toBe('https://example.test/a.git');
    expect(normalizeGitUri('https://example.test/a.git')).toBe('https://example.test/a.git');
  });

  it('redacts credentials in source URIs', () => {
    expect(redactSourceUriCredentials('git+https://user:secret@example.test/a.git')).toBe(
      'git+https://REDACTED@example.test/a.git',
    );
    expect(redactSourceUriCredentials('https://example.test/a.git')).toBe('https://example.test/a.git');
    // Unparseable URIs fall back to a regex redaction.
    expect(redactSourceUriCredentials('git+ssh://user@example.test:a.git')).toContain('REDACTED@');
    expect(
      redactEmbeddedSourceCredentials('fatal: https://first:one@example.test/a and ssh://second:two@example.test/b'),
    ).toBe('fatal: https://REDACTED@example.test/a and ssh://REDACTED@example.test/b');
    expect(formatRemoteSourceDisplay({ uri: 'https://user:secret@example.test/a.git' })).toBe(
      'https://REDACTED@example.test/a.git',
    );
  });

  it('encodes remote sources under the selected repository cache root', () => {
    const path = createRemoteRepositoryCachePath('/home/x', { github: 'example/.agent', ref: 'main' });
    expect(path).toContain('/home/x/.agents/cache/repos/');
    expect(path.endsWith(encodeRemoteSource({ github: 'example/.agent', ref: 'main' }))).toBe(true);
    expect(createRemoteRepositoryCachePath('/home/x', { github: 'example/.agent' }, '/var/cache/agents')).toContain(
      '/var/cache/agents/repos/',
    );
    expect(resolveRemoteRepositoryCacheRoot('/home/x')).toBe('/home/x/.agents/cache');
    expect(resolveRemoteRepositoryCacheRoot('/home/x', '/custom')).toBe('/custom');
  });

  it('rejects absolute and escaping repository subpaths', () => {
    expect(resolveRemoteRepositorySubpath('/repo', 'a/b')).toBe('/repo/a/b');
    expect(() => resolveRemoteRepositorySubpath('/repo', '/abs')).toThrow(/must be relative/);
    expect(() => resolveRemoteRepositorySubpath('/repo', '../escape')).toThrow(/must stay inside/);
  });
});
