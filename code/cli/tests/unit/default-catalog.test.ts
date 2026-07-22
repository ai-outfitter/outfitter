// Tests the immutable default-catalog bootstrap and its normal remote-source cache boundary.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { bootstrapPinnedCatalog, defaultCatalogSource } from '../../src/setup/DefaultCatalog.js';
import { createRemoteRepositoryCachePath } from '../../src/sources/SourceCache.js';

const temporaryRoots: string[] = [];

const git = (arguments_: readonly string[]): string =>
  execFileSync('git', [...arguments_], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const createCatalogRepository = (withAgents = true): { readonly ref: string; readonly root: string } => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-default-catalog-source-'));
  temporaryRoots.push(root);
  git(['init', '--quiet', root]);
  git(['-C', root, 'config', 'user.name', 'Outfitter Tests']);
  git(['-C', root, 'config', 'user.email', 'tests@outfitter.dev']);
  if (withAgents) write(join(root, 'agents', 'founder', 'agent.md'), '---\nname: founder\n---\n');
  else write(join(root, 'README.md'), '# No agents\n');
  git(['-C', root, 'add', '.']);
  git(['-C', root, 'commit', '--quiet', '-m', 'test catalog']);
  return { root, ref: git(['-C', root, 'rev-parse', 'HEAD']) };
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('default catalog bootstrap', () => {
  it('ships the canonical catalog at one immutable Release Please tag', () => {
    expect(defaultCatalogSource).toEqual({
      github: 'ai-outfitter/default-profiles',
      ref: 'v1.0.0',
    });
  });

  it('fetches and verifies an immutable Release Please version tag', () => {
    const sourceRepository = createCatalogRepository();
    git(['-C', sourceRepository.root, 'tag', 'v1.2.3']);
    const homeDirectory = mkdtempSync(join(tmpdir(), 'outfitter-default-catalog-home-'));
    temporaryRoots.push(homeDirectory);
    const source = { uri: sourceRepository.root, ref: 'v1.2.3' } as const;

    const result = bootstrapPinnedCatalog({ homeDirectory, source });
    expect(git(['-C', result.root, 'rev-parse', 'HEAD'])).toBe(sourceRepository.ref);
    expect(git(['-C', result.root, 'rev-parse', 'refs/tags/v1.2.3^{commit}'])).toBe(sourceRepository.ref);
    expect(bootstrapPinnedCatalog({ homeDirectory, source }).root).toBe(result.root);
  });

  it('rejects moving branches as default-catalog pins', () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), 'outfitter-default-catalog-home-'));
    temporaryRoots.push(homeDirectory);
    expect(() =>
      bootstrapPinnedCatalog({
        homeDirectory,
        source: { uri: 'https://example.test/catalog.git', ref: 'main' },
      }),
    ).toThrow(/must be a full commit SHA or version tag/u);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.3.9).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('fetches a pinned catalog into the normal source cache and reuses it offline', () => {
    const sourceRepository = createCatalogRepository();
    const homeDirectory = mkdtempSync(join(tmpdir(), 'outfitter-default-catalog-home-'));
    temporaryRoots.push(homeDirectory);
    const source = { uri: sourceRepository.root, ref: sourceRepository.ref } as const;
    const first = bootstrapPinnedCatalog({ homeDirectory, source });

    expect(first.root).toBe(createRemoteRepositoryCachePath(homeDirectory, source));
    expect(git(['-C', first.root, 'rev-parse', 'HEAD'])).toBe(source.ref);
    expect(readFileSync(join(first.root, 'agents', 'founder', 'agent.md'), 'utf8')).toContain('name: founder');

    const unavailableSource = `${sourceRepository.root}-offline`;
    renameSync(sourceRepository.root, unavailableSource);
    temporaryRoots[temporaryRoots.indexOf(sourceRepository.root)] = unavailableSource;
    expect(bootstrapPinnedCatalog({ homeDirectory, source }).root).toBe(first.root);
  });

  it('replaces locally modified cache content with the pinned checkout', () => {
    const sourceRepository = createCatalogRepository();
    const homeDirectory = mkdtempSync(join(tmpdir(), 'outfitter-default-catalog-home-'));
    temporaryRoots.push(homeDirectory);
    const source = { uri: sourceRepository.root, ref: sourceRepository.ref } as const;
    const result = bootstrapPinnedCatalog({ homeDirectory, source });
    write(join(result.root, 'agents', 'founder', 'agent.md'), 'modified');

    bootstrapPinnedCatalog({ homeDirectory, source });
    expect(readFileSync(join(result.root, 'agents', 'founder', 'agent.md'), 'utf8')).toContain('name: founder');
    expect(git(['-C', result.root, 'status', '--porcelain'])).toBe('');
  });

  it('preserves an existing cache if the requested pin cannot be fetched', () => {
    const homeDirectory = mkdtempSync(join(tmpdir(), 'outfitter-default-catalog-home-'));
    temporaryRoots.push(homeDirectory);
    const source = { uri: join(homeDirectory, 'missing.git'), ref: '0'.repeat(40) } as const;
    const cache = createRemoteRepositoryCachePath(homeDirectory, source);
    write(join(cache, 'agents', 'sentinel', 'agent.md'), 'keep me');

    expect(() => bootstrapPinnedCatalog({ homeDirectory, source })).toThrow(
      /Could not fetch the default Outfitter catalog at pinned revision/u,
    );
    expect(readFileSync(join(cache, 'agents', 'sentinel', 'agent.md'), 'utf8')).toBe('keep me');
  });

  it('rejects a pinned repository that is not an agent catalog', () => {
    const sourceRepository = createCatalogRepository(false);
    const homeDirectory = mkdtempSync(join(tmpdir(), 'outfitter-default-catalog-home-'));
    temporaryRoots.push(homeDirectory);
    const source = { uri: sourceRepository.root, ref: sourceRepository.ref } as const;

    expect(() => bootstrapPinnedCatalog({ homeDirectory, source })).toThrow(/did not resolve/u);
    expect(existsSync(createRemoteRepositoryCachePath(homeDirectory, source))).toBe(false);
  });
});
