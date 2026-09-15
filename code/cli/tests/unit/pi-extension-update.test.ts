// Tests the `outfitter update extensions` engine: per-entry update decisions (npm exact-pin skip,
// registry-latest reinstall with peer satisfaction; git pin/tag freeze and branch fast-forward),
// entry-scoped failure isolation, and offline/dry-run posture — against fixture caches and real
// local git repositories with injected seams (never the network, never the user's real cache).
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { updateExtensions } from '../../src/extensions/ExtensionUpdate.js';
import {
  advanceOrigin,
  cleanupExtensionFixtures,
  cloneCheckout,
  extensionUpdateInput as input,
  fakePiInstall,
  git,
  gitHead,
  installNpm,
  installedManifest,
  mkCache,
  npmLatestMap,
  readJson,
  writeNpmManifest,
} from './helpers/extension-update-fixtures.js';

afterEach(cleanupExtensionFixtures);

const statuses = (result: { readonly updates: readonly { readonly status: string }[] }): readonly string[] =>
  result.updates.map((entry) => entry.status);

describe('npm update decisions', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.35).
  // An outdated npm extension is reinstalled through the pi install path as the registry's exact
  // latest version, the new version is read back from the installed manifest, and its non-optional
  // peer dependencies are re-satisfied afterwards.
  it('reinstalls an outdated npm extension at the registry latest and satisfies peers', async () => {
    const cache = mkCache();
    installNpm(cache, { name: 'hashline-pi', requested: '^0.1.0', resolved: '0.1.0' });
    installNpm(cache, {
      name: 'peerless-pi',
      requested: '^1.0.0',
      resolved: '1.0.0',
      peer: { name: 'peer-pkg', range: '^2.0.0' },
    });
    const spawn = fakePiInstall();
    const peerCalls: string[] = [];
    const result = await updateExtensions(
      input(cache, {
        npmLatest: npmLatestMap({ 'hashline-pi': '0.1.1', 'peerless-pi': '1.1.0' }),
        spawn,
        peerSpawn: (request) => {
          peerCalls.push(`${request.name}@${request.range}`);
          return Promise.resolve(0);
        },
      }),
    );
    expect(spawn.calls).toEqual(['npm:hashline-pi@0.1.1', 'npm:peerless-pi@1.1.0']);
    expect(result.updates).toHaveLength(2);
    expect(result.updates[0]).toMatchObject({
      specifier: 'npm:hashline-pi@^0.1.0',
      kind: 'npm',
      from: '0.1.0',
      to: '0.1.1',
      status: 'updated',
    });
    expect(result.warnings).toEqual([]);
    expect(peerCalls).toEqual(['peer-pkg@^2.0.0']);
  });

  it('treats a current npm extension as a no-op without spawning an install', async () => {
    const cache = mkCache();
    installNpm(cache, { name: 'hashline-pi', requested: '^0.1.1', resolved: '0.1.1' });
    const spawn = fakePiInstall();
    const result = await updateExtensions(input(cache, { npmLatest: npmLatestMap({ 'hashline-pi': '0.1.1' }), spawn }));
    expect(result.updates[0]).toMatchObject({ status: 'up-to-date', from: '0.1.1' });
    expect(result.updates[0]?.to).toBeUndefined();
    expect(spawn.calls).toEqual([]);
  });

  it('treats an exact recorded range as a pinned entry and never reinstalls it', async () => {
    const cache = mkCache();
    installNpm(cache, { name: 'pinned-pkg', requested: '1.2.3', resolved: '1.2.3' });
    const spawn = fakePiInstall();
    const result = await updateExtensions(input(cache, { npmLatest: npmLatestMap({ 'pinned-pkg': '9.9.9' }), spawn }));
    expect(result.updates[0]).toMatchObject({ status: 'skipped', statusDetail: 'pinned' });
    expect(spawn.calls).toEqual([]);
  });

  it('fails a registry lookup without touching the install and still updates other entries', async () => {
    const cache = mkCache();
    installNpm(cache, { name: 'broken-lookup', requested: '^1.0.0', resolved: '1.0.0' });
    installNpm(cache, { name: 'works', requested: '^1.0.0', resolved: '1.0.0' });
    const spawn = fakePiInstall();
    const result = await updateExtensions(
      input(cache, { npmLatest: npmLatestMap({ 'broken-lookup': undefined, works: '1.1.0' }), spawn }),
    );
    expect(result.updates[0]).toMatchObject({ status: 'failed', statusDetail: 'lookup failed' });
    expect(result.updates[1]).toMatchObject({ status: 'updated', to: '1.1.0' });
    expect(readJson(installedManifest(cache, 'broken-lookup')).version).toBe('1.0.0');
  });

  it('fails a failed install without touching the cache and still updates other entries', async () => {
    const cache = mkCache();
    installNpm(cache, { name: 'fails', requested: '^1.0.0', resolved: '1.0.0' });
    installNpm(cache, { name: 'works', requested: '^1.0.0', resolved: '1.0.0' });
    const fallback = fakePiInstall();
    const result = await updateExtensions(
      input(cache, {
        npmLatest: npmLatestMap({ fails: '2.0.0', works: '1.1.0' }),
        spawn: (request) => (request.source.startsWith('npm:fails@') ? Promise.resolve(1) : fallback(request)),
      }),
    );
    expect(result.updates[0]).toMatchObject({ status: 'failed', statusDetail: 'install failed (pi install exited 1)' });
    expect(result.updates[1]).toMatchObject({ status: 'updated' });
    expect(readJson(installedManifest(cache, 'fails')).version).toBe('1.0.0');
  });

  it('fails an unreadable npm install without attempting a lookup or install', async () => {
    const cache = mkCache();
    writeNpmManifest(cache, { 'ghost-pkg': '^1.0.0' });
    const spawn = fakePiInstall();
    const result = await updateExtensions(input(cache, { npmLatest: npmLatestMap({ 'ghost-pkg': '1.1.0' }), spawn }));
    expect(result.updates[0]).toMatchObject({ status: 'failed', statusDetail: 'unreadable install' });
    expect(spawn.calls).toEqual([]);
  });

  it('fails when the install spawn throws instead of reporting success', async () => {
    const cache = mkCache();
    installNpm(cache, { name: 'hashline-pi', requested: '^0.1.0', resolved: '0.1.0' });
    const result = await updateExtensions(
      input(cache, {
        npmLatest: npmLatestMap({ 'hashline-pi': '0.1.1' }),
        spawn: () => Promise.reject(new Error('spawn exploded')),
      }),
    );
    expect(result.updates[0]).toMatchObject({
      status: 'failed',
      statusDetail: 'install failed (Error: spawn exploded)',
    });
    expect(readJson(installedManifest(cache, 'hashline-pi')).version).toBe('0.1.0');
  });

  it('fails when the reinstalled manifest has no readable version instead of reporting success', async () => {
    const cache = mkCache();
    installNpm(cache, { name: 'hashline-pi', requested: '^0.1.0', resolved: '0.1.0' });
    const result = await updateExtensions(
      input(cache, {
        npmLatest: npmLatestMap({ 'hashline-pi': '0.1.1' }),
        // The simulated install leaves the manifest unparseable.
        spawn: () => {
          writeFileSync(installedManifest(cache, 'hashline-pi'), 'not json at all {');
          return Promise.resolve(0);
        },
      }),
    );
    expect(result.updates[0]).toMatchObject({ status: 'failed', statusDetail: 'unreadable install post-update' });
  });

  it('fails when the reinstalled manifest has a non-string version instead of reporting success', async () => {
    const cache = mkCache();
    installNpm(cache, { name: 'hashline-pi', requested: '^0.1.0', resolved: '0.1.0' });
    const result = await updateExtensions(
      input(cache, {
        npmLatest: npmLatestMap({ 'hashline-pi': '0.1.1' }),
        // The simulated install writes a manifest whose version is not a string.
        spawn: () => {
          writeFileSync(installedManifest(cache, 'hashline-pi'), JSON.stringify({ name: 'hashline-pi', version: 123 }));
          return Promise.resolve(0);
        },
      }),
    );
    expect(result.updates[0]).toMatchObject({ status: 'failed', statusDetail: 'unreadable install post-update' });
  });

  it('surfaces a failed peer install as a warning while keeping the entry updated', async () => {
    const cache = mkCache();
    installNpm(cache, {
      name: 'hashline-pi',
      requested: '^0.1.0',
      resolved: '0.1.0',
      peer: { name: 'peer-pkg', range: '^2.0.0' },
    });
    const result = await updateExtensions(
      input(cache, {
        npmLatest: npmLatestMap({ 'hashline-pi': '0.1.1' }),
        spawn: fakePiInstall(),
        peerSpawn: () => Promise.resolve(1),
      }),
    );
    expect(result.updates[0]).toMatchObject({ status: 'updated', to: '0.1.1' });
    expect(result.warnings.join('\n')).toContain('peer-pkg');
  });
});

describe('git update decisions', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.35).
  // A branch-pinned checkout fast-forwards to the remote tip of its pinned ref with fetch-then-
  // ff-only merge, and the install marker records the new HEAD.
  it('fast-forwards a moved branch pin and refreshes the marker', async () => {
    const cache = mkCache();
    const { originPath, checkoutDir } = cloneCheckout(cache, ['github.com', 'user', 'repo'], {
      marker: { ref: 'main' },
    });
    const headBefore = gitHead(checkoutDir);
    const newSha = advanceOrigin(originPath, 'v2');
    const result = await updateExtensions(input(cache));
    expect(result.updates[0]).toMatchObject({
      specifier: 'git:github.com/user/repo@main',
      kind: 'git',
      from: headBefore.slice(0, 7),
      to: newSha.slice(0, 7),
      status: 'updated',
    });
    expect(gitHead(checkoutDir)).toBe(newSha);
    expect(readJson(`${checkoutDir}.outfitter-ref.json`)).toEqual({ ref: 'main', headSha: newSha });
    expect(result.warnings).toEqual([]);
  });

  it('reports up-to-date without fetching when the tip matches HEAD', async () => {
    const cache = mkCache();
    const { originPath, headSha } = cloneCheckout(cache, ['github.com', 'user', 'fresh'], {
      marker: { ref: 'main' },
    });
    let fetched = false;
    const result = await updateExtensions(
      input(cache, {
        gitRemoteTip: (url) => (url === originPath ? headSha : undefined),
        fastForward: () => {
          fetched = true;
        },
      }),
    );
    expect(result.updates[0]?.status).toBe('up-to-date');
    expect(fetched).toBe(false);
  });

  it('freezes full-SHA pins and tag pins without any upstream lookup', async () => {
    const cache = mkCache();
    cloneCheckout(cache, ['github.com', 'user', 'sha-pin'], { detach: true });
    const { checkoutDir } = cloneCheckout(cache, ['github.com', 'user', 'tag-pin'], { marker: { ref: 'v1.0.0' } });
    git(['tag', 'v1.0.0'], checkoutDir);
    let consulted = false;
    const result = await updateExtensions(
      input(cache, {
        gitRemoteTip: () => {
          consulted = true;
          return undefined;
        },
      }),
    );
    expect(statuses(result)).toEqual(['skipped', 'skipped']);
    for (const entry of result.updates) expect(entry.statusDetail).toBe('pinned');
    expect(consulted).toBe(false);
  });

  it('fast-forwards an unpinned checkout to the default branch without creating a marker', async () => {
    const cache = mkCache();
    const { originPath, checkoutDir } = cloneCheckout(cache, ['github.com', 'user', 'loose']);
    const newSha = advanceOrigin(originPath, 'v2');
    const result = await updateExtensions(input(cache));
    expect(result.updates[0]).toMatchObject({ specifier: 'git:github.com/user/loose', status: 'updated' });
    expect(gitHead(checkoutDir)).toBe(newSha);
    expect(existsSync(`${checkoutDir}.outfitter-ref.json`)).toBe(false);
  });

  it('fails a fetch failure without touching the checkout and still updates other entries', async () => {
    const cache = mkCache();
    const failing = cloneCheckout(cache, ['github.com', 'user', 'no-fetch'], { marker: { ref: 'main' } });
    advanceOrigin(failing.originPath, 'v2');
    const { originPath: otherOrigin } = cloneCheckout(cache, ['github.com', 'user', 'ok-repo']);
    advanceOrigin(otherOrigin, 'v2');
    const result = await updateExtensions(
      input(cache, {
        // The tip answers success for both, but the first checkout's fast-forward fetch fails.
        fastForward: (installDir) => {
          if (installDir === failing.checkoutDir) throw new Error('git fetch failed');
        },
      }),
    );
    expect(result.updates[0]).toMatchObject({ status: 'failed', statusDetail: 'git fetch failed' });
    expect(result.updates[1]?.status).toBe('updated');
    expect(gitHead(failing.checkoutDir)).toBe(failing.headSha);
  });

  it('fails a non-fast-forwardable checkout instead of resetting it', async () => {
    const cache = mkCache();
    const { originPath, checkoutDir } = cloneCheckout(cache, ['github.com', 'user', 'diverged'], {
      marker: { ref: 'main' },
    });
    // A local commit diverges from the origin's new commit: ff-only must refuse.
    writeFileSync(join(checkoutDir, 'local.js'), 'local');
    git(['add', '.'], checkoutDir);
    git(['commit', '-qm', 'local'], checkoutDir);
    const localHead = gitHead(checkoutDir);
    advanceOrigin(originPath, 'v2');
    const result = await updateExtensions(input(cache));
    expect(result.updates[0]?.status).toBe('failed');
    expect(result.updates[0]?.statusDetail).toContain('not fast-forwardable');
    expect(gitHead(checkoutDir)).toBe(localHead);
  });

  it('fails a tip lookup failure before any fetch', async () => {
    const cache = mkCache();
    const { checkoutDir } = cloneCheckout(cache, ['github.com', 'user', 'lookup-fail'], {
      marker: { ref: 'main' },
    });
    const headBefore = gitHead(checkoutDir);
    let fetched = false;
    const result = await updateExtensions(
      input(cache, {
        gitRemoteTip: () => undefined,
        fastForward: () => {
          fetched = true;
        },
      }),
    );
    expect(result.updates[0]).toMatchObject({ status: 'failed', statusDetail: 'lookup failed' });
    expect(fetched).toBe(false);
    expect(gitHead(checkoutDir)).toBe(headBefore);
  });

  it('fails a checkout with no readable origin before any lookup', async () => {
    const cache = mkCache();
    const { checkoutDir } = cloneCheckout(cache, ['github.com', 'user', 'no-origin'], { marker: { ref: 'main' } });
    git(['remote', 'remove', 'origin'], checkoutDir);
    const result = await updateExtensions(input(cache));
    expect(result.updates[0]).toMatchObject({ status: 'failed', statusDetail: 'no readable origin' });
  });

  it('fails an unreadable git HEAD without touching anything', async () => {
    const cache = mkCache();
    const broken = join(cache, 'git', 'github.com', 'user', 'broken');
    mkdirSync(join(broken, '.git'), { recursive: true });
    const result = await updateExtensions(input(cache));
    expect(result.updates[0]).toMatchObject({ status: 'failed', statusDetail: 'unreadable install' });
  });

  it('fails a checkout whose fast-forward throws a non-error value with a readable reason', async () => {
    const cache = mkCache();
    const { originPath } = cloneCheckout(cache, ['github.com', 'user', 'thrown'], { marker: { ref: 'main' } });
    advanceOrigin(originPath, 'v2');
    const result = await updateExtensions(
      input(cache, {
        fastForward: () => {
          // eslint-disable-next-line @typescript-eslint/only-throw-error -- exercising the non-Error path
          throw 'not-an-error';
        },
      }),
    );
    expect(result.updates[0]).toMatchObject({ status: 'failed', statusDetail: 'not-an-error' });
  });

  it('skips the marker refresh when the specifier cannot be mapped back to a pin', async () => {
    const cache = mkCache();
    // A one-segment checkout path produces the specifier 'git:repo@main', which the specifier
    // grammar rejects; the fast-forward still succeeds and the marker is left untouched.
    const { originPath, checkoutDir, headSha } = cloneCheckout(cache, ['repo'], { marker: { ref: 'main' } });
    const newSha = advanceOrigin(originPath, 'v2');
    const result = await updateExtensions(input(cache));
    expect(result.updates[0]).toMatchObject({ specifier: 'git:repo@main', status: 'updated' });
    expect(gitHead(checkoutDir)).toBe(newSha);
    // The marker could not be mapped back to a pin, so its recorded HEAD stays the original.
    expect(readJson(`${checkoutDir}.outfitter-ref.json`).headSha).toBe(headSha);
  });
});

describe('offline and dry-run posture', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.35).
  // --offline skips every lookup and mutation with per-entry offline statuses; --dry-run performs
  // the read-only lookups, reports would-update targets, and never mutates the cache.
  it('reports every entry offline with no lookups and no mutation', async () => {
    const cache = mkCache();
    installNpm(cache, { name: 'hashline-pi', requested: '^0.1.0', resolved: '0.1.0' });
    const { headSha, checkoutDir } = cloneCheckout(cache, ['github.com', 'user', 'repo'], {
      marker: { ref: 'main' },
    });
    let consulted = false;
    const spawn = fakePiInstall();
    const result = await updateExtensions(
      input(cache, {
        offline: true,
        npmLatest: () => {
          consulted = true;
          return '9.9.9';
        },
        spawn,
      }),
    );
    expect(statuses(result)).toEqual(['offline', 'offline']);
    expect(consulted).toBe(false);
    expect(spawn.calls).toEqual([]);
    expect(readJson(installedManifest(cache, 'hashline-pi')).version).toBe('0.1.0');
    expect(gitHead(checkoutDir)).toBe(headSha);
  });

  it('reports would-update targets in dry-run mode without mutating anything', async () => {
    const cache = mkCache();
    installNpm(cache, { name: 'hashline-pi', requested: '^0.1.0', resolved: '0.1.0' });
    installNpm(cache, { name: 'pinned-pkg', requested: '1.0.0', resolved: '1.0.0' });
    const { originPath, checkoutDir } = cloneCheckout(cache, ['github.com', 'user', 'repo'], {
      marker: { ref: 'main' },
    });
    const headBefore = gitHead(checkoutDir);
    const newSha = advanceOrigin(originPath, 'v2');
    const spawn = fakePiInstall();
    const result = await updateExtensions(
      input(cache, { dryRun: true, npmLatest: npmLatestMap({ 'hashline-pi': '0.1.1' }), spawn }),
    );
    expect(result.updates[0]).toMatchObject({
      status: 'would-update',
      statusDetail: 'to 0.1.1',
      from: '0.1.0',
      to: '0.1.1',
    });
    expect(result.updates[1]).toMatchObject({ status: 'skipped', statusDetail: 'pinned' });
    expect(result.updates[2]).toMatchObject({ status: 'would-update', statusDetail: `to ${newSha.slice(0, 7)}` });
    expect(spawn.calls).toEqual([]);
    expect(readJson(installedManifest(cache, 'hashline-pi')).version).toBe('0.1.0');
    expect(gitHead(checkoutDir)).toBe(headBefore);
  });
});

describe('deterministic ordering', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.35).
  // Update entries inherit the report's deterministic order: npm entries by package name before
  // git entries by checkout path, stable across repeated runs over equivalent cache state.
  it('orders npm entries by name before git entries by checkout path, stably', async () => {
    const build = (): string => {
      const cache = mkCache();
      installNpm(cache, { name: 'zeta-pkg', requested: '^1.0.0', resolved: '1.0.0' });
      installNpm(cache, { name: 'alpha-pkg', requested: '^1.0.0', resolved: '1.0.0' });
      cloneCheckout(cache, ['github.com', 'user', 'a-repo'], { marker: { ref: 'main' } });
      cloneCheckout(cache, ['github.com', 'user', 'b-repo'], { marker: { ref: 'main' } });
      return cache;
    };
    const first = await updateExtensions(input(build()));
    const second = await updateExtensions(input(build()));
    expect(first.updates.map((entry) => entry.source)).toEqual([
      'alpha-pkg',
      'zeta-pkg',
      'github.com/user/a-repo',
      'github.com/user/b-repo',
    ]);
    expect(first.updates.map((entry) => entry.status)).toEqual(second.updates.map((entry) => entry.status));
  });
});
