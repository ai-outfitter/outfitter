// Tests specifier→pi-install mapping and the install/cache/offline behavior of ensurePiExtensions.
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensurePiExtensions, mapSpecifierToPiSource } from '../../src/extensions/PiExtensionCache.js';
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

  it('maps git specifiers to git/<host>/<owner>/<repo>, dropping any ref', () => {
    expect(mapSpecifierToPiSource('git:github.com/ai-outfitter/deepwork')).toEqual({
      source: 'git:github.com/ai-outfitter/deepwork',
      installSegments: ['git', 'github.com', 'ai-outfitter', 'deepwork'],
    });
    expect(mapSpecifierToPiSource('git:github.com/ai-outfitter/deepwork@v1.0.0')).toEqual({
      source: 'git:github.com/ai-outfitter/deepwork@v1.0.0',
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

  it('reinstalls a pinned extension when the cached install has no readable manifest', async () => {
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
