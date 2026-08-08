// Tests transitive catalog source reading, breadth-first expansion, and layer-stack integration.
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { encodeRemoteSource, encodeRemoteSourceSelection } from '../../src/sources/SourceCache.js';
import type { RemoteSourceReference } from '../../src/sources/SourceCache.js';
import {
  expandTransitiveSources,
  readDeclaredRemoteSources,
  resolveCatalogSettingsPath,
} from '../../src/sources/TransitiveSources.js';
import { discoverLayers } from '../../src/resolver/Layer.js';
import { findResource } from '../../src/resolver/Resource.js';
import { resolveResources } from '../../src/resolver/Resolver.js';
import { resolveEffectiveSet } from '../../src/resolver/ResolverContext.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-transitive-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const agentMd = (name: string): string =>
  `---\nname: ${name}\ndescription: The ${name} agent.\n---\n\n# ${name}\n\nBody for ${name}.\n`;

const pinnedCommit = 'a'.repeat(40);

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('declared catalog sources', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reads pinned remote sources from settings.yml, falling back to .agents/settings.yml', () => {
    const rootStyle = createTemporaryRoot();
    write(join(rootStyle, 'settings.yml'), `sources:\n  - github: example/dep\n    ref: v1.0.0\n`);
    const nestedStyle = createTemporaryRoot();
    write(
      join(nestedStyle, '.agents', 'settings.yml'),
      `sources:\n  - github: example/nested\n    ref: ${pinnedCommit}\n`,
    );
    const bare = createTemporaryRoot();

    expect(resolveCatalogSettingsPath(rootStyle)).toBe(join(rootStyle, 'settings.yml'));
    expect(resolveCatalogSettingsPath(nestedStyle)).toBe(join(nestedStyle, '.agents', 'settings.yml'));
    expect(resolveCatalogSettingsPath(bare)).toBeUndefined();

    expect(readDeclaredRemoteSources(rootStyle, rootStyle, 'root-style')).toEqual({
      sources: [{ source: { github: 'example/dep', ref: 'v1.0.0' }, declaredBy: 'root-style' }],
      warnings: [],
    });
    expect(readDeclaredRemoteSources(nestedStyle, nestedStyle, 'nested-style').sources).toEqual([
      { source: { github: 'example/nested', ref: pinnedCommit }, declaredBy: 'nested-style' },
    ]);
    expect(readDeclaredRemoteSources(bare, bare, 'bare')).toEqual({ sources: [], warnings: [] });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('yields no dependencies for a valid catalog settings file that declares no sources', () => {
    const catalog = createTemporaryRoot();
    write(join(catalog, 'settings.yml'), 'default_agent: founder\n');

    expect(readDeclaredRemoteSources(catalog, catalog, 'sourceless-catalog')).toEqual({ sources: [], warnings: [] });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('contributes only sources from a catalog settings file, never policy settings', () => {
    const catalog = createTemporaryRoot();
    write(
      join(catalog, 'settings.yml'),
      [
        'default_agent: attacker-default',
        'default_harness: claude',
        'remote_settings:',
        '  - github: example/remote-settings',
        '    path: settings.yml',
        'sources:',
        '  - github: example/dep',
        '    ref: v1.0.0',
        '',
      ].join('\n'),
    );

    const declared = readDeclaredRemoteSources(catalog, catalog, 'policy-catalog');

    expect(declared.warnings).toEqual([]);
    expect(declared.sources).toEqual([
      { source: { github: 'example/dep', ref: 'v1.0.0' }, declaredBy: 'policy-catalog' },
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('skips declared sources without an immutable ref and warns naming the declaring catalog', () => {
    const catalog = createTemporaryRoot();
    write(
      join(catalog, 'settings.yml'),
      [
        'sources:',
        '  - github: example/unref',
        '  - github: example/branch',
        '    ref: main',
        '  - github: example/pinned',
        '    ref: v2.1.0',
        '',
      ].join('\n'),
    );

    const declared = readDeclaredRemoteSources(catalog, catalog, 'the-catalog');

    expect(declared.sources).toEqual([
      { source: { github: 'example/pinned', ref: 'v2.1.0' }, declaredBy: 'the-catalog' },
    ]);
    expect(declared.warnings).toHaveLength(2);
    for (const warning of declared.warnings) {
      expect(warning).toContain("Catalog 'the-catalog'");
      expect(warning).toContain('immutable');
    }
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('skips a declared uri: source and warns, keeping only github: shorthands', () => {
    const catalog = createTemporaryRoot();
    write(
      join(catalog, 'settings.yml'),
      ['sources:', '  - uri: git+https://git.example.com/team/agents.git', '    ref: v1.0.0', ''].join('\n'),
    );

    const declared = readDeclaredRemoteSources(catalog, catalog, 'uri-catalog');

    expect(declared.sources).toEqual([]);
    expect(declared.warnings).toHaveLength(1);
    expect(declared.warnings[0]).toContain("Catalog 'uri-catalog'");
    expect(declared.warnings[0]).toContain("'github:' shorthands");
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('skips a declared github: source that carries a path: subpath and warns', () => {
    const catalog = createTemporaryRoot();
    write(join(catalog, 'settings.yml'), 'sources:\n  - github: example/dep\n    ref: v1.0.0\n    path: sub\n');

    const declared = readDeclaredRemoteSources(catalog, catalog, 'subpath-catalog');

    expect(declared.sources).toEqual([]);
    expect(declared.warnings).toHaveLength(1);
    expect(declared.warnings[0]).toContain("Catalog 'subpath-catalog'");
    expect(declared.warnings[0]).toContain('subpath');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('skips local path sources declared by a catalog and warns naming the declaring catalog', () => {
    const catalog = createTemporaryRoot();
    write(join(catalog, 'settings.yml'), 'sources:\n  - path: ../../outside\n');

    const declared = readDeclaredRemoteSources(catalog, catalog, 'path-catalog');

    expect(declared.sources).toEqual([]);
    expect(declared.warnings).toHaveLength(1);
    expect(declared.warnings[0]).toContain("Catalog 'path-catalog'");
    expect(declared.warnings[0]).toContain('path source');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('skips the declarations of a catalog whose settings file fails validation and warns', () => {
    const catalog = createTemporaryRoot();
    write(join(catalog, 'settings.yml'), 'default_harness: invalid\n');

    const declared = readDeclaredRemoteSources(catalog, catalog, 'broken-catalog');

    expect(declared.sources).toEqual([]);
    expect(declared.warnings).toHaveLength(1);
    expect(declared.warnings[0]).toContain("Catalog 'broken-catalog'");
    expect(declared.warnings[0]).toContain('invalid settings');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('skips (does not crash on) a settings.yml committed as a symlink to a directory', () => {
    const catalog = createTemporaryRoot();
    const escapeTarget = createTemporaryRoot();
    mkdirSync(join(escapeTarget, 'secret-directory'));
    // A hostile catalog ships settings.yml as a symlink to a directory; readFileSync would EISDIR.
    symlinkSync(join(escapeTarget, 'secret-directory'), join(catalog, 'settings.yml'));

    const declared = readDeclaredRemoteSources(catalog, catalog, 'hostile-catalog');

    expect(declared.sources).toEqual([]);
    expect(declared.warnings).toHaveLength(1);
    expect(declared.warnings[0]).toContain("Catalog 'hostile-catalog'");
    expect(declared.warnings[0]).toContain('unreadable');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('skips (does not read) a settings.yml symlinked outside the checkout', () => {
    const catalog = createTemporaryRoot();
    const outside = createTemporaryRoot();
    write(join(outside, 'stolen.yml'), 'sources:\n  - github: example/dep\n    ref: v1.0.0\n');
    symlinkSync(join(outside, 'stolen.yml'), join(catalog, 'settings.yml'));

    const declared = readDeclaredRemoteSources(catalog, catalog, 'escaping-catalog');

    expect(declared.sources).toEqual([]);
    expect(declared.warnings).toHaveLength(1);
    expect(declared.warnings[0]).toContain('unreadable');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns on a settings.yml committed as a dangling symlink instead of silently ignoring it', () => {
    const catalog = createTemporaryRoot();
    // A broken symlink: `existsSync` (which follows links) would report it absent and drop it silently.
    symlinkSync(join(catalog, 'nonexistent-target'), join(catalog, 'settings.yml'));

    const declared = readDeclaredRemoteSources(catalog, catalog, 'dangling-catalog');

    expect(declared.sources).toEqual([]);
    expect(declared.warnings).toHaveLength(1);
    expect(declared.warnings[0]).toContain("Catalog 'dangling-catalog'");
    expect(declared.warnings[0]).toContain('unreadable');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('anchors containment to the checkout root, rejecting settings reached via a symlinked payload dir', () => {
    const checkout = createTemporaryRoot();
    const external = createTemporaryRoot();
    write(join(external, 'settings.yml'), 'sources:\n  - github: example/dep\n    ref: v1.0.0\n');
    // The catalog commits its payload subdir as a symlink escaping the checkout. Anchoring
    // containment to the payload root (which resolves outside) would wrongly accept the external
    // settings; anchoring to the checkout root rejects it.
    symlinkSync(external, join(checkout, 'payload'));

    const declared = readDeclaredRemoteSources(join(checkout, 'payload'), checkout, 'symlinked-payload');

    expect(declared.sources).toEqual([]);
    expect(declared.warnings).toHaveLength(1);
    expect(declared.warnings[0]).toContain('unreadable');
  });
});

describe('path-aware source identity', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.3, OFTR-004.6.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('distinguishes subpaths for the graph while sharing one checkout cache', () => {
    const wholeRepo: RemoteSourceReference = { github: 'acme/mono', ref: 'v1.0.0' };
    const subpath: RemoteSourceReference = { github: 'acme/mono', ref: 'v1.0.0', path: 'sub' };

    // Same repository+ref → one shared checkout cache key.
    expect(encodeRemoteSource(subpath)).toBe(encodeRemoteSource(wholeRepo));
    // Different payload roots → distinct graph/dedup identities.
    expect(encodeRemoteSourceSelection(subpath)).not.toBe(encodeRemoteSourceSelection(wholeRepo));
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('canonicalizes the path so ., ./, trailing slash, and foo/.. share the omitted-path identity', () => {
    const base: RemoteSourceReference = { github: 'acme/mono', ref: 'v1.0.0' };
    const omitted = encodeRemoteSourceSelection(base);
    for (const path of ['.', './', 'sub/..']) {
      expect(encodeRemoteSourceSelection({ ...base, path })).toBe(omitted);
    }
    expect(encodeRemoteSourceSelection({ ...base, path: 'sub/' })).toBe(
      encodeRemoteSourceSelection({ ...base, path: 'sub' }),
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('distinguishes credentials so same-repo different-credential sources are not deduped', () => {
    const alice: RemoteSourceReference = { uri: 'https://alice@example.com/repo.git', ref: 'v1.0.0' };
    const bob: RemoteSourceReference = { uri: 'https://bob@example.com/repo.git', ref: 'v1.0.0' };

    // The checkout cache is one repo regardless of credentials (redacted key)...
    expect(encodeRemoteSource(alice)).toBe(encodeRemoteSource(bob));
    // ...but the two are distinct configured sources, so dedup must not collapse them.
    expect(encodeRemoteSourceSelection(alice)).not.toBe(encodeRemoteSourceSelection(bob));
  });
});

describe('transitive source expansion', () => {
  const cachedCatalog = (cache: string, source: RemoteSourceReference, settings?: string): string => {
    const root = join(cache, 'repos', encodeRemoteSource(source));
    mkdirSync(root, { recursive: true });
    if (settings !== undefined) write(join(root, 'settings.yml'), settings);
    return root;
  };

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('discovers breadth-first, not depth-first (a sibling precedes a grandchild)', () => {
    const cache = join(createTemporaryRoot(), 'cache');
    const direct: RemoteSourceReference = { github: 'acme/direct', ref: 'v1.0.0' };
    const a: RemoteSourceReference = { github: 'acme/a', ref: 'v1.0.0' };
    const b: RemoteSourceReference = { github: 'acme/b', ref: 'v1.0.0' };
    const c: RemoteSourceReference = { github: 'acme/c', ref: 'v1.0.0' };
    // direct declares [a, b] (siblings); a declares c (a grandchild of direct).
    cachedCatalog(
      cache,
      direct,
      `sources:\n  - github: acme/a\n    ref: v1.0.0\n  - github: acme/b\n    ref: v1.0.0\n`,
    );
    cachedCatalog(cache, a, `sources:\n  - github: acme/c\n    ref: v1.0.0\n`);
    cachedCatalog(cache, b);
    cachedCatalog(cache, c);
    const cached = [direct, a, b, c];

    const expansion = expandTransitiveSources({
      directSources: [direct],
      resolveCachedCheckoutRoot: (source) =>
        cached.some((entry) => encodeRemoteSource(entry) === encodeRemoteSource(source))
          ? join(cache, 'repos', encodeRemoteSource(source))
          : undefined,
    });

    // Breadth-first: sibling `b` precedes grandchild `c`. Depth-first would yield [a, c, b].
    expect(expansion.sources.map((entry) => entry.source)).toEqual([a, b, c]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('skips a source whose path escapes the checkout instead of throwing', () => {
    const cache = join(createTemporaryRoot(), 'cache');
    const escaping: RemoteSourceReference = { github: 'acme/mono', ref: 'v1.0.0', path: '../escape' };
    const checkoutRoot = join(cache, 'repos', encodeRemoteSource(escaping));
    mkdirSync(checkoutRoot, { recursive: true });

    const expansion = expandTransitiveSources({
      directSources: [escaping],
      resolveCachedCheckoutRoot: (source) =>
        encodeRemoteSource(source) === encodeRemoteSource(escaping) ? checkoutRoot : undefined,
    });

    expect(expansion.sources).toEqual([]);
    expect(expansion.warnings).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('processes an exact-duplicate direct source only once', () => {
    const cache = join(createTemporaryRoot(), 'cache');
    const dup: RemoteSourceReference = { github: 'acme/dup', ref: 'v1.0.0' };
    const dep: RemoteSourceReference = { github: 'acme/dep', ref: 'v1.0.0' };
    // The duplicated parent declares a valid dependency and an invalid (unpinned) one. Without the
    // frontier-seed dedup the parent is read twice — its dependency deduped by the inner visited set,
    // but its skip warning emitted twice — so asserting a single warning pins the seed dedup itself.
    cachedCatalog(cache, dup, `sources:\n  - github: acme/dep\n    ref: v1.0.0\n  - github: acme/unpinned\n`);

    const expansion = expandTransitiveSources({
      directSources: [dup, dup],
      resolveCachedCheckoutRoot: (source) =>
        encodeRemoteSource(source) === encodeRemoteSource(dup)
          ? join(cache, 'repos', encodeRemoteSource(dup))
          : undefined,
    });

    expect(expansion.sources).toEqual([{ source: dep, declaredBy: 'github:acme/dup#v1.0.0' }]);
    expect(expansion.warnings).toHaveLength(1);
    expect(expansion.warnings[0]).toContain('immutable');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('preserves declaration order among sources a single catalog declares', () => {
    const cache = join(createTemporaryRoot(), 'cache');
    const parent: RemoteSourceReference = { github: 'acme/parent', ref: 'v1.0.0' };
    const alpha: RemoteSourceReference = { github: 'acme/alpha', ref: 'v1.0.0' };
    const beta: RemoteSourceReference = { github: 'acme/beta', ref: 'v1.0.0' };
    cachedCatalog(
      cache,
      parent,
      `sources:\n  - github: acme/alpha\n    ref: v1.0.0\n  - github: acme/beta\n    ref: v1.0.0\n`,
    );

    const expansion = expandTransitiveSources({
      directSources: [parent],
      resolveCachedCheckoutRoot: (source) =>
        encodeRemoteSource(source) === encodeRemoteSource(parent)
          ? join(cache, 'repos', encodeRemoteSource(parent))
          : undefined,
    });

    expect(expansion.sources.map((entry) => entry.source)).toEqual([alpha, beta]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('skips a source whose cached checkout lacks the selected payload subpath', () => {
    const cache = join(createTemporaryRoot(), 'cache');
    const subpathSource: RemoteSourceReference = { github: 'acme/mono', ref: 'v1.0.0', path: 'absent-sub' };
    const checkoutRoot = join(cache, 'repos', encodeRemoteSource(subpathSource));
    mkdirSync(checkoutRoot, { recursive: true }); // checkout exists, but 'absent-sub' does not

    const expansion = expandTransitiveSources({
      directSources: [subpathSource],
      resolveCachedCheckoutRoot: (source) =>
        encodeRemoteSource(source) === encodeRemoteSource(subpathSource) ? checkoutRoot : undefined,
    });

    expect(expansion.sources).toEqual([]);
    expect(expansion.warnings).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.3, OFTR-004.6.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('expands breadth-first, resolves each source once, and terminates on cycles', () => {
    const cache = join(createTemporaryRoot(), 'cache');
    const direct: RemoteSourceReference = { github: 'example/direct', ref: 'v1.0.0' };
    const depB: RemoteSourceReference = { github: 'example/b', ref: 'v1.0.0' };
    const depC: RemoteSourceReference = { github: 'example/c', ref: 'v1.0.0' };
    // direct declares b and (redundantly) itself; b declares c and (cyclically) direct.
    cachedCatalog(
      cache,
      direct,
      `sources:\n  - github: example/b\n    ref: v1.0.0\n  - github: example/direct\n    ref: v1.0.0\n`,
    );
    cachedCatalog(
      cache,
      depB,
      `sources:\n  - github: example/c\n    ref: v1.0.0\n  - github: example/direct\n    ref: v1.0.0\n`,
    );
    cachedCatalog(cache, depC);

    const expansion = expandTransitiveSources({
      directSources: [{ path: '/ignored/local' }, direct],
      resolveCachedCheckoutRoot: (source) => {
        const root = join(cache, 'repos', encodeRemoteSource(source));
        return [direct, depB, depC].some((cached) => encodeRemoteSource(cached) === encodeRemoteSource(source))
          ? root
          : undefined;
      },
    });

    expect(expansion.sources).toEqual([
      { source: depB, declaredBy: 'github:example/direct#v1.0.0' },
      { source: depC, declaredBy: 'github:example/b#v1.0.0' },
    ]);
    expect(expansion.warnings).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('does not let a directly configured subpath source suppress a transitive whole-repository source', () => {
    const cache = join(createTemporaryRoot(), 'cache');
    // Directly configured: a subpath of a monorepo. A catalog declares the whole repository at the
    // same repo+ref. The two are distinct layers and both must survive dedup.
    const directSubpath: RemoteSourceReference = { github: 'acme/mono', ref: 'v1.0.0', path: 'sub' };
    const declaringCatalog: RemoteSourceReference = { github: 'acme/catalog', ref: 'v1.0.0' };
    const wholeRepo: RemoteSourceReference = { github: 'acme/mono', ref: 'v1.0.0' };
    cachedCatalog(cache, declaringCatalog, `sources:\n  - github: acme/mono\n    ref: v1.0.0\n`);

    const expansion = expandTransitiveSources({
      directSources: [directSubpath, declaringCatalog],
      resolveCachedCheckoutRoot: (source) =>
        encodeRemoteSource(source) === encodeRemoteSource(declaringCatalog)
          ? join(cache, 'repos', encodeRemoteSource(declaringCatalog))
          : undefined,
    });

    expect(expansion.sources).toEqual([{ source: wholeRepo, declaredBy: 'github:acme/catalog#v1.0.0' }]);
  });

  it('keeps an uncached declared source in the result without expanding beneath it', () => {
    const cache = join(createTemporaryRoot(), 'cache');
    const direct: RemoteSourceReference = { github: 'example/direct', ref: 'v1.0.0' };
    const missing: RemoteSourceReference = { github: 'example/missing', ref: 'v1.0.0' };
    cachedCatalog(cache, direct, `sources:\n  - github: example/missing\n    ref: v1.0.0\n`);

    const expansion = expandTransitiveSources({
      directSources: [direct],
      resolveCachedCheckoutRoot: (source) =>
        encodeRemoteSource(source) === encodeRemoteSource(direct)
          ? join(cache, 'repos', encodeRemoteSource(direct))
          : undefined,
    });

    expect(expansion.sources).toEqual([{ source: missing, declaredBy: 'github:example/direct#v1.0.0' }]);
  });
});

describe('transitive layers', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('collapses an exact-duplicate configured source into a single layer', () => {
    const root = createTemporaryRoot();
    const cache = join(root, 'cache');
    const dup = { github: 'example/dup', ref: 'v1.0.0' } as const;
    write(join(cache, 'repos', encodeRemoteSource(dup), 'agents', 'solo', 'agent.md'), agentMd('solo'));

    const discovered = discoverLayers({
      homeDirectory: join(root, 'home'),
      projectDirectory: join(root, 'project'),
      settings: { cacheDirectory: cache, sources: [dup, dup] },
    });

    expect(discovered.layers.filter((layer) => layer.origin === 'source')).toHaveLength(1);
    // Deduped, so the agent is not shadowed by an identical copy of itself.
    expect(findResource(resolveResources(discovered.layers), 'agent', 'solo')?.shadowed).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.1, OFTR-004.6.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('appends cached transitive catalogs after every directly configured source layer', () => {
    const root = createTemporaryRoot();
    const cache = join(root, 'cache');
    const direct = { github: 'example/direct', ref: 'v1.0.0' } as const;
    const dep = { github: 'example/dep', ref: 'v1.0.0' } as const;
    const directRoot = join(cache, 'repos', encodeRemoteSource(direct));
    const depRoot = join(cache, 'repos', encodeRemoteSource(dep));
    write(join(directRoot, 'settings.yml'), 'sources:\n  - github: example/dep\n    ref: v1.0.0\n');
    write(join(directRoot, 'agents', 'shared', 'agent.md'), agentMd('direct-copy'));
    write(join(depRoot, 'agents', 'shared', 'agent.md'), agentMd('dep-copy'));
    write(join(depRoot, 'agents', 'dep-only', 'agent.md'), agentMd('dep-only'));

    const discovered = discoverLayers({
      homeDirectory: join(root, 'home'),
      projectDirectory: join(root, 'project'),
      settings: { cacheDirectory: cache, sources: [direct] },
    });

    expect(discovered.layers.map((layer) => layer.label)).toEqual([
      'github:example/direct#v1.0.0',
      'github:example/dep#v1.0.0',
    ]);
    const set = resolveResources(discovered.layers);
    expect(findResource(set, 'agent', 'dep-only')).toBeDefined();
    // The directly configured catalog outranks the transitive one for the shared slug.
    expect(findResource(set, 'agent', 'shared')?.winner.path).toBe(join(directRoot, 'agents', 'shared', 'agent.md'));
    expect(discovered.warnings).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('orders a two-hop closure breadth-first so a shallower dependency outranks a deeper one', () => {
    const root = createTemporaryRoot();
    const cache = join(root, 'cache');
    const direct = { github: 'example/direct', ref: 'v1.0.0' } as const;
    const mid = { github: 'example/mid', ref: 'v1.0.0' } as const;
    const leaf = { github: 'example/leaf', ref: 'v1.0.0' } as const;
    const midRoot = join(cache, 'repos', encodeRemoteSource(mid));
    const leafRoot = join(cache, 'repos', encodeRemoteSource(leaf));
    // direct → mid → leaf; the `shared` slug lives in both mid (depth 1) and leaf (depth 2).
    write(
      join(cache, 'repos', encodeRemoteSource(direct), 'settings.yml'),
      'sources:\n  - github: example/mid\n    ref: v1.0.0\n',
    );
    write(join(midRoot, 'settings.yml'), 'sources:\n  - github: example/leaf\n    ref: v1.0.0\n');
    write(join(midRoot, 'agents', 'shared', 'agent.md'), agentMd('mid-copy'));
    write(join(leafRoot, 'agents', 'shared', 'agent.md'), agentMd('leaf-copy'));
    write(join(leafRoot, 'agents', 'leaf-only', 'agent.md'), agentMd('leaf-only'));

    const discovered = discoverLayers({
      homeDirectory: join(root, 'home'),
      projectDirectory: join(root, 'project'),
      settings: { cacheDirectory: cache, sources: [direct] },
    });

    expect(discovered.layers.map((layer) => layer.label)).toEqual([
      'github:example/direct#v1.0.0',
      'github:example/mid#v1.0.0',
      'github:example/leaf#v1.0.0',
    ]);
    const set = resolveResources(discovered.layers);
    expect(findResource(set, 'agent', 'leaf-only')).toBeDefined();
    // The shallower dependency (mid, depth 1) outranks the deeper one (leaf, depth 2) for `shared`.
    expect(findResource(set, 'agent', 'shared')?.winner.path).toBe(join(midRoot, 'agents', 'shared', 'agent.md'));
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.9).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports an uncached transitive source with actionable sync guidance', () => {
    const root = createTemporaryRoot();
    const cache = join(root, 'cache');
    const direct = { github: 'example/direct', ref: 'v1.0.0' } as const;
    const directRoot = join(cache, 'repos', encodeRemoteSource(direct));
    write(join(directRoot, 'settings.yml'), 'sources:\n  - github: example/never-synced\n    ref: v1.0.0\n');

    const discovered = discoverLayers({
      homeDirectory: join(root, 'home'),
      projectDirectory: join(root, 'project'),
      settings: { cacheDirectory: cache, sources: [direct] },
    });

    expect(discovered.unsynchronized).toHaveLength(1);
    expect(discovered.unsynchronized[0]).toContain('github:example/never-synced#v1.0.0');
    expect(discovered.unsynchronized[0]).toMatch(/Run 'outfitter sync'/u);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.6.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('surfaces transitive skip warnings through the shared resolution path', () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const cache = join(root, 'cache');
    const direct = { github: 'example/direct', ref: 'v1.0.0' } as const;
    const directRoot = join(cache, 'repos', encodeRemoteSource(direct));
    write(join(directRoot, 'settings.yml'), 'sources:\n  - github: example/unpinned\n    ref: main\n');
    write(
      join(home, '.agents', 'settings.yml'),
      `cache_directory: ${JSON.stringify(cache)}\nsources:\n  - github: example/direct\n    ref: v1.0.0\n`,
    );

    const resolved = resolveEffectiveSet({ homeDirectory: home, projectDirectory: join(root, 'project') });

    expect(resolved.warnings).toHaveLength(1);
    expect(resolved.warnings[0]).toContain("Catalog 'github:example/direct#v1.0.0'");
    expect(resolved.warnings[0]).toContain('immutable');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.2.15).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('skips a configured source whose path escapes the checkout instead of crashing resolution', () => {
    const root = createTemporaryRoot();
    const cache = join(root, 'cache');
    const present = { github: 'example/present', ref: 'v1.0.0' } as const;
    write(join(cache, 'repos', encodeRemoteSource(present), 'agents', 'ok', 'agent.md'), agentMd('ok'));

    const discovered = discoverLayers({
      homeDirectory: join(root, 'home'),
      projectDirectory: join(root, 'project'),
      settings: {
        cacheDirectory: cache,
        sources: [{ github: 'example/evil', ref: 'v1.0.0', path: '../escape' }, present],
      },
    });

    expect(discovered.warnings.some((warning) => warning.includes('invalid path'))).toBe(true);
    expect(findResource(resolveResources(discovered.layers), 'agent', 'ok')).toBeDefined();
  });
});
