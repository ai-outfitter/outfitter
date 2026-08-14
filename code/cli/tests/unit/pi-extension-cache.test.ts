// Tests specifier→pi-install mapping and the install/cache/offline behavior of ensurePiExtensions.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  assertInstallDirInsideCache,
  ensurePiExtensions,
  mapSpecifierToPiSource,
} from '../../src/extensions/PiExtensionCache.js';
import type { PiInstallSpawner } from '../../src/extensions/PiExtensionCache.js';

const roots: string[] = [];
const cacheDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'outfitter-ext-cache-'));
  roots.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const writePackage = (dir: string, version: string): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'x', version }));
};

const git = (arguments_: readonly string[]): string =>
  execFileSync('git', [...arguments_], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Creates a one-commit git checkout at `dir` (as `pi install` would) and returns its HEAD SHA. */
const createGitCheckout = (dir: string): string => {
  mkdirSync(dir, { recursive: true });
  git(['init', '--quiet', dir]);
  git(['-C', dir, 'config', 'user.name', 'Outfitter Tests']);
  git(['-C', dir, 'config', 'user.email', 'tests@outfitter.dev']);
  // Isolate from the developer's global config; a global commit.gpgsign would fail every commit.
  git(['-C', dir, 'config', 'commit.gpgsign', 'false']);
  writeFileSync(join(dir, 'index.js'), '');
  git(['-C', dir, 'add', '.']);
  git(['-C', dir, 'commit', '--quiet', '-m', 'install']);
  return git(['-C', dir, 'rev-parse', 'HEAD']);
};

const deepworkDir = (cache: string): string => join(cache, 'git', 'github.com', 'ai-outfitter', 'deepwork');
const deepworkSpec = (ref: string): string => `git:github.com/ai-outfitter/deepwork@${ref}`;

describe('mapSpecifierToPiSource', () => {
  it('maps npm specifiers, stripping a trailing version and keeping a scope', () => {
    expect(mapSpecifierToPiSource('npm:pi-nolo')).toEqual({
      source: 'npm:pi-nolo',
      installSegments: ['npm', 'node_modules', 'pi-nolo'],
    });
    expect(mapSpecifierToPiSource('npm:pi-subagents@0.28.0')).toEqual({
      source: 'npm:pi-subagents@0.28.0',
      installSegments: ['npm', 'node_modules', 'pi-subagents'],
      pinnedVersion: '0.28.0',
    });
    expect(mapSpecifierToPiSource('npm:@scope/name@1.2.3')).toEqual({
      source: 'npm:@scope/name@1.2.3',
      installSegments: ['npm', 'node_modules', '@scope/name'],
      pinnedVersion: '1.2.3',
    });
  });

  it('maps git specifiers to git/<host>/<owner>/<repo>, keeping any ref as the pin', () => {
    expect(mapSpecifierToPiSource('git:github.com/ai-outfitter/deepwork')).toEqual({
      source: 'git:github.com/ai-outfitter/deepwork',
      installSegments: ['git', 'github.com', 'ai-outfitter', 'deepwork'],
    });
    expect(mapSpecifierToPiSource('git:github.com/ai-outfitter/deepwork@v1.0.0')).toEqual({
      source: 'git:github.com/ai-outfitter/deepwork@v1.0.0',
      installSegments: ['git', 'github.com', 'ai-outfitter', 'deepwork'],
      pinnedGitRef: 'v1.0.0',
    });
    const sha = 'a'.repeat(40);
    expect(mapSpecifierToPiSource(`git:github.com/ai-outfitter/deepwork@${sha}`)).toEqual({
      source: `git:github.com/ai-outfitter/deepwork@${sha}`,
      installSegments: ['git', 'github.com', 'ai-outfitter', 'deepwork'],
      pinnedGitRef: sha,
    });
    expect(mapSpecifierToPiSource('git:github.com/ai-outfitter/deepwork@')).toEqual({
      source: 'git:github.com/ai-outfitter/deepwork@',
      installSegments: ['git', 'github.com', 'ai-outfitter', 'deepwork'],
    });
  });

  it('rejects unsupported sources', () => {
    expect(mapSpecifierToPiSource('ext-a')).toEqual({
      unsupported: "extension 'ext-a' uses an unsupported source (only git: and npm: project to pi)",
    });
  });

  it('rejects an npm specifier with no package name and a git specifier with too few segments', () => {
    expect(mapSpecifierToPiSource('npm:')).toEqual({ unsupported: "extension 'npm:' has no package name" });
    expect(mapSpecifierToPiSource('git:justhost')).toEqual({
      unsupported: "extension 'git:justhost' is not a valid git source",
    });
  });

  it('rejects traversal and backslash segments that would escape the cache directory', () => {
    for (const specifier of [
      'git:../../victim@v1',
      'git:host/..@v1',
      'git:host/./repo@v1',
      String.raw`git:host/owner\..\x@v1`,
      'npm:../evil',
      String.raw`npm:evil\..\x`,
    ]) {
      expect(mapSpecifierToPiSource(specifier)).toEqual({
        unsupported: `extension '${specifier}' contains an unsafe path segment`,
      });
    }
  });

  it('flattens an absolute-path-ish git specifier into relative segments under the cache', () => {
    expect(mapSpecifierToPiSource('git:/etc/passwd@v1')).toEqual({
      source: 'git:/etc/passwd@v1',
      installSegments: ['git', 'etc', 'passwd'],
      pinnedGitRef: 'v1',
    });
  });
});

describe('ensurePiExtensions', () => {
  const spawnCreating: PiInstallSpawner = ({ source, cacheAgentDir }) => {
    const mapped = mapSpecifierToPiSource(source);
    if (!('unsupported' in mapped)) writePackage(join(cacheAgentDir, ...mapped.installSegments), '1.0.0');
    return Promise.resolve(0);
  };

  it('returns a cached install dir without spawning when already present', async () => {
    const dir = cacheDir();
    writePackage(join(dir, 'npm', 'node_modules', 'pi-nolo'), '1.0.0');
    let spawned = 0;
    const result = await ensurePiExtensions(['npm:pi-nolo'], {
      cacheAgentDir: dir,
      offline: false,
      spawn: () => {
        spawned += 1;
        return Promise.resolve(0);
      },
    });
    expect(spawned).toBe(0);
    expect(result.loadDirs).toEqual([join(dir, 'npm', 'node_modules', 'pi-nolo')]);
    expect(result.warnings).toEqual([]);
  });

  it('installs a missing extension when online', async () => {
    const dir = cacheDir();
    const sources: string[] = [];
    const result = await ensurePiExtensions(['npm:pi-nolo', 'git:github.com/ai-outfitter/deepwork'], {
      cacheAgentDir: dir,
      offline: false,
      spawn: (input) => {
        sources.push(input.source);
        return spawnCreating(input);
      },
    });
    expect(sources).toEqual(['npm:pi-nolo', 'git:github.com/ai-outfitter/deepwork']);
    expect(result.loadDirs).toEqual([
      join(dir, 'npm', 'node_modules', 'pi-nolo'),
      join(dir, 'git', 'github.com', 'ai-outfitter', 'deepwork'),
    ]);
  });

  it('passes debug logging through to the installer', async () => {
    const dir = cacheDir();
    let debug: boolean | undefined;
    await ensurePiExtensions(['npm:pi-nolo'], {
      cacheAgentDir: dir,
      offline: false,
      debug: true,
      spawn: (input) => {
        debug = input.debug;
        return spawnCreating(input);
      },
    });
    expect(debug).toBe(true);
  });

  it('warns and drops a missing extension when offline, without spawning', async () => {
    const dir = cacheDir();
    let spawned = 0;
    const result = await ensurePiExtensions(['npm:pi-nolo'], {
      cacheAgentDir: dir,
      offline: true,
      spawn: () => {
        spawned += 1;
        return Promise.resolve(0);
      },
    });
    expect(spawned).toBe(0);
    expect(result.loadDirs).toEqual([]);
    expect(result.warnings[0]).toContain('not cached and cannot be installed offline');
  });

  it('reinstalls when a pinned npm version does not match the cached one', async () => {
    const dir = cacheDir();
    writePackage(join(dir, 'npm', 'node_modules', 'pi-subagents'), '0.27.0'); // stale
    let spawned = 0;
    const result = await ensurePiExtensions(['npm:pi-subagents@0.28.0'], {
      cacheAgentDir: dir,
      offline: false,
      spawn: (input) => {
        spawned += 1;
        writePackage(join(input.cacheAgentDir, 'npm', 'node_modules', 'pi-subagents'), '0.28.0');
        return Promise.resolve(0);
      },
    });
    expect(spawned).toBe(1);
    expect(result.loadDirs).toEqual([join(dir, 'npm', 'node_modules', 'pi-subagents')]);
  });

  it('warns on an unsupported specifier without spawning', async () => {
    const dir = cacheDir();
    let spawned = 0;
    const result = await ensurePiExtensions(['ext-a'], {
      cacheAgentDir: dir,
      offline: false,
      spawn: () => {
        spawned += 1;
        return Promise.resolve(0);
      },
    });
    expect(spawned).toBe(0);
    expect(result.warnings[0]).toContain('unsupported source');
  });

  it('warns when an install fails (nonzero exit)', async () => {
    const dir = cacheDir();
    const result = await ensurePiExtensions(['npm:pi-nolo'], {
      cacheAgentDir: dir,
      offline: false,
      spawn: () => Promise.resolve(1),
    });
    expect(result.loadDirs).toEqual([]);
    expect(result.warnings[0]).toContain('failed to install');
  });

  it('de-duplicates repeated specifiers into a single load dir', async () => {
    const dir = cacheDir();
    writePackage(join(dir, 'npm', 'node_modules', 'pi-nolo'), '1.0.0');
    const result = await ensurePiExtensions(['npm:pi-nolo', 'npm:pi-nolo'], {
      cacheAgentDir: dir,
      offline: false,
      spawn: () => Promise.resolve(0),
    });
    expect(result.loadDirs).toEqual([join(dir, 'npm', 'node_modules', 'pi-nolo')]);
  });

  it('warns when the install spawn rejects', async () => {
    const dir = cacheDir();
    const result = await ensurePiExtensions(['npm:pi-nolo'], {
      cacheAgentDir: dir,
      offline: false,
      spawn: () => Promise.reject(new Error('spawn pi ENOENT')),
    });
    expect(result.loadDirs).toEqual([]);
    expect(result.warnings[0]).toContain('spawn pi ENOENT');
  });

  it('warns when install reports success but the directory is missing', async () => {
    const dir = cacheDir();
    const result = await ensurePiExtensions(['npm:pi-nolo'], {
      cacheAgentDir: dir,
      offline: false,
      spawn: () => Promise.resolve(0), // exit 0 but creates nothing
    });
    expect(result.loadDirs).toEqual([]);
    expect(result.warnings[0]).toContain('pi install exited 0');
  });

  it('reinstalls a pinned npm extension when the cached install has no readable manifest', async () => {
    const dir = cacheDir();
    mkdirSync(join(dir, 'npm', 'node_modules', 'pi-subagents'), { recursive: true }); // present, but no package.json
    let spawned = 0;
    const result = await ensurePiExtensions(['npm:pi-subagents@0.28.0'], {
      cacheAgentDir: dir,
      offline: false,
      spawn: (input) => {
        spawned += 1;
        writePackage(join(input.cacheAgentDir, 'npm', 'node_modules', 'pi-subagents'), '0.28.0');
        return Promise.resolve(0);
      },
    });
    expect(spawned).toBe(1);
    expect(result.loadDirs).toEqual([join(dir, 'npm', 'node_modules', 'pi-subagents')]);
  });
});

describe('ensurePiExtensions git revision pinning', () => {
  const markerPath = (cache: string): string => `${deepworkDir(cache)}.outfitter-ref.json`;
  const readMarker = (cache: string): { readonly ref?: string; readonly headSha?: string } =>
    JSON.parse(readFileSync(markerPath(cache), 'utf8')) as { readonly ref?: string; readonly headSha?: string };

  const run = async (
    specifier: string,
    cache: string,
    offline: boolean,
    create?: (cacheAgentDir: string) => void,
  ): Promise<{
    readonly loadDirs: readonly string[];
    readonly warnings: readonly string[];
    readonly spawned: number;
  }> => {
    let spawned = 0;
    const result = await ensurePiExtensions([specifier], {
      cacheAgentDir: cache,
      offline,
      spawn: (input) => {
        spawned += 1;
        create?.(input.cacheAgentDir);
        return Promise.resolve(0);
      },
    });
    return { ...result, spawned };
  };

  it('serves a cached checkout whose HEAD matches the pinned SHA without spawning', async () => {
    const cache = cacheDir();
    const head = createGitCheckout(deepworkDir(cache));
    const result = await run(deepworkSpec(head), cache, false);
    expect(result.spawned).toBe(0);
    expect(result.loadDirs).toEqual([deepworkDir(cache)]);
    expect(result.warnings).toEqual([]);
  });

  it('removes and reinstalls a checkout whose HEAD does not match the pinned SHA', async () => {
    const cache = cacheDir();
    createGitCheckout(deepworkDir(cache));
    const pinned = 'a'.repeat(40);
    const result = await run(deepworkSpec(pinned), cache, false, (cacheAgentDir) => {
      // The stale checkout must be removed before `pi install` runs.
      expect(existsSync(deepworkDir(cacheAgentDir))).toBe(false);
      createGitCheckout(deepworkDir(cacheAgentDir));
    });
    expect(result.spawned).toBe(1);
    expect(result.loadDirs).toEqual([deepworkDir(cache)]);
    expect(existsSync(markerPath(cache))).toBe(false); // SHA pins verify via git HEAD, not a marker
  });

  it('warns and drops a stale pinned-SHA checkout when offline, naming both revisions', async () => {
    const cache = cacheDir();
    const head = createGitCheckout(deepworkDir(cache));
    const pinned = 'a'.repeat(40);
    const result = await run(deepworkSpec(pinned), cache, true);
    expect(result.spawned).toBe(0);
    expect(result.loadDirs).toEqual([]);
    expect(result.warnings[0]).toContain(`pinned ${pinned}, found ${head}`);
    expect(result.warnings[0]).toContain('cannot be reinstalled offline');
  });

  it('treats a pinned-SHA install dir that is not a git checkout as stale', async () => {
    const cache = cacheDir();
    writePackage(deepworkDir(cache), '1.0.0'); // present, but no git HEAD to verify
    const result = await run(deepworkSpec('b'.repeat(40)), cache, true);
    expect(result.loadDirs).toEqual([]);
    expect(result.warnings[0]).toContain('found no readable git HEAD');
  });

  it('records the ref and resolved SHA in a marker when installing a branch/tag pin', async () => {
    const cache = cacheDir();
    let head = '';
    const result = await run(deepworkSpec('v1.0.0'), cache, false, (cacheAgentDir) => {
      head = createGitCheckout(deepworkDir(cacheAgentDir));
    });
    expect(result.spawned).toBe(1);
    expect(result.loadDirs).toEqual([deepworkDir(cache)]);
    expect(readMarker(cache)).toEqual({ ref: 'v1.0.0', headSha: head });
  });

  it('serves a branch/tag pin whose marker matches without spawning, even offline', async () => {
    const cache = cacheDir();
    createGitCheckout(deepworkDir(cache));
    writeFileSync(markerPath(cache), JSON.stringify({ ref: 'v1.0.0' }));
    const result = await run(deepworkSpec('v1.0.0'), cache, true);
    expect(result.spawned).toBe(0);
    expect(result.loadDirs).toEqual([deepworkDir(cache)]);
    expect(result.warnings).toEqual([]);
  });

  it('reinstalls and rewrites the marker when the pinned branch/tag ref changes', async () => {
    const cache = cacheDir();
    createGitCheckout(deepworkDir(cache));
    writeFileSync(markerPath(cache), JSON.stringify({ ref: 'v1.0.0' }));
    const result = await run(deepworkSpec('v2.0.0'), cache, false, (cacheAgentDir) => {
      createGitCheckout(deepworkDir(cacheAgentDir));
    });
    expect(result.spawned).toBe(1);
    expect(readMarker(cache).ref).toBe('v2.0.0');
  });

  it('warns and drops a branch/tag pin whose marker mismatches when offline', async () => {
    const cache = cacheDir();
    createGitCheckout(deepworkDir(cache));
    writeFileSync(markerPath(cache), JSON.stringify({ ref: 'v1.0.0' }));
    const result = await run(deepworkSpec('v2.0.0'), cache, true);
    expect(result.spawned).toBe(0);
    expect(result.loadDirs).toEqual([]);
    expect(result.warnings[0]).toContain('pinned v2.0.0, found v1.0.0');
  });

  it('serves a pre-marker branch/tag cache as-is when offline', async () => {
    const cache = cacheDir();
    createGitCheckout(deepworkDir(cache));
    const result = await run(deepworkSpec('v1.0.0'), cache, true);
    expect(result.loadDirs).toEqual([deepworkDir(cache)]);
    expect(result.warnings).toEqual([]);
  });

  it('refreshes a pre-marker branch/tag cache once when online, writing the marker', async () => {
    const cache = cacheDir();
    createGitCheckout(deepworkDir(cache));
    const result = await run(deepworkSpec('v1.0.0'), cache, false, (cacheAgentDir) => {
      writePackage(deepworkDir(cacheAgentDir), '1.0.0'); // an install that is not a git checkout
    });
    expect(result.spawned).toBe(1);
    expect(readMarker(cache)).toEqual({ ref: 'v1.0.0' }); // no readable HEAD → no headSha recorded
  });

  it('treats an unreadable marker as unverified and refreshes it when online', async () => {
    const cache = cacheDir();
    createGitCheckout(deepworkDir(cache));
    writeFileSync(markerPath(cache), 'not json');
    const result = await run(deepworkSpec('v1.0.0'), cache, false, (cacheAgentDir) => {
      createGitCheckout(deepworkDir(cacheAgentDir));
    });
    expect(result.spawned).toBe(1);
    expect(readMarker(cache).ref).toBe('v1.0.0');
  });
});

describe('extension cache path containment', () => {
  it('never deletes a directory outside the cache root for a traversal specifier', async () => {
    const cache = cacheDir();
    const victim = join(cache, 'victim');
    writeFileSync(join(mkdirSync(victim, { recursive: true }) ?? victim, 'keep.txt'), 'data');
    const root = join(cache, 'agent'); // cache root beside the victim: git/../../victim escapes it
    let spawned = 0;
    const result = await ensurePiExtensions(['git:../../victim@v1'], {
      cacheAgentDir: root,
      offline: false,
      spawn: () => {
        spawned += 1;
        return Promise.resolve(0);
      },
    });
    expect(spawned).toBe(0);
    expect(result.loadDirs).toEqual([]);
    expect(result.warnings[0]).toContain('unsafe path segment');
    expect(existsSync(join(victim, 'keep.txt'))).toBe(true);
  });

  it('refuses an install dir that resolves outside the cache root before any filesystem access', () => {
    const cache = cacheDir();
    const outside = join(cache, 'outside');
    mkdirSync(outside, { recursive: true });
    const root = join(cache, 'agent');
    expect(() => assertInstallDirInsideCache(join(root, 'git', '..', '..', 'outside'), root, 'git:x/y@v1')).toThrow(
      "extension 'git:x/y@v1' resolves outside the extension cache",
    );
    // The cache root itself is not strictly inside the cache root.
    expect(() => assertInstallDirInsideCache(root, root, 'git:x/y@v1')).toThrow('outside the extension cache');
    expect(existsSync(outside)).toBe(true);
    expect(() => assertInstallDirInsideCache(join(root, 'git', 'h', 'o', 'r'), root, 'git:h/o/r')).not.toThrow();
  });
});
