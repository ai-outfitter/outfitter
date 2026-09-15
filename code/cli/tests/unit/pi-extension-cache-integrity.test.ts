// Tests the cache-integrity policies of ensurePiExtensions: peer-dependency satisfaction for cached
// npm extensions, install-time version freshness for bare npm specifiers, and fossilized-range
// detection at install time — all against fixture caches in temp dirs with injected spawn/resolver
// fakes (never the user's real cache, never the network).
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { ensurePiExtensions } from '../../src/extensions/PiExtensionCache.js';
import type { PiPeerSpawner } from '../../src/extensions/PiExtensionPeers.js';

const roots: string[] = [];
const cacheDir = (): string => {
  const dir = mkdtemp();
  roots.push(dir);
  return dir;
};
const mkdtemp = (): string => {
  const dir = join(tmpdir(), `outfitter-ext-integrity-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const npmRoot = (cache: string): string => join(cache, 'npm');
const installDir = (cache: string, name: string): string => join(cache, 'npm', 'node_modules', ...name.split('/'));

const writePackage = (dir: string, manifest: Record<string, unknown>, entry = true): void => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'package.json'), JSON.stringify(manifest));
  if (entry) writeFileSync(join(dir, 'index.js'), '');
};

interface RunOptions {
  readonly offline?: boolean;
  readonly spawn?: (input: { readonly source: string }) => Promise<number>;
  readonly peerSpawn?: PiPeerSpawner;
  readonly npmLatest?: (name: string) => string | undefined;
  readonly npmRangeVersions?: (
    name: string,
    range: string,
  ) => { readonly satisfying?: readonly string[]; readonly latest?: string } | undefined;
}

const run = async (specifiers: readonly string[], cache: string, options: RunOptions = {}) =>
  ensurePiExtensions(specifiers, {
    cacheAgentDir: cache,
    offline: options.offline ?? false,
    spawn: options.spawn,
    peerSpawn: options.peerSpawn,
    npmLatest: options.npmLatest,
    npmRangeVersions: options.npmRangeVersions,
  });

const spawns: string[] = [];

const peerSpawns: PiPeerSpawner = (input) => {
  spawns.push(`peer:${input.name}@${input.range} --prefix ${input.npmRoot}`);
  writePackage(join(input.npmRoot, 'node_modules', ...input.name.split('/')), { name: input.name, version: '9.9.9' });
  return Promise.resolve(0);
};

afterEach(() => {
  spawns.length = 0;
});

describe('peer dependency satisfaction', () => {
  const manifestWithPeer = (peer: string, range: string, meta?: Record<string, unknown>): Record<string, unknown> => ({
    name: 'x',
    version: '1.0.0',
    peerDependencies: { [peer]: range },
    ...(meta === undefined ? {} : { peerDependenciesMeta: meta }),
  });

  it('OFTR-006 item 25: serves a present peer without spawning any install, even offline', async () => {
    const cache = cacheDir();
    writePackage(installDir(cache, 'pi-fixture'), manifestWithPeer('@scope/sdk', '>=1.0.0'));
    writePackage(join(npmRoot(cache), 'node_modules', '@scope', 'sdk'), { name: '@scope/sdk', version: '1.2.0' });
    const result = await run(['npm:pi-fixture'], cache, {
      offline: true,
      peerSpawn: () => {
        spawns.push('peer');
        return Promise.resolve(0);
      },
      spawn: () => {
        spawns.push('install');
        return Promise.resolve(0);
      },
    });
    expect(spawns).toEqual([]);
    expect(result.loadDirs).toEqual([installDir(cache, 'pi-fixture')]);
    expect(result.warnings).toEqual([]);
  });

  it('OFTR-006 item 25: installs a missing peer into the cache npm root with its declared range', async () => {
    const cache = cacheDir();
    writePackage(installDir(cache, 'pi-fixture'), manifestWithPeer('@scope/sdk', '>=1.0.0'));
    const result = await run(['npm:pi-fixture'], cache, { peerSpawn: peerSpawns });
    expect(spawns).toEqual([`peer:@scope/sdk@>=1.0.0 --prefix ${npmRoot(cache)}`]);
    expect(result.loadDirs).toEqual([installDir(cache, 'pi-fixture')]);
    expect(result.warnings).toEqual([]);
  });

  it('OFTR-006 item 25: installs a missing peer after a fresh install too', async () => {
    const cache = cacheDir();
    const result = await run(['npm:pi-fixture'], cache, {
      npmLatest: () => undefined, // the version-resolution behavior is covered by its own tests
      peerSpawn: peerSpawns,
      spawn: ({ source }) => {
        spawns.push(`install:${source}`);
        writePackage(installDir(cache, 'pi-fixture'), manifestWithPeer('@scope/sdk', '>=1.0.0'));
        return Promise.resolve(0);
      },
    });
    expect(spawns).toEqual(['install:npm:pi-fixture', `peer:@scope/sdk@>=1.0.0 --prefix ${npmRoot(cache)}`]);
    expect(result.loadDirs).toEqual([installDir(cache, 'pi-fixture')]);
  });

  it('OFTR-006 item 25: warns without spawning when a peer is missing offline', async () => {
    const cache = cacheDir();
    writePackage(installDir(cache, 'pi-fixture'), manifestWithPeer('@scope/sdk', '>=1.0.0'));
    const result = await run(['npm:pi-fixture'], cache, {
      offline: true,
      peerSpawn: () => {
        spawns.push('peer');
        return Promise.resolve(0);
      },
    });
    expect(spawns).toEqual([]);
    expect(result.loadDirs).toEqual([installDir(cache, 'pi-fixture')]);
    expect(result.warnings.join(' ')).toContain("missing peer dependency '@scope/sdk'");
    expect(result.warnings.join(' ')).toContain('cannot install it offline');
  });

  it('OFTR-006 item 25: warns without dropping the extension when the peer install fails', async () => {
    const cache = cacheDir();
    writePackage(installDir(cache, 'pi-fixture'), manifestWithPeer('@scope/sdk', '>=1.0.0'));
    const result = await run(['npm:pi-fixture'], cache, {
      peerSpawn: () => Promise.resolve(1),
    });
    expect(result.loadDirs).toEqual([installDir(cache, 'pi-fixture')]);
    expect(result.warnings.join(' ')).toContain("failed to install peer dependency '@scope/sdk' (npm exited 1)");
  });

  it('warns without dropping the extension when the peer install spawn rejects', async () => {
    const cache = cacheDir();
    writePackage(installDir(cache, 'pi-fixture'), manifestWithPeer('@scope/sdk', '>=1.0.0'));
    const result = await run(['npm:pi-fixture'], cache, {
      peerSpawn: () => Promise.reject(new Error('spawn npm ENOENT')),
    });
    expect(result.loadDirs).toEqual([installDir(cache, 'pi-fixture')]);
    expect(result.warnings.join(' ')).toContain('spawn npm ENOENT');
  });

  it('OFTR-006 item 25: never installs a peer declared optional in peerDependenciesMeta', async () => {
    const cache = cacheDir();
    writePackage(
      installDir(cache, 'pi-fixture'),
      manifestWithPeer('@scope/sdk', '>=1.0.0', { '@scope/sdk': { optional: true } }),
    );
    const result = await run(['npm:pi-fixture'], cache, {
      peerSpawn: () => {
        spawns.push('peer');
        return Promise.resolve(0);
      },
    });
    expect(spawns).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.loadDirs).toEqual([installDir(cache, 'pi-fixture')]);
  });

  it('OFTR-006 item 25: accepts a scoped peer present in the extension-local node_modules', async () => {
    const cache = cacheDir();
    writePackage(installDir(cache, 'pi-fixture'), manifestWithPeer('@scope/sdk', '>=1.0.0'));
    writePackage(join(installDir(cache, 'pi-fixture'), 'node_modules', '@scope', 'sdk'), {
      name: '@scope/sdk',
      version: '1.2.0',
    });
    const result = await run(['npm:pi-fixture'], cache, {
      peerSpawn: () => {
        spawns.push('peer');
        return Promise.resolve(0);
      },
    });
    expect(spawns).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it('OFTR-006 item 25: refuses to install a hostile peer name and warns instead', async () => {
    const cache = cacheDir();
    for (const hostile of ['../evil', 'evil\\x', '@scope', '@scope/', 'a/../b']) {
      writePackage(installDir(cache, 'pi-fixture'), manifestWithPeer(hostile, '*'));
      const result = await run(['npm:pi-fixture'], cache, {
        peerSpawn: () => {
          spawns.push('peer');
          return Promise.resolve(0);
        },
      });
      expect(spawns, hostile).toEqual([]);
      expect(result.warnings.join(' '), hostile).toContain(`invalid peer dependency name '${hostile}'`);
      expect(result.loadDirs).toEqual([installDir(cache, 'pi-fixture')]);
      rmSync(installDir(cache, 'pi-fixture'), { recursive: true, force: true });
    }
  });

  it('ignores peers declared with a non-string range and manifests that cannot be parsed', async () => {
    const cache = cacheDir();
    writePackage(installDir(cache, 'pi-fixture'), {
      name: 'x',
      version: '1.0.0',
      peerDependencies: { '@scope/sdk': 42 },
    });
    const result = await run(['npm:pi-fixture'], cache, {
      peerSpawn: () => {
        spawns.push('peer');
        return Promise.resolve(0);
      },
    });
    expect(spawns).toEqual([]);
    expect(result.loadDirs).toEqual([installDir(cache, 'pi-fixture')]);

    writeFileSync(join(installDir(cache, 'pi-fixture'), 'package.json'), 'not json');
    const unparseable = await run(['npm:pi-fixture'], cache, {
      peerSpawn: () => {
        spawns.push('peer');
        return Promise.resolve(0);
      },
    });
    expect(spawns).toEqual([]);
    expect(unparseable.loadDirs).toEqual([installDir(cache, 'pi-fixture')]);
  });

  it('checks peers once per load dir when the same package is declared twice', async () => {
    const cache = cacheDir();
    writePackage(installDir(cache, 'pi-fixture'), manifestWithPeer('@scope/sdk', '>=1.0.0'));
    await run(['npm:pi-fixture', 'npm:pi-fixture'], cache, { peerSpawn: peerSpawns });
    expect(spawns).toEqual([`peer:@scope/sdk@>=1.0.0 --prefix ${npmRoot(cache)}`]);
  });

  it('OFTR-006 item 25: keeps the peer guarantee out of git-declared extensions', async () => {
    const cache = cacheDir();
    mkdirSync(join(cache, 'git', 'github.com', 'ai-outfitter', 'deepwork'), { recursive: true });
    writeFileSync(join(cache, 'git', 'github.com', 'ai-outfitter', 'deepwork', 'index.js'), '');
    const result = await run(['git:github.com/ai-outfitter/deepwork'], cache, {
      peerSpawn: () => {
        spawns.push('peer');
        return Promise.resolve(0);
      },
    });
    expect(spawns).toEqual([]);
    expect(result.loadDirs).toEqual([join(cache, 'git', 'github.com', 'ai-outfitter', 'deepwork')]);
  });
});

describe('install-time version freshness', () => {
  it('OFTR-006 item 26: installs a bare specifier at the resolved current release, exactly', async () => {
    const cache = cacheDir();
    const result = await run(['npm:pi-fixture'], cache, {
      npmLatest: (name) => (name === 'pi-fixture' ? '0.1.16' : undefined),
      spawn: ({ source }) => {
        spawns.push(`install:${source}`);
        writePackage(installDir(cache, 'pi-fixture'), { name: 'pi-fixture', version: '0.1.16' });
        return Promise.resolve(0);
      },
    });
    expect(spawns).toEqual(['install:npm:pi-fixture@0.1.16']);
    expect(result.loadDirs).toEqual([installDir(cache, 'pi-fixture')]);
    expect(result.warnings).toEqual([]);
  });

  it('OFTR-006 item 26: falls back to the original specifier when the resolver cannot answer', async () => {
    const cache = cacheDir();
    const result = await run(['npm:pi-fixture'], cache, {
      npmLatest: () => undefined,
      spawn: ({ source }) => {
        spawns.push(`install:${source}`);
        writePackage(installDir(cache, 'pi-fixture'), { name: 'pi-fixture', version: '0.0.2' });
        return Promise.resolve(0);
      },
    });
    expect(spawns).toEqual(['install:npm:pi-fixture']);
    expect(result.warnings).toEqual([]);
    expect(result.loadDirs).toEqual([installDir(cache, 'pi-fixture')]);
  });

  it('OFTR-006 item 26: ignores an unparseable resolver answer instead of installing it', async () => {
    const cache = cacheDir();
    await run(['npm:pi-fixture'], cache, {
      npmLatest: () => 'not-a-version',
      spawn: ({ source }) => {
        spawns.push(`install:${source}`);
        writePackage(installDir(cache, 'pi-fixture'), { name: 'pi-fixture', version: '0.0.2' });
        return Promise.resolve(0);
      },
    });
    expect(spawns).toEqual(['install:npm:pi-fixture']);
  });

  it('OFTR-006 item 26: resolves a scoped bare specifier through its scope', async () => {
    const cache = cacheDir();
    await run(['npm:@scope/pi-fixture'], cache, {
      npmLatest: (name) => (name === '@scope/pi-fixture' ? '2.0.0' : undefined),
      spawn: ({ source }) => {
        spawns.push(`install:${source}`);
        writePackage(installDir(cache, '@scope/pi-fixture'), { name: '@scope/pi-fixture', version: '2.0.0' });
        return Promise.resolve(0);
      },
    });
    expect(spawns).toEqual(['install:npm:@scope/pi-fixture@2.0.0']);
  });

  it('serves the installed exact version on the next run without reinstalling', async () => {
    const cache = cacheDir();
    const spawn: RunOptions['spawn'] = ({ source }) => {
      spawns.push(`install:${source}`);
      writePackage(installDir(cache, 'pi-fixture'), { name: 'pi-fixture', version: '0.1.16' });
      return Promise.resolve(0);
    };
    await run(['npm:pi-fixture'], cache, {
      npmLatest: () => '0.1.16',
      spawn,
      peerSpawn: () => Promise.resolve(0),
    });
    spawns.length = 0;
    const second = await run(['npm:pi-fixture'], cache, { npmLatest: () => '0.1.16', spawn });
    expect(spawns).toEqual([]);
    expect(second.loadDirs).toEqual([installDir(cache, 'pi-fixture')]);
  });

  it('leaves git specifiers and exact npm pins untouched', async () => {
    const cache = cacheDir();
    await run(['npm:pi-fixture@1.0.0'], cache, {
      npmLatest: () => {
        spawns.push('latest');
        return '9.9.9';
      },
      spawn: ({ source }) => {
        spawns.push(`install:${source}`);
        writePackage(installDir(cache, 'pi-fixture'), { name: 'pi-fixture', version: '1.0.0' });
        return Promise.resolve(0);
      },
    });
    expect(spawns).toEqual(['install:npm:pi-fixture@1.0.0']);
  });
});

describe('fossilized-range detection', () => {
  it('OFTR-006 item 26: warns when the current release falls outside the declared range', async () => {
    const cache = cacheDir();
    const result = await run(['npm:pi-fixture@^0.0.2'], cache, {
      npmRangeVersions: (name, range) =>
        name === 'pi-fixture' && range === '^0.0.2' ? { satisfying: ['0.0.2'], latest: '0.1.16' } : undefined,
      spawn: ({ source }) => {
        spawns.push(`install:${source}`);
        writePackage(installDir(cache, 'pi-fixture'), { name: 'pi-fixture', version: '0.0.2' });
        return Promise.resolve(0);
      },
    });
    expect(spawns).toEqual(['install:npm:pi-fixture@^0.0.2']);
    expect(result.warnings.join(' ')).toContain("'npm:pi-fixture@^0.0.2'");
    expect(result.warnings.join(' ')).toContain('0.1.16');
    expect(result.loadDirs).toEqual([installDir(cache, 'pi-fixture')]);
  });

  it('OFTR-006 item 26: stays silent when the range still contains the current release', async () => {
    const cache = cacheDir();
    const result = await run(['npm:pi-fixture@^1.0.0'], cache, {
      npmRangeVersions: () => ({ satisfying: ['1.0.0', '1.2.0'], latest: '1.2.0' }),
      spawn: ({ source }) => {
        spawns.push(`install:${source}`);
        writePackage(installDir(cache, 'pi-fixture'), { name: 'pi-fixture', version: '1.2.0' });
        return Promise.resolve(0);
      },
    });
    expect(spawns).toEqual(['install:npm:pi-fixture@^1.0.0']);
    expect(result.warnings).toEqual([]);
  });

  it('OFTR-006 item 26: skips silently and still installs when the range check cannot answer', async () => {
    const cache = cacheDir();
    const result = await run(['npm:pi-fixture@^0.0.2'], cache, {
      npmRangeVersions: () => undefined,
      spawn: ({ source }) => {
        spawns.push(`install:${source}`);
        writePackage(installDir(cache, 'pi-fixture'), { name: 'pi-fixture', version: '0.0.2' });
        return Promise.resolve(0);
      },
    });
    expect(spawns).toEqual(['install:npm:pi-fixture@^0.0.2']);
    expect(result.warnings).toEqual([]);
  });

  it('skips the range check when the satisfaction answer is empty or malformed', async () => {
    const cache = cacheDir();
    for (const answer of [
      { satisfying: [], latest: '0.1.16' },
      { satisfying: 'garbage' as unknown as readonly string[], latest: '0.1.16' },
    ]) {
      spawns.length = 0;
      const result = await run(['npm:pi-fixture@^0.0.2'], cache, {
        npmRangeVersions: () => answer,
        spawn: ({ source }) => {
          spawns.push(`install:${source}`);
          writePackage(installDir(cache, 'pi-fixture'), { name: 'pi-fixture', version: '0.0.2' });
          return Promise.resolve(0);
        },
      });
      expect(spawns).toEqual(['install:npm:pi-fixture@^0.0.2']);
      expect(result.warnings).toEqual([]);
      rmSync(installDir(cache, 'pi-fixture'), { recursive: true, force: true });
    }
  });

  it('OFTR-006 item 26: never queries the registry for an exact specifier or a cache hit', async () => {
    const cache = cacheDir();
    writePackage(installDir(cache, 'pi-fixture'), { name: 'pi-fixture', version: '0.0.2' });
    const result = await run(['npm:pi-fixture@^0.0.2'], cache, {
      npmRangeVersions: () => {
        spawns.push('range');
        return { satisfying: ['0.0.2'], latest: '0.1.16' };
      },
      npmLatest: () => {
        spawns.push('latest');
        return undefined;
      },
    });
    expect(spawns).toEqual([]);
    expect(result.loadDirs).toEqual([installDir(cache, 'pi-fixture')]);
  });

  it('combines a fossil warning with the entry-resolution warnings in order', async () => {
    const cache = cacheDir();
    const result = await run(['npm:pi-fixture@^0.0.2'], cache, {
      npmRangeVersions: () => ({ satisfying: ['0.0.2'], latest: '0.1.16' }),
      spawn: ({ source }) => {
        spawns.push(`install:${source}`);
        writePackage(installDir(cache, 'pi-fixture'), { name: 'pi-fixture', version: '0.0.2' }, false);
        return Promise.resolve(0);
      },
    });
    expect(result.warnings).toHaveLength(2);
    expect(result.warnings[0]).toContain('no longer contains');
    expect(result.warnings[1]).toContain('exposes no resolvable entry files');
  });
});
