// Tests Pi git extension materialization into the Outfitter cache.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import spawn from 'cross-spawn';
import { afterEach, describe, expect, it } from 'vitest';

import { createPiAdapter } from '../../src/agents/pi/PiAdapter.js';

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
