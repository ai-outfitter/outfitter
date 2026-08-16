// Tests the immutable default-catalog bootstrap and its normal remote-source cache boundary.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  bootstrapPinnedCatalog,
  bootstrapPinnedClosure,
  defaultCatalogSource,
} from '../../src/setup/DefaultCatalog.js';
import { syncRemoteRepositoryAtomically } from '../../src/sources/GitRepository.js';
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
  git(['-C', root, 'config', 'commit.gpgsign', 'false']);
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
      ref: 'v1.1.1',
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

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.2.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('honors a configured remote repository cache directory', () => {
    const sourceRepository = createCatalogRepository();
    const homeDirectory = mkdtempSync(join(tmpdir(), 'outfitter-default-catalog-home-'));
    const cacheDirectory = join(homeDirectory, 'selected-cache');
    temporaryRoots.push(homeDirectory);
    const source = { uri: sourceRepository.root, ref: sourceRepository.ref } as const;

    const result = bootstrapPinnedCatalog({ homeDirectory, cacheDirectory, source });

    expect(result.root).toBe(createRemoteRepositoryCachePath(homeDirectory, source, cacheDirectory));
    expect(readFileSync(join(result.root, 'agents', 'founder', 'agent.md'), 'utf8')).toContain('name: founder');
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

describe('default catalog closure bootstrap', () => {
  // Maps each `github:` owner/repo to a local fixture repository so the pinned closure fetches
  // hermetically (a real `github:` source would resolve to github.com).
  const githubFixtureSync =
    (fixtures: Readonly<Record<string, string>>): typeof syncRemoteRepositoryAtomically =>
    (syncInput) => {
      if (syncInput.source.github === undefined) return syncRemoteRepositoryAtomically(syncInput);
      const localRepository = fixtures[syncInput.source.github];
      if (localRepository === undefined) throw new Error(`No fixture for github:${syncInput.source.github}`);
      return syncRemoteRepositoryAtomically({
        ...syncInput,
        source: { uri: localRepository, ref: syncInput.source.ref },
      });
    };

  const createTaggedCatalog = (files: Readonly<Record<string, string>>, tag: string): string => {
    const root = mkdtempSync(join(tmpdir(), 'outfitter-closure-source-'));
    temporaryRoots.push(root);
    git(['init', '--quiet', root]);
    git(['-C', root, 'config', 'user.name', 'Outfitter Tests']);
    git(['-C', root, 'config', 'user.email', 'tests@outfitter.dev']);
    git(['-C', root, 'config', 'commit.gpgsign', 'false']);
    git(['-C', root, 'config', 'tag.gpgsign', 'false']);
    for (const [path, content] of Object.entries(files)) write(join(root, path), content);
    git(['-C', root, 'add', '.']);
    git(['-C', root, 'commit', '--quiet', '-m', 'catalog']);
    git(['-C', root, 'tag', tag]);
    return root;
  };

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.10).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('fetches the pinned github: closure the default catalog declares', () => {
    const dependency = createTaggedCatalog({ 'agents/persona/agent.md': '---\nname: persona\n---\n' }, 'v1.0.0');
    const root = createTaggedCatalog(
      {
        'agents/founder/agent.md': '---\nname: founder\n---\n',
        'settings.yml': 'sources:\n  - github: ai-outfitter/community-profiles\n    ref: v1.0.0\n',
      },
      'v1.0.0',
    );
    const homeDirectory = mkdtempSync(join(tmpdir(), 'outfitter-closure-home-'));
    temporaryRoots.push(homeDirectory);

    const result = bootstrapPinnedClosure({
      homeDirectory,
      source: { github: 'ai-outfitter/default-profiles', ref: 'v1.0.0' },
      syncRepository: githubFixtureSync({
        'ai-outfitter/default-profiles': root,
        'ai-outfitter/community-profiles': dependency,
      }),
    });

    expect(readFileSync(join(result.root, 'agents', 'founder', 'agent.md'), 'utf8')).toContain('name: founder');
    const dependencyCache = createRemoteRepositoryCachePath(homeDirectory, {
      github: 'ai-outfitter/community-profiles',
      ref: 'v1.0.0',
    });
    expect(readFileSync(join(dependencyCache, 'agents', 'persona', 'agent.md'), 'utf8')).toContain('name: persona');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.10).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('walks the declared closure breadth-first to depth two', () => {
    // root → mid → leaf: bootstrap must fetch the whole transitive chain, not just the root's
    // direct dependency.
    const leaf = createTaggedCatalog({ 'skills/leaf-skill/SKILL.md': '# leaf-skill\n' }, 'v1.0.0');
    const mid = createTaggedCatalog(
      {
        'agents/mid/agent.md': '---\nname: mid\n---\n',
        'settings.yml': 'sources:\n  - github: acme/leaf\n    ref: v1.0.0\n',
      },
      'v1.0.0',
    );
    const root = createTaggedCatalog(
      {
        'agents/founder/agent.md': '---\nname: founder\n---\n',
        'settings.yml': 'sources:\n  - github: acme/mid\n    ref: v1.0.0\n',
      },
      'v1.0.0',
    );
    const homeDirectory = mkdtempSync(join(tmpdir(), 'outfitter-closure-home-'));
    temporaryRoots.push(homeDirectory);

    bootstrapPinnedClosure({
      homeDirectory,
      source: { github: 'ai-outfitter/default-profiles', ref: 'v1.0.0' },
      syncRepository: githubFixtureSync({ 'ai-outfitter/default-profiles': root, 'acme/mid': mid, 'acme/leaf': leaf }),
    });

    const leafCache = createRemoteRepositoryCachePath(homeDirectory, { github: 'acme/leaf', ref: 'v1.0.0' });
    expect(readFileSync(join(leafCache, 'skills', 'leaf-skill', 'SKILL.md'), 'utf8')).toContain('leaf-skill');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.10).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('does not fail setup when a declared dependency cannot be fetched', () => {
    const root = createTaggedCatalog(
      {
        'agents/founder/agent.md': '---\nname: founder\n---\n',
        'settings.yml': 'sources:\n  - github: ai-outfitter/missing\n    ref: v1.0.0\n',
      },
      'v1.0.0',
    );
    const homeDirectory = mkdtempSync(join(tmpdir(), 'outfitter-closure-home-'));
    temporaryRoots.push(homeDirectory);

    const result = bootstrapPinnedClosure({
      homeDirectory,
      source: { github: 'ai-outfitter/default-profiles', ref: 'v1.0.0' },
      syncRepository: githubFixtureSync({ 'ai-outfitter/default-profiles': root }),
    });

    expect(readFileSync(join(result.root, 'agents', 'founder', 'agent.md'), 'utf8')).toContain('name: founder');
    expect(
      existsSync(createRemoteRepositoryCachePath(homeDirectory, { github: 'ai-outfitter/missing', ref: 'v1.0.0' })),
    ).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.10).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('bootstraps a dependency that ships only skills (no agents directory)', () => {
    const dependency = createTaggedCatalog({ 'skills/persona-review/SKILL.md': '# persona-review\n' }, 'v1.0.0');
    const root = createTaggedCatalog(
      {
        'agents/founder/agent.md': '---\nname: founder\n---\n',
        'settings.yml': 'sources:\n  - github: ai-outfitter/community-profiles\n    ref: v1.0.0\n',
      },
      'v1.0.0',
    );
    const homeDirectory = mkdtempSync(join(tmpdir(), 'outfitter-closure-home-'));
    temporaryRoots.push(homeDirectory);

    bootstrapPinnedClosure({
      homeDirectory,
      source: { github: 'ai-outfitter/default-profiles', ref: 'v1.0.0' },
      syncRepository: githubFixtureSync({
        'ai-outfitter/default-profiles': root,
        'ai-outfitter/community-profiles': dependency,
      }),
    });

    const dependencyCache = createRemoteRepositoryCachePath(homeDirectory, {
      github: 'ai-outfitter/community-profiles',
      ref: 'v1.0.0',
    });
    expect(readFileSync(join(dependencyCache, 'skills', 'persona-review', 'SKILL.md'), 'utf8')).toContain(
      'persona-review',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.10).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('does not cache a dependency whose only payload marker is a regular file, not a directory', () => {
    // A repository with a regular file named `commands` is not a catalog and must not validate.
    const dependency = createTaggedCatalog({ commands: 'not a directory\n' }, 'v1.0.0');
    const root = createTaggedCatalog(
      {
        'agents/founder/agent.md': '---\nname: founder\n---\n',
        'settings.yml': 'sources:\n  - github: ai-outfitter/community-profiles\n    ref: v1.0.0\n',
      },
      'v1.0.0',
    );
    const homeDirectory = mkdtempSync(join(tmpdir(), 'outfitter-closure-home-'));
    temporaryRoots.push(homeDirectory);

    bootstrapPinnedClosure({
      homeDirectory,
      source: { github: 'ai-outfitter/default-profiles', ref: 'v1.0.0' },
      syncRepository: githubFixtureSync({
        'ai-outfitter/default-profiles': root,
        'ai-outfitter/community-profiles': dependency,
      }),
    });

    expect(
      existsSync(
        createRemoteRepositoryCachePath(homeDirectory, { github: 'ai-outfitter/community-profiles', ref: 'v1.0.0' }),
      ),
    ).toBe(false);
  });
});
