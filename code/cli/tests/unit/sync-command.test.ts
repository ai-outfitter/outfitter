// Tests sync command and profile source cache behavior.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { materializePiExtensionSources } from '../../src/agents/pi/PiExtensionCache.js';
import { executeSyncCommand } from '../../src/cli/commands/SyncCommand.js';
import {
  createProfileSourceCachePath,
  createRemoteRepositoryCachePath,
  encodeProfileSourceUri,
  normalizeGitUri,
} from '../../src/profiles/ProfileCache.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-sync-command-'));
  temporaryRoots.push(root);
  return root;
};

const writeSettings = (homeDirectory: string, content: string): void => {
  const settingsDirectory = join(homeDirectory, '.outfitter');
  mkdirSync(settingsDirectory, { recursive: true });
  writeFileSync(join(settingsDirectory, 'settings.yml'), content);
};

const writeCachedProfile = (cachePath: string, profileId = 'remote'): void => {
  const profileDirectory = join(cachePath, profileId);
  mkdirSync(profileDirectory, { recursive: true });
  writeFileSync(join(profileDirectory, 'profile.yml'), `id: ${profileId}\ncontrols: {}\n`);
};

const createGitProfileRepository = (root: string, repositoryName = 'remote-profiles'): string => {
  const repositoryPath = join(root, repositoryName);
  writeCachedProfile(repositoryPath, 'remote');
  execFileSync('git', ['init', '--initial-branch', 'main'], { cwd: repositoryPath, stdio: 'pipe' });
  execFileSync('git', ['add', '.'], { cwd: repositoryPath, stdio: 'pipe' });
  execFileSync(
    'git',
    ['-c', 'user.name=Outfitter Test', '-c', 'user.email=outfitter@example.test', 'commit', '-m', 'profiles'],
    { cwd: repositoryPath, stdio: 'pipe' },
  );
  return repositoryPath;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('sync command', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('encodes URI cache paths for arbitrary URIs and validates synced profiles', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const firstUri = 'git+https://example.test/team/profiles.git?ref=v1';
    const secondUri = 'file:///tmp/non-github profiles';
    writeSettings(
      homeDirectory,
      `profile_sources:\n  - uri: ${firstUri}\n  - uri: ${secondUri}\n    only: [remote]\n  - path: ./profiles\n`,
    );

    const syncedUris: string[] = [];
    const result = executeSyncCommand(
      { homeDirectory, projectDirectory },
      {
        synchronizer: {
          sync(source, cachePath) {
            syncedUris.push(source.uri!);
            writeCachedProfile(cachePath);
            return source.uri === firstUri ? 'updated' : 'skipped';
          },
        },
      },
    );

    expect(encodeProfileSourceUri(firstUri)).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(createProfileSourceCachePath(homeDirectory, firstUri)).toBe(
      join(homeDirectory, '.outfitter', 'cache', 'profiles', encodeProfileSourceUri(firstUri)),
    );
    expect(syncedUris).toEqual([firstUri, secondUri]);
    expect(result.sources.map((source) => source.status)).toEqual(['updated', 'skipped']);
    expect(result.messages[0]).toContain(`${firstUri} -> ${createProfileSourceCachePath(homeDirectory, firstUri)}`);
  });

  it('skips confirmed private GitHub catalogs unless the home enterprise setting is enabled', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(
      homeDirectory,
      `profile_sources:\n  - github: company/private-profiles\n  - github: company/public-profiles\n  - github: company/unknown-profiles\n`,
    );

    const result = executeSyncCommand(
      { homeDirectory, projectDirectory },
      {
        privateCatalogPrompt: { interactive: false, confirm: () => false },
        repositoryVisibilityClassifier: {
          classify(repository) {
            if (repository === 'company/private-profiles') {
              return 'private';
            }

            if (repository === 'company/public-profiles') {
              return 'public';
            }

            return 'unknown';
          },
        },
        synchronizer: {
          sync(_source, cachePath) {
            writeCachedProfile(cachePath);
            return 'updated';
          },
        },
      },
    );

    expect(result.messages[0]).toBe(
      'info: Private GitHub profile catalog detected: company/private-profiles. Enable enterprise.private_profile_catalogs in ~/.outfitter/settings.yml after reviewing code/enterprise/LICENSE or your enterprise agreement.',
    );
    expect(result.messages.join('\n')).not.toContain('warning:');
    expect(result.messages.join('\n')).not.toContain('error:');
    expect(result.messages.join('\n')).not.toContain(
      'company/public-profiles. Enable enterprise.private_profile_catalogs',
    );
    expect(result.messages.join('\n')).not.toContain(
      'company/unknown-profiles. Enable enterprise.private_profile_catalogs',
    );
    expect(result.sources.map((source) => source.status)).toEqual(['updated', 'updated', 'skipped']);
  });

  it('deduplicates private catalog skip info while preserving per-source skip results', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(
      homeDirectory,
      [
        'remote_settings:',
        '  - github: company/private-profiles',
        '    path: settings.yml',
        'profile_sources:',
        '  - github: company/private-profiles',
        '  - github: company/private-profiles',
        '',
      ].join('\n'),
    );

    const result = executeSyncCommand(
      { homeDirectory, projectDirectory },
      {
        privateCatalogPrompt: { interactive: false, confirm: () => false },
        repositoryVisibilityClassifier: { classify: () => 'private' },
      },
    );

    expect(
      result.messages.filter((message) => message.startsWith('info: Private GitHub profile catalog detected')),
    ).toHaveLength(1);
    expect(result.sources.map((source) => source.status)).toEqual(['skipped', 'skipped', 'skipped']);
  });

  it('writes the home enterprise setting after interactive private catalog consent', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(homeDirectory, 'profile_sources:\n  - github: company/private-profiles\n');

    const result = executeSyncCommand(
      { homeDirectory, projectDirectory },
      {
        privateCatalogPrompt: { interactive: true, confirm: () => true },
        repositoryVisibilityClassifier: { classify: () => 'private' },
        synchronizer: {
          sync(_source, cachePath) {
            writeCachedProfile(cachePath);
            return 'updated';
          },
        },
      },
    );

    expect(result.messages[0]).toBe('info: Enabled private profile catalogs in ~/.outfitter/settings.yml.');
    expect(readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8')).toContain(
      'private_profile_catalogs: true',
    );
    expect(result.sources.map((source) => source.status)).toEqual(['updated']);
  });

  it('does not prompt or show enterprise info when the home enterprise setting is already enabled', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(
      homeDirectory,
      'enterprise:\n  private_profile_catalogs: true\nprofile_sources:\n  - github: company/private-profiles\n',
    );
    let promptCount = 0;

    const result = executeSyncCommand(
      { homeDirectory, projectDirectory },
      {
        privateCatalogPrompt: {
          interactive: true,
          confirm: () => {
            promptCount += 1;
            return false;
          },
        },
        repositoryVisibilityClassifier: { classify: () => 'private' },
        synchronizer: {
          sync(_source, cachePath) {
            writeCachedProfile(cachePath);
            return 'updated';
          },
        },
      },
    );

    expect(promptCount).toBe(0);
    expect(result.messages.join('\n')).not.toContain('Private GitHub profile catalog detected');
    expect(result.sources.map((source) => source.status)).toEqual(['updated']);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('redacts URI credentials from sync results and messages', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const uri = 'git+https://user:secret@example.test/team/profiles.git';
    const failedUri = 'https://token@example.test/private/profiles.git';
    const unparsableUri = '//deploy-key@example.test/private/profiles.git';
    writeSettings(
      homeDirectory,
      `profile_sources:\n  - uri: ${uri}\n  - uri: ${failedUri}\n  - uri: '${unparsableUri}'\n`,
    );

    const result = executeSyncCommand(
      { homeDirectory, projectDirectory },
      {
        synchronizer: {
          sync(source, cachePath) {
            if (source.uri === failedUri || source.uri === unparsableUri) {
              throw new Error(`Could not fetch ${source.uri}`);
            }

            writeCachedProfile(cachePath);
            return 'updated';
          },
        },
      },
    );

    expect(result.sources[0]?.uri).toBe('git+https://REDACTED@example.test/team/profiles.git');
    expect(result.sources[1]?.uri).toBe('https://REDACTED@example.test/private/profiles.git');
    expect(result.sources[2]?.uri).toBe('//REDACTED@example.test/private/profiles.git');
    expect(result.messages[0]).toContain('git+https://REDACTED@example.test/team/profiles.git');
    expect(result.messages[1]).toContain('Could not fetch https://REDACTED@example.test/private/profiles.git');
    expect(result.messages[2]).toContain('Could not fetch //REDACTED@example.test/private/profiles.git');
    expect(result.messages.join('\n')).not.toContain('secret');
    expect(result.messages.join('\n')).not.toContain('token');
    expect(result.messages.join('\n')).not.toContain('deploy-key');
    expect(result.sources[0]?.cachePath).toBe(createProfileSourceCachePath(homeDirectory, uri));
    expect(Buffer.from(encodeProfileSourceUri(uri), 'base64url').toString('utf8')).not.toContain('secret');
    expect(Buffer.from(encodeProfileSourceUri(normalizeGitUri(uri)), 'base64url').toString('utf8')).not.toContain(
      'secret',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('fetches URI profile sources with the default git synchronizer and updates existing caches', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const repositoryPath = createGitProfileRepository(root);
    const uri = `git+file://${repositoryPath}`;
    writeSettings(homeDirectory, `profile_sources:\n  - uri: ${uri}\n`);

    const firstResult = executeSyncCommand({ homeDirectory, projectDirectory });
    const secondResult = executeSyncCommand({ homeDirectory, projectDirectory });
    writeSettings(homeDirectory, `profile_sources:\n  - uri: ${uri}\n    ref: main\n    path: .\n`);
    const refResult = executeSyncCommand({ homeDirectory, projectDirectory });
    writeFileSync(join(repositoryPath, 'remote', 'profile.yml'), 'id: remote\nlabel: Updated\ncontrols: {}\n');
    execFileSync('git', ['add', '.'], { cwd: repositoryPath, stdio: 'pipe' });
    execFileSync(
      'git',
      ['-c', 'user.name=Outfitter Test', '-c', 'user.email=outfitter@example.test', 'commit', '-m', 'update profiles'],
      { cwd: repositoryPath, stdio: 'pipe' },
    );
    const secondRefResult = executeSyncCommand({ homeDirectory, projectDirectory });
    const commitRef = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repositoryPath, encoding: 'utf8' }).trim();
    writeSettings(homeDirectory, `profile_sources:\n  - uri: ${uri}\n    ref: ${commitRef}\n    path: .\n`);
    const commitRefResult = executeSyncCommand({ homeDirectory, projectDirectory });
    const failedUri = `file://${join(root, 'missing-repository')}`;
    writeSettings(homeDirectory, `profile_sources:\n  - uri: ${failedUri}\n`);
    const failedResult = executeSyncCommand({ homeDirectory, projectDirectory });
    writeSettings(homeDirectory, `profile_sources:\n  - uri: ${uri}\n    ref: --bad\n    path: .\n`);
    const unsafeRefResult = executeSyncCommand({ homeDirectory, projectDirectory });

    expect(firstResult.sources).toEqual([
      {
        uri,
        cachePath: createProfileSourceCachePath(homeDirectory, uri),
        status: 'updated',
        message: '1 profile validated.',
      },
    ]);
    expect(secondResult.sources[0]?.status).toBe('updated');
    expect(refResult.sources[0]?.message).toBe('1 profile validated.');
    expect(commitRefResult.sources[0]?.message).toBe('1 profile validated.');
    expect(secondRefResult.sources[0]?.message).toBe('1 profile validated.');
    expect(
      readFileSync(
        join(createRemoteRepositoryCachePath(homeDirectory, { uri, ref: 'main' }), 'remote', 'profile.yml'),
        'utf8',
      ),
    ).toContain('label: Updated');
    expect(failedResult.sources[0]?.status).toBe('failed');
    expect(failedResult.sources[0]?.message).toContain('does not appear to be a git repository');
    expect(unsafeRefResult.sources[0]?.status).toBe('failed');
    expect(unsafeRefResult.sources[0]?.message).toContain("must not start with '-'");
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports sync validation failures, synchronizer failures, invalid settings, and no-op syncs clearly', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const invalidProfileUri = 'https://example.test/invalid.git';
    const failedUri = 'https://example.test/fail.git';
    const stringFailureUri = 'https://example.test/string-fail.git';
    const emptyUri = 'https://example.test/empty.git';
    writeSettings(
      homeDirectory,
      `profile_sources:\n  - uri: ${invalidProfileUri}\n  - uri: ${failedUri}\n  - uri: ${stringFailureUri}\n  - uri: ${emptyUri}\n`,
    );

    const result = executeSyncCommand(
      { homeDirectory, projectDirectory },
      {
        synchronizer: {
          sync(source, cachePath) {
            if (source.uri === failedUri) {
              throw new Error('network unavailable');
            }

            if (source.uri === stringFailureUri) {
              // eslint-disable-next-line @typescript-eslint/only-throw-error -- covers defensive formatting for non-Error throw values from injected dependencies.
              throw 'string failure';
            }

            if (source.uri === emptyUri) {
              mkdirSync(cachePath, { recursive: true });
              return 'unchanged';
            }

            const profileDirectory = join(cachePath, 'broken');
            mkdirSync(profileDirectory, { recursive: true });
            writeFileSync(join(profileDirectory, 'profile.yml'), 'controls:\n  environment:\n    COUNT: 1\n');
            return 'updated';
          },
        },
      },
    );

    expect(result.sources.map((source) => source.status)).toEqual(['failed', 'failed', 'failed', 'unchanged']);
    expect(result.sources[0]?.message).toContain('failed profile validation');
    expect(result.sources[1]?.message).toBe('network unavailable');
    expect(result.sources[2]?.message).toBe('string failure');
    expect(result.sources[3]?.message).toBe('0 profiles validated.');

    writeSettings(homeDirectory, 'profile_sources:\n  - only: [missing-source]\n');
    expect(() => executeSyncCommand({ homeDirectory, projectDirectory })).toThrow('Cannot sync with invalid settings');

    writeSettings(homeDirectory, 'default_profile: default\n');
    expect(executeSyncCommand({ homeDirectory, projectDirectory }).messages).toEqual([
      'No URI profile or remote settings sources configured; nothing to sync.',
    ]);
  });

  it('creates shallow single-branch catalog caches and reports per-source progress', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const repositoryPath = createGitProfileRepository(root);
    const uri = `git+file://${repositoryPath}`;
    writeSettings(homeDirectory, `profile_sources:\n  - uri: ${uri}\n`);
    const progressLines: string[] = [];
    const writeLine = (message: string): void => {
      progressLines.push(message);
    };

    const firstResult = executeSyncCommand({ homeDirectory, projectDirectory }, { writeLine });
    const cachePath = createProfileSourceCachePath(homeDirectory, uri);

    expect(firstResult.sources[0]?.status).toBe('updated');
    expect(existsSync(join(cachePath, '.git', 'shallow'))).toBe(true);
    expect(progressLines.some((line) => line.startsWith('outfitter: cloning catalog '))).toBe(true);

    progressLines.length = 0;
    const secondResult = executeSyncCommand({ homeDirectory, projectDirectory }, { writeLine });

    expect(secondResult.sources[0]?.status).toBe('updated');
    expect(progressLines.some((line) => line.startsWith('outfitter: updating catalog '))).toBe(true);

    execFileSync('git', ['checkout', '-b', 'feature'], { cwd: repositoryPath, stdio: 'pipe' });
    writeFileSync(join(repositoryPath, 'remote', 'profile.yml'), 'id: remote\nlabel: Feature\ncontrols: {}\n');
    execFileSync('git', ['add', '.'], { cwd: repositoryPath, stdio: 'pipe' });
    execFileSync(
      'git',
      ['-c', 'user.name=Outfitter Test', '-c', 'user.email=outfitter@example.test', 'commit', '-m', 'feature'],
      { cwd: repositoryPath, stdio: 'pipe' },
    );
    writeSettings(homeDirectory, `profile_sources:\n  - uri: ${uri}\n    ref: feature\n    path: .\n`);

    const branchRefResult = executeSyncCommand({ homeDirectory, projectDirectory }, { writeLine });
    const branchCachePath = createRemoteRepositoryCachePath(homeDirectory, { uri, ref: 'feature' });

    expect(branchRefResult.sources[0]?.status).toBe('updated');
    expect(existsSync(join(branchCachePath, '.git', 'shallow'))).toBe(true);
    expect(readFileSync(join(branchCachePath, 'remote', 'profile.yml'), 'utf8')).toContain('label: Feature');
  });

  it('refreshes branch-tracking pi extension caches during sync and reports the outcome', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const extensionRepository = createGitProfileRepository(root, 'extension-source');
    const cacheDirectory = join(homeDirectory, '.outfitter', 'cache');
    writeSettings(homeDirectory, 'default_profile: default\n');
    materializePiExtensionSources([`git+file://${extensionRepository}`], { cacheDirectory });

    writeFileSync(join(extensionRepository, 'extension.txt'), 'updated extension\n');
    execFileSync('git', ['add', '.'], { cwd: extensionRepository, stdio: 'pipe' });
    execFileSync(
      'git',
      ['-c', 'user.name=Outfitter Test', '-c', 'user.email=outfitter@example.test', 'commit', '-m', 'update'],
      { cwd: extensionRepository, stdio: 'pipe' },
    );

    const progressLines: string[] = [];
    const result = executeSyncCommand(
      { homeDirectory, projectDirectory },
      {
        writeLine: (message) => {
          progressLines.push(message);
        },
      },
    );

    expect(result.messages.some((message) => message.startsWith('refreshed: pi extension '))).toBe(true);
    expect(progressLines.some((line) => line.startsWith('outfitter: refreshing extension '))).toBe(true);
  });
});
