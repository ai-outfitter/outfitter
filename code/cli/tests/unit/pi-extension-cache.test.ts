// Tests Pi git extension materialization into the Outfitter cache.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import spawn from 'cross-spawn';
import { afterEach, describe, expect, it } from 'vitest';

import { createPiAdapter } from '../../src/agents/pi/PiAdapter.js';
import { materializePiExtensionSources, refreshPiExtensionCaches } from '../../src/agents/pi/PiExtensionCache.js';

const temporaryPiExtensionCacheTestRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryPiExtensionCacheTestRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('pi extension cache', () => {
  it('leaves non-git extensions unchanged', () => {
    const adapter = createPiAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      { id: 'engineering', inherits: [], controls: {} },
      { rootDirectory: createTemporaryRoot(), profilePaths: [] },
    );

    const launchPlan = adapter.createLaunchPlan(
      compositeProfilePlan.compositeProfile,
      { id: 'engineering', inherits: [], controls: { pi: { extensions: ['npm:pi-subagents', './local.ts'] } } },
      [],
      { cacheDirectory: join(createTemporaryRoot(), 'cache') },
    );

    expect(launchPlan.args).toContain('npm:pi-subagents');
    expect(launchPlan.args).toContain('./local.ts');
  });

  it('materializes git extensions into the Outfitter cache before launching pi', () => {
    const root = createTemporaryRoot();
    const remoteRepository = createLocalGitExtensionRepository(root);
    const cacheDirectory = join(root, 'cache');
    const adapter = createPiAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      { id: 'engineering', inherits: [], controls: {} },
      { rootDirectory: join(root, 'composite'), profilePaths: [] },
    );
    const source = `git+file://${remoteRepository}#main`;

    const launchPlan = adapter.createLaunchPlan(
      compositeProfilePlan.compositeProfile,
      { id: 'engineering', inherits: [], controls: { pi: { extensions: [source] } } },
      [],
      { cacheDirectory },
    );

    const extensionPath = launchPlan.args[launchPlan.args.indexOf('--extension') + 1];
    expect(extensionPath).toContain(join(cacheDirectory, 'extensions', 'git'));
    expect(extensionPath).not.toBe(source);
    if (extensionPath === undefined) {
      throw new Error('Expected launch plan to include a materialized extension path.');
    }
    expect(existsSync(join(extensionPath, 'index.ts'))).toBe(true);
  });

  it('reuses an existing cached git extension without recloning', () => {
    const root = createTemporaryRoot();
    const remoteRepository = createLocalGitExtensionRepository(root);
    const cacheDirectory = join(root, 'cache');
    const source = `git+file://${remoteRepository}`;

    const firstPath = materializedExtensionPath(source, cacheDirectory);
    rmSync(remoteRepository, { recursive: true, force: true });
    const secondPath = materializedExtensionPath(source, cacheDirectory);

    expect(secondPath).toBe(firstPath);
    expect(existsSync(join(secondPath, 'index.ts'))).toBe(true);
  });

  it('supports git-prefixed file URLs and installs package dependencies', () => {
    const root = createTemporaryRoot();
    const remoteRepository = createLocalGitExtensionRepository(root, { packageJson: true });
    const extensionPath = materializedExtensionPath(`git:file://${remoteRepository}`, join(root, 'cache'));

    expect(existsSync(join(extensionPath, 'package-lock.json'))).toBe(true);
  });

  it('removes partial cache entries when dependency installation fails', () => {
    const root = createTemporaryRoot();
    const remoteRepository = createLocalGitExtensionRepository(root, { packageJson: 'invalid' });
    const cacheRoot = join(root, 'cache');

    expect(() => materializedExtensionPath(`git+file://${remoteRepository}#main`, cacheRoot)).toThrow();
    expect(listCachedExtensions(cacheRoot)).toEqual([]);
  });

  it('reports per-extension progress while materializing git extensions', () => {
    const root = createTemporaryRoot();
    const remoteRepository = createLocalGitExtensionRepository(root, { packageJson: true });
    const source = `git+file://${remoteRepository}`;
    const progressLines: string[] = [];

    materializePiExtensionSources([source], {
      cacheDirectory: join(root, 'cache'),
      onProgress: (message) => {
        progressLines.push(message);
      },
    });

    expect(progressLines).toEqual([
      `outfitter: caching extension ${source}…`,
      `outfitter: installing dependencies for extension ${source}…`,
    ]);
  });
});

describe('pi extension cache refresh', () => {
  it('refreshes branch-tracking caches and leaves ref-pinned caches immutable', () => {
    const root = createTemporaryRoot();
    const remoteRepository = createLocalGitExtensionRepository(root);
    const cacheDirectory = join(root, 'cache');
    const branchSource = `git+file://${remoteRepository}`;
    const pinnedSource = `git+file://${remoteRepository}#main`;
    const [branchPath] = materializePiExtensionSources([branchSource], { cacheDirectory }) ?? [];
    const [pinnedPath] = materializePiExtensionSources([pinnedSource], { cacheDirectory }) ?? [];

    const unchangedResults = refreshPiExtensionCaches(cacheDirectory);

    expect(unchangedResults.find((result) => result.cachePath === branchPath)?.status).toBe('unchanged');

    writeFileSync(join(remoteRepository, 'index.ts'), 'export default function updated() {}\n');
    runGit(['add', 'index.ts'], remoteRepository);
    runGit(
      ['-c', 'user.email=test@example.test', '-c', 'user.name=Test User', 'commit', '-m', 'update'],
      remoteRepository,
    );

    const progressLines: string[] = [];
    const refreshedResults = refreshPiExtensionCaches(cacheDirectory, {
      onProgress: (message) => {
        progressLines.push(message);
      },
    });
    const branchResult = refreshedResults.find((result) => result.cachePath === branchPath);
    const pinnedResult = refreshedResults.find((result) => result.cachePath === pinnedPath);

    expect(branchResult?.status).toBe('refreshed');
    expect(readFileSync(join(branchPath ?? '', 'index.ts'), 'utf8')).toContain('updated');
    expect(pinnedResult?.status).toBe('pinned');
    expect(readFileSync(join(pinnedPath ?? '', 'index.ts'), 'utf8')).not.toContain('updated');
    expect(progressLines.some((line) => line.startsWith('outfitter: refreshing extension '))).toBe(true);
  });

  it('reports refresh failures without discarding caches and skips unknown entries', () => {
    const root = createTemporaryRoot();
    const remoteRepository = createLocalGitExtensionRepository(root);
    const cacheDirectory = join(root, 'cache');
    const source = `git+file://${remoteRepository}`;
    const [cachePath] = materializePiExtensionSources([source], { cacheDirectory }) ?? [];
    rmSync(remoteRepository, { recursive: true, force: true });

    const gitCacheRoot = join(cacheDirectory, 'extensions', 'git');
    mkdirSync(join(gitCacheRoot, 'legacy-cache-without-metadata'), { recursive: true });
    writeFileSync(join(gitCacheRoot, 'broken.source.json'), 'not json\n');
    writeFileSync(join(gitCacheRoot, 'array.source.json'), '[]\n');
    writeFileSync(join(gitCacheRoot, 'missing-source-field.source.json'), '{"ref":"main"}\n');
    writeFileSync(join(gitCacheRoot, 'ghost.source.json'), '{"source":"git+file:///removed"}\n');
    mkdirSync(join(gitCacheRoot, 'not-a-git-repo'), { recursive: true });
    writeFileSync(join(gitCacheRoot, 'not-a-git-repo.source.json'), '{"source":"git+file:///not-a-repo"}\n');

    const results = refreshPiExtensionCaches(cacheDirectory);

    expect(results.map((result) => result.status).sort()).toEqual(['failed', 'failed']);
    expect(results.find((result) => result.cachePath === cachePath)?.status).toBe('failed');
    expect(existsSync(join(cachePath ?? '', 'index.ts'))).toBe(true);
    expect(refreshPiExtensionCaches(join(root, 'missing-cache-directory'))).toEqual([]);
  });

  it('reports dependency install failures after a refreshed cache tip moves', () => {
    const root = createTemporaryRoot();
    const remoteRepository = createLocalGitExtensionRepository(root);
    const cacheDirectory = join(root, 'cache');
    const source = `git+file://${remoteRepository}`;
    const [cachePath] = materializePiExtensionSources([source], { cacheDirectory }) ?? [];

    writeFileSync(join(remoteRepository, 'package.json'), '{invalid json}\n');
    runGit(['add', 'package.json'], remoteRepository);
    runGit(
      ['-c', 'user.email=test@example.test', '-c', 'user.name=Test User', 'commit', '-m', 'break package json'],
      remoteRepository,
    );

    const results = refreshPiExtensionCaches(cacheDirectory);

    expect(results.find((result) => result.cachePath === cachePath)?.status).toBe('failed');
  });
});

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-pi-extension-cache-'));
  temporaryPiExtensionCacheTestRoots.push(root);
  return root;
};

const materializedExtensionPath = (source: string, cacheDirectory: string): string => {
  const adapter = createPiAdapter();
  const compositeProfilePlan = adapter.createCompositeProfile(
    { id: 'engineering', inherits: [], controls: {} },
    { rootDirectory: createTemporaryRoot(), profilePaths: [] },
  );
  const launchPlan = adapter.createLaunchPlan(
    compositeProfilePlan.compositeProfile,
    { id: 'engineering', inherits: [], controls: { pi: { extensions: [source] } } },
    [],
    { cacheDirectory },
  );
  const extensionPath = launchPlan.args[launchPlan.args.indexOf('--extension') + 1];

  if (extensionPath === undefined) {
    throw new Error('Expected launch plan to include a materialized extension path.');
  }

  return extensionPath;
};

const createLocalGitExtensionRepository = (
  root: string,
  options: { readonly packageJson?: true | 'invalid' } = {},
): string => {
  const repository = join(root, 'extension-source');
  mkdirSync(repository, { recursive: true });
  runGit(['init', '--initial-branch=main'], repository);
  writeFileSync(join(repository, 'index.ts'), 'export default function () {}\n');
  if (options.packageJson === true) {
    writeFileSync(join(repository, 'package.json'), '{"name":"test-pi-extension","private":true}\n');
    writeFileSync(
      join(repository, 'package-lock.json'),
      '{"name":"test-pi-extension","lockfileVersion":3,"requires":true,"packages":{"":{"name":"test-pi-extension"}}}\n',
    );
  } else if (options.packageJson === 'invalid') {
    writeFileSync(join(repository, 'package.json'), '{invalid json}\n');
  }
  runGit(['add', 'index.ts'], repository);
  if (options.packageJson === true) {
    runGit(['add', 'package.json', 'package-lock.json'], repository);
  } else if (options.packageJson === 'invalid') {
    runGit(['add', 'package.json'], repository);
  }
  runGit(['-c', 'user.email=test@example.test', '-c', 'user.name=Test User', 'commit', '-m', 'initial'], repository);

  return repository;
};

const listCachedExtensions = (cacheRoot: string): readonly string[] => {
  const extensionCache = join(cacheRoot, 'extensions', 'git');

  return existsSync(extensionCache) ? readdirSync(extensionCache) : [];
};

const runGit = (args: readonly string[], cwd: string): void => {
  const result = spawn.sync('git', args, { cwd, stdio: 'pipe', encoding: 'utf8' });

  if (result.status !== 0) {
    throw new Error((result.stderr || result.stdout || `git ${args.join(' ')} failed`).trim());
  }
};
