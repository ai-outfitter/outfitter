// Shared fixtures for the pi extension update tests: fixture caches in temp directories (npm
// manifest + installed packages, git checkouts cloned from real local origin repositories) and
// injectable seam fakes (registry answers, install/peer spawners) so tests never touch the network
// or the user's real cache.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionUpdateInput } from '../../../src/extensions/ExtensionUpdate.js';
import type { PiInstallSpawner } from '../../../src/extensions/PiExtensionCache.js';

const roots: string[] = [];

/** Removes every temporary fixture root; call from `afterEach`. */
export const cleanupExtensionFixtures = (): void => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
};

export const mkCache = (): string => {
  const dir = join(tmpdir(), `outfitter-ext-update-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  roots.push(dir);
  return dir;
};

export interface JsonRecord {
  readonly version?: unknown;
  readonly ref?: unknown;
  readonly headSha?: unknown;
  readonly dependencies?: unknown;
}

export const readJson = (path: string): JsonRecord => JSON.parse(readFileSync(path, 'utf8')) as JsonRecord;

export const git = (arguments_: readonly string[], cwd: string): string =>
  execFileSync('git', [...arguments_], { cwd, encoding: 'utf8' }).trim();

export const gitHead = (dir: string): string => git(['rev-parse', 'HEAD'], dir);

export const nodeModules = (cache: string): string => join(cache, 'npm', 'node_modules');

export const installedManifest = (cache: string, name: string): string =>
  join(nodeModules(cache), ...name.split('/'), 'package.json');

export interface NpmFixture {
  readonly name: string;
  /** The dependency entry the cache npm manifest records (exact entries are treated as pins). */
  readonly requested: string;
  readonly resolved: string;
  /** Declared non-optional peer dependency written into the installed manifest. */
  readonly peer?: { readonly name: string; readonly range: string };
}

export const installNpm = (cache: string, fixture: NpmFixture): void => {
  const dir = join(nodeModules(cache), ...fixture.name.split('/'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({
      name: fixture.name,
      version: fixture.resolved,
      ...(fixture.peer === undefined ? {} : { peerDependencies: { [fixture.peer.name]: fixture.peer.range } }),
    }),
  );
  writeNpmManifest(cache, { [fixture.name]: fixture.requested });
};

export const writeNpmManifest = (cache: string, dependencies: Record<string, string>): void => {
  const manifestPath = join(cache, 'npm', 'package.json');
  mkdirSync(join(cache, 'npm'), { recursive: true });
  const existing = existsSync(manifestPath) ? readJson(manifestPath) : {};
  writeFileSync(
    manifestPath,
    JSON.stringify({
      name: 'pi-extensions',
      private: true,
      dependencies: { ...(existing.dependencies ?? {}), ...dependencies },
    }),
  );
};

export const npmLatestMap =
  (answers: Record<string, string | undefined>): ((name: string) => string | undefined) =>
  (name) =>
    answers[name];

/** Simulates `pi install npm:<name>@<version>`: rewrites the installed manifest to that version. */
export const fakePiInstall = (): PiInstallSpawner & { readonly calls: string[] } => {
  const calls: string[] = [];
  const spawn: PiInstallSpawner = (request) => {
    calls.push(request.source);
    const match = /^npm:(.+)@(.+)$/u.exec(request.source);
    if (match === null) return Promise.resolve(1);
    const installDir = join(request.cacheAgentDir, 'npm', 'node_modules', ...match[1].split('/'));
    if (!existsSync(installDir)) return Promise.resolve(1);
    const manifest = readJson(join(installDir, 'package.json'));
    writeFileSync(join(installDir, 'package.json'), JSON.stringify({ ...manifest, version: match[2] }));
    return Promise.resolve(0);
  };
  return Object.assign(spawn, { calls });
};

export interface ClonedCheckout {
  readonly originPath: string;
  readonly headSha: string;
  readonly checkoutDir: string;
}

/** Creates a local origin repository plus a cloned checkout inside the cache git root. */
export const cloneCheckout = (
  cache: string,
  segments: readonly string[],
  options: { readonly marker?: { readonly ref: string }; readonly detach?: boolean } = {},
): ClonedCheckout => {
  const originPath = join(mkCache(), 'origin', segments.join('-'));
  mkdirSync(originPath, { recursive: true });
  git(['init', '-q', '-b', 'main'], originPath);
  git(['config', 'user.email', 'fixture@example.com'], originPath);
  git(['config', 'user.name', 'Fixture'], originPath);
  writeFileSync(join(originPath, 'ext.js'), 'v1');
  git(['add', '.'], originPath);
  git(['commit', '-qm', 'one'], originPath);
  const headSha = gitHead(originPath);

  const checkoutDir = join(cache, 'git', ...segments);
  git(['clone', '-q', originPath, checkoutDir], cache);
  git(['config', 'user.email', 'fixture@example.com'], checkoutDir);
  git(['config', 'user.name', 'Fixture'], checkoutDir);
  if (options.marker !== undefined) {
    writeFileSync(
      `${checkoutDir}.outfitter-ref.json`,
      JSON.stringify({ ref: options.marker.ref, headSha: gitHead(checkoutDir) }),
    );
  }
  if (options.detach) git(['checkout', '-q', '--detach'], checkoutDir);
  return { originPath, headSha, checkoutDir };
};

/** Adds a commit on the origin's main branch and returns the new SHA. */
export const advanceOrigin = (originPath: string, content: string): string => {
  writeFileSync(join(originPath, 'ext.js'), content);
  git(['add', '.'], originPath);
  git(['commit', '-qm', 'two'], originPath);
  return gitHead(originPath);
};

export const extensionUpdateInput = (
  cache: string,
  overrides: Partial<ExtensionUpdateInput> = {},
): ExtensionUpdateInput => ({
  cacheAgentDir: cache,
  npmLatest: npmLatestMap({}),
  ...overrides,
});
