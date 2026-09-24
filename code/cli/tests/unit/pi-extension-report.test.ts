// Tests the read-only `outfitter list extensions` report: cache-state discovery (npm manifest +
// installed versions, git checkouts with markers/detached HEADs), the upstream status model, and
// its offline/strict degradation — all against fixture caches in temp dirs with injected resolver
// fakes (never the user's real cache, never the network).
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { buildExtensionReport, defaultGitRemoteTip, isGreaterSemver } from '../../src/extensions/ExtensionReport.js';
import type { ExtensionReportInput, GitRemoteTipResolver } from '../../src/extensions/ExtensionReport.js';

const roots: string[] = [];
const readJsonFile = (path: string): unknown => {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return undefined;
  }
};
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const mkCache = (): string => {
  const dir = join(tmpdir(), `outfitter-ext-report-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  roots.push(dir);
  return dir;
};

const git = (arguments_: readonly string[], cwd?: string): string =>
  execFileSync('git', [...arguments_], { cwd, encoding: 'utf8' }).trim();

const npmRoot = (cache: string): string => join(cache, 'npm');
const nodeModules = (cache: string): string => join(npmRoot(cache), 'node_modules');

interface NpmFixture {
  readonly name: string;
  /** The dependency entry the cache npm manifest records (range, exact version, or bare). */
  readonly requested?: string;
  readonly resolved?: string;
  /** When true, no installed package directory/manifest is written at all. */
  readonly missing?: boolean;
  /** When true, the installed manifest is written corrupt (unparseable). */
  readonly corrupt?: boolean;
}

const installNpm = (cache: string, fixture: NpmFixture): void => {
  if (!fixture.missing) {
    const dir = join(nodeModules(cache), ...fixture.name.split('/'));
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, 'package.json'),
      fixture.corrupt ? 'not json at all {' : JSON.stringify({ name: fixture.name, version: fixture.resolved }),
    );
  }
  writeNpmManifest(cache, { [fixture.name]: fixture.requested ?? fixture.resolved ?? '*' });
};

const writeNpmManifest = (cache: string, dependencies: Record<string, string>): void => {
  mkdirSync(npmRoot(cache), { recursive: true });
  const manifestPath = join(npmRoot(cache), 'package.json');
  const existing = readJsonFile(manifestPath) as { dependencies?: Record<string, string> } | undefined;
  writeFileSync(
    manifestPath,
    JSON.stringify({
      name: 'pi-extensions',
      private: true,
      dependencies: { ...existing?.dependencies, ...dependencies },
    }),
  );
};

/** Creates a real local git checkout under the cache git root; returns its HEAD SHA. */
const checkoutGit = (
  cache: string,
  segments: readonly string[],
  options: { readonly marker?: { readonly ref: string }; readonly detach?: boolean } = {},
): string => {
  const dir = join(cache, 'git', ...segments);
  mkdirSync(dir, { recursive: true });
  git(['init', '-q'], dir);
  git(['config', 'user.email', 'fixture@example.com'], dir);
  git(['config', 'user.name', 'Fixture'], dir);
  writeFileSync(join(dir, 'package.json'), JSON.stringify({ name: 'fixture-ext', version: '0.0.0' }));
  git(['add', '.'], dir);
  git(['commit', '-qm', 'fixture'], dir);
  if (options.marker !== undefined) {
    writeFileSync(
      `${dir}.outfitter-ref.json`,
      JSON.stringify({ ref: options.marker.ref, headSha: git(['rev-parse', 'HEAD'], dir) }),
    );
  }
  if (options.detach) git(['checkout', '-q', '--detach'], dir);
  git(['remote', 'add', 'origin', `https://${segments.join('/')}.git`], dir);
  return git(['rev-parse', 'HEAD'], dir);
};

const input = (cache: string, overrides: Partial<ExtensionReportInput> = {}): ExtensionReportInput => ({
  cacheAgentDir: cache,
  ...overrides,
});

const npmLatestMap =
  (answers: Record<string, string | undefined>): ((name: string) => string | undefined) =>
  (name) =>
    answers[name];

const gitTip =
  (answers: Record<string, string>): GitRemoteTipResolver =>
  (originUrl, ref) =>
    answers[`${originUrl}#${ref ?? 'HEAD'}`];

describe('cache discovery and entry model', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.34).
  // The extensions listing is built from cache state alone: npm manifest dependencies with resolved
  // installed versions, git markers/detached HEADs, degraded entries with warnings, and the
  // exclusion of undeclared node_modules entries and local-path extensions (never cached).
  it('reports an empty result for an absent cache directory', () => {
    const report = buildExtensionReport(input(mkCache()));
    expect(report.entries).toEqual([]);
    expect(report.warnings).toEqual([]);
  });

  it('reports an empty npm result when the cache npm root exists without a manifest', () => {
    const cache = mkCache();
    mkdirSync(npmRoot(cache), { recursive: true });
    const report = buildExtensionReport(input(cache));
    expect(report.entries).toEqual([]);
  });

  it('reports nothing for local-path extensions because they never enter the cache', () => {
    const cache = mkCache();
    // A plausible local extension file inside the cache root is still not cache state: local
    // paths are served from disk at launch (OFTR-006 item 28) and never installed or recorded.
    writeFileSync(join(cache, 'ext.js'), '');
    const report = buildExtensionReport(input(cache));
    expect(report.entries).toEqual([]);
  });

  it('reports a range-carrying npm extension with its requested range and resolved version', () => {
    const cache = mkCache();
    installNpm(cache, { name: 'hashline-pi', requested: '^0.1.1', resolved: '0.1.1' });
    const report = buildExtensionReport(input(cache, { npmLatest: npmLatestMap({}) }));
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]).toMatchObject({
      specifier: 'npm:hashline-pi@^0.1.1',
      source: 'hashline-pi',
      kind: 'npm',
      resolvedVersion: '0.1.1',
      requestedRange: '^0.1.1',
    });
  });

  it('reports a bare-cache dependency entry as an unpinned specifier', () => {
    const cache = mkCache();
    installNpm(cache, { name: 'exact-pkg', requested: '1.2.3', resolved: '1.2.3' });
    const report = buildExtensionReport(input(cache, { npmLatest: npmLatestMap({}) }));
    expect(report.entries[0]?.specifier).toBe('npm:exact-pkg@1.2.3');
    expect(report.entries[0]?.requestedRange).toBe('1.2.3');
  });

  it('reports scoped npm packages with their scope intact', () => {
    const cache = mkCache();
    installNpm(cache, { name: '@scope/pkg', requested: '^2.0.0', resolved: '2.0.0' });
    const report = buildExtensionReport(input(cache, { npmLatest: npmLatestMap({}) }));
    expect(report.entries[0]?.specifier).toBe('npm:@scope/pkg@^2.0.0');
    expect(report.entries[0]?.source).toBe('@scope/pkg');
  });

  it('degrades an unreadable installed npm manifest to unknown with a warning', () => {
    const cache = mkCache();
    installNpm(cache, { name: 'broken-pkg', requested: '^1.0.0', corrupt: true });
    const report = buildExtensionReport(input(cache));
    expect(report.entries[0]?.status).toBe('unknown');
    expect(report.entries[0]?.statusDetail).toContain('unreadable');
    expect(report.warnings.join('\n')).toContain('broken-pkg');
  });

  it('excludes node_modules entries absent from the cache npm manifest dependencies', () => {
    const cache = mkCache();
    installNpm(cache, { name: 'declared-pkg', requested: '^1.0.0', resolved: '1.0.0' });
    const peerDir = join(nodeModules(cache), 'peer-only-pkg');
    mkdirSync(peerDir, { recursive: true });
    writeFileSync(join(peerDir, 'package.json'), JSON.stringify({ name: 'peer-only-pkg', version: '9.9.9' }));
    const report = buildExtensionReport(input(cache));
    expect(report.entries.map((entry) => entry.source)).toEqual(['declared-pkg']);
  });

  it('recovers a git branch pin from the install marker', () => {
    const cache = mkCache();
    const head = checkoutGit(cache, ['github.com', 'user', 'repo'], { marker: { ref: 'main' } });
    const report = buildExtensionReport(input(cache, { gitRemoteTip: gitTip({}) }));
    expect(report.entries).toHaveLength(1);
    expect(report.entries[0]).toMatchObject({
      specifier: 'git:github.com/user/repo@main',
      source: 'github.com/user/repo',
      kind: 'git',
      pinnedRef: 'main',
      headSha: head,
    });
  });

  it('treats a markerless checkout with a detached HEAD as a frozen SHA pin', () => {
    const cache = mkCache();
    const head = checkoutGit(cache, ['github.com', 'user', 'sha-pinned'], { detach: true });
    const report = buildExtensionReport(
      input(cache, { gitRemoteTip: gitTip({ 'https://github.com/user/sha-pinned.git#HEAD': 'f'.repeat(40) }) }),
    );
    expect(report.entries[0]).toMatchObject({
      specifier: 'git:github.com/user/sha-pinned',
      kind: 'git',
      pinnedRef: undefined,
      headSha: head,
      status: 'pinned',
    });
    expect(report.entries[0]?.statusDetail).toContain(head.slice(0, 7));
  });

  it('treats a markerless checkout with an attached HEAD as unpinned', () => {
    const cache = mkCache();
    checkoutGit(cache, ['github.com', 'user', 'unpinned']);
    const report = buildExtensionReport(input(cache, { gitRemoteTip: gitTip({}) }));
    expect(report.entries[0]?.specifier).toBe('git:github.com/user/unpinned');
    expect(report.entries[0]?.pinnedRef).toBeUndefined();
  });

  it('degrades a git checkout with an unreadable origin to unknown with a warning', () => {
    const cache = mkCache();
    checkoutGit(cache, ['github.com', 'user', 'no-origin'], { marker: { ref: 'main' } });
    const dir = join(cache, 'git', 'github.com', 'user', 'no-origin');
    git(['remote', 'remove', 'origin'], dir);
    const report = buildExtensionReport(input(cache, { gitRemoteTip: gitTip({}) }));
    expect(report.entries[0]?.status).toBe('unknown');
    expect(report.warnings.join('\n')).toContain('github.com/user/no-origin');
  });

  it('degrades a git checkout with an unreadable HEAD to unknown with a warning', () => {
    const cache = mkCache();
    const broken = join(cache, 'git', 'github.com', 'user', 'broken');
    mkdirSync(join(broken, '.git'), { recursive: true });
    const report = buildExtensionReport(input(cache, { gitRemoteTip: gitTip({}) }));
    expect(report.entries[0]).toMatchObject({ status: 'unknown', statusDetail: 'unreadable install' });
    expect(report.warnings.join('\n')).toContain('github.com/user/broken');
  });

  it('answers remote tips with the real ls-remote resolver against a local repository', () => {
    const repo = mkCache();
    git(['init', '-q'], repo);
    git(['config', 'user.email', 'fixture@example.com'], repo);
    git(['config', 'user.name', 'Fixture'], repo);
    writeFileSync(join(repo, 'file.txt'), 'x');
    git(['add', '.'], repo);
    git(['commit', '-qm', 'fixture'], repo);
    const head = git(['rev-parse', 'HEAD'], repo);
    expect(defaultGitRemoteTip(repo, 'HEAD')).toBe(head);
    expect(defaultGitRemoteTip(repo)).toBe(head);
    expect(defaultGitRemoteTip(repo, 'no-such-ref')).toBeUndefined();
    expect(defaultGitRemoteTip(join(tmpdir(), 'outfitter-ext-report-missing-repo'))).toBeUndefined();
  });
});

describe('upstream status model', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.34).
  // Each entry carries exactly one status: up-to-date, update-available (semver-gt for npm; remote
  // tip vs HEAD for git), pinned for full-SHA pins, or unknown with a warning on failed lookups.
  it('reports update-available when the registry latest is strictly greater', () => {
    const cache = mkCache();
    installNpm(cache, { name: 'hashline-pi', requested: '^0.1.1', resolved: '0.1.1' });
    const report = buildExtensionReport(input(cache, { npmLatest: npmLatestMap({ 'hashline-pi': '0.2.0' }) }));
    expect(report.entries[0]).toMatchObject({ status: 'update-available', statusDetail: '0.2.0' });
  });

  it('reports up-to-date when the resolved version equals the registry latest', () => {
    const cache = mkCache();
    installNpm(cache, { name: 'hashline-pi', requested: '^0.1.1', resolved: '0.2.0' });
    const report = buildExtensionReport(input(cache, { npmLatest: npmLatestMap({ 'hashline-pi': '0.2.0' }) }));
    expect(report.entries[0]?.status).toBe('up-to-date');
  });

  it('reports up-to-date when the resolved version is newer than the registry latest', () => {
    const cache = mkCache();
    installNpm(cache, { name: 'hashline-pi', requested: '^0.1.1', resolved: '0.3.0' });
    const report = buildExtensionReport(input(cache, { npmLatest: npmLatestMap({ 'hashline-pi': '0.2.0' }) }));
    expect(report.entries[0]?.status).toBe('up-to-date');
  });

  it('reports unknown with a warning when the registry lookup fails online', () => {
    const cache = mkCache();
    installNpm(cache, { name: 'hashline-pi', requested: '^0.1.1', resolved: '0.1.1' });
    const report = buildExtensionReport(input(cache, { npmLatest: npmLatestMap({ 'hashline-pi': undefined }) }));
    expect(report.entries[0]?.status).toBe('unknown');
    expect(report.entries[0]?.statusDetail).toContain('lookup failed');
    expect(report.warnings.join('\n')).toContain('hashline-pi');
  });

  it('compares prerelease versions below their release', () => {
    expect(isGreaterSemver('1.0.0-alpha.1', '1.0.0')).toBe(false);
    expect(isGreaterSemver('1.0.0', '1.0.0-alpha.1')).toBe(true);
    expect(isGreaterSemver('1.0.0-alpha.2', '1.0.0-alpha.1')).toBe(true);
    expect(isGreaterSemver('1.0.0-rc.1', '1.0.0-beta.2')).toBe(true);
    expect(isGreaterSemver('0.2.0', '0.1.9')).toBe(true);
    expect(isGreaterSemver('0.10.0', '0.9.0')).toBe(true);
    expect(isGreaterSemver('1.0.0', '1.0.0')).toBe(false);
  });

  it('treats unparseable or undefined versions as incomparable', () => {
    expect(isGreaterSemver(undefined, '1.0.0')).toBe(false);
    expect(isGreaterSemver('1.0.0', undefined)).toBe(false);
    expect(isGreaterSemver('not-a-version', '1.0.0')).toBe(false);
    expect(isGreaterSemver('1.0', '1.0.0')).toBe(false);
    expect(isGreaterSemver('1.0.0+build.1', '1.0.0')).toBe(false);
  });

  it('compares prerelease identifiers numerically, then lexically, then by length', () => {
    expect(isGreaterSemver('1.0.0-2', '1.0.0-10')).toBe(false);
    expect(isGreaterSemver('1.0.0-10', '1.0.0-2')).toBe(true);
    expect(isGreaterSemver('1.0.0-1', '1.0.0-alpha')).toBe(false);
    expect(isGreaterSemver('1.0.0-alpha', '1.0.0-1')).toBe(true);
    expect(isGreaterSemver('1.0.0-beta', '1.0.0-alpha')).toBe(true);
    expect(isGreaterSemver('1.0.0-alpha.1', '1.0.0-alpha')).toBe(true);
    expect(isGreaterSemver('1.0.0-alpha', '1.0.0-alpha.1')).toBe(false);
  });

  it('reports update-available when the pinned branch moved remotely', () => {
    const cache = mkCache();
    checkoutGit(cache, ['github.com', 'user', 'moved'], { marker: { ref: 'main' } });
    const report = buildExtensionReport(
      input(cache, {
        gitRemoteTip: gitTip({ 'https://github.com/user/moved.git#main': 'abc1234abc1234abc1234abc1234abc1234abc12' }),
      }),
    );
    expect(report.entries[0]?.status).toBe('update-available');
    expect(report.entries[0]?.statusDetail).toContain('abc1234');
  });

  it('reports up-to-date when the remote tip matches the checkout HEAD', () => {
    const cache = mkCache();
    const head = checkoutGit(cache, ['github.com', 'user', 'fresh'], { marker: { ref: 'main' } });
    const report = buildExtensionReport(
      input(cache, { gitRemoteTip: gitTip({ 'https://github.com/user/fresh.git#main': head }) }),
    );
    expect(report.entries[0]?.status).toBe('up-to-date');
  });

  it('reports unknown with a warning when the git tip lookup fails online', () => {
    const cache = mkCache();
    checkoutGit(cache, ['github.com', 'user', 'fails'], { marker: { ref: 'main' } });
    const report = buildExtensionReport(input(cache, { gitRemoteTip: gitTip({}) }));
    expect(report.entries[0]?.status).toBe('unknown');
    expect(report.warnings.join('\n')).toContain('github.com/user/fails');
  });
});

describe('network posture and strict semantics', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.34).
  // Upstream lookups are skipped offline (--offline or PI_OFFLINE) with a deterministic
  // unknown (offline) status, and no network boundary is ever touched in offline mode.
  it('skips every upstream lookup offline and reports unknown (offline)', () => {
    const cache = mkCache();
    installNpm(cache, { name: 'hashline-pi', requested: '^0.1.1', resolved: '0.1.1' });
    checkoutGit(cache, ['github.com', 'user', 'repo'], { marker: { ref: 'main' } });
    const report = buildExtensionReport(input(cache, { offline: true }));
    expect(report.entries.map((entry) => entry.status)).toEqual(['unknown', 'unknown']);
    for (const entry of report.entries) expect(entry.statusDetail).toContain('offline');
    expect(report.warnings).toEqual([]);
  });

  it('keeps the frozen SHA-pin status offline without an upstream consult', () => {
    const cache = mkCache();
    checkoutGit(cache, ['github.com', 'user', 'pinned'], { detach: true });
    const report = buildExtensionReport(input(cache, { offline: true }));
    expect(report.entries[0]?.status).toBe('pinned');
  });
});

describe('deterministic output', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.34).
  // Identical cache state yields byte-identical reports: npm entries sorted by package name come
  // before git entries sorted by checkout path.
  it('orders npm entries by package name before git entries by checkout path, stably', () => {
    const cache = mkCache();
    installNpm(cache, { name: 'zeta-pkg', requested: '^1.0.0', resolved: '1.0.0' });
    installNpm(cache, { name: '@scope/pkg', requested: '^2.0.0', resolved: '2.0.0' });
    installNpm(cache, { name: 'alpha-pkg', requested: '^1.0.0', resolved: '1.0.0' });
    checkoutGit(cache, ['github.com', 'user', 'b-repo'], { marker: { ref: 'main' } });
    checkoutGit(cache, ['github.com', 'user', 'a-repo'], { marker: { ref: 'main' } });
    const options = { npmLatest: npmLatestMap({}), gitRemoteTip: gitTip({}) };
    const first = buildExtensionReport(input(cache, options));
    const second = buildExtensionReport(input(cache, options));
    expect(first).toEqual(second);
    expect(first.entries.map((entry) => entry.source)).toEqual([
      '@scope/pkg',
      'alpha-pkg',
      'zeta-pkg',
      'github.com/user/a-repo',
      'github.com/user/b-repo',
    ]);
  });
});
