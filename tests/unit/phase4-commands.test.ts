// Tests setup, sync, URI cache encoding, and profile creation command behavior.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  executeCreateProfileCommand,
  createCreateProfileCommand,
} from '../../src/cli/commands/CreateProfileCommand.js';
import { createSetupCommand, executeSetupCommand } from '../../src/cli/commands/SetupCommand.js';
import { createSyncCommand, executeSyncCommand } from '../../src/cli/commands/SyncCommand.js';
import {
  createProfileSourceCachePath,
  encodeProfileSourceUri,
  normalizeGitUri,
} from '../../src/profiles/ProfileCache.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'bridl-phase4-'));
  temporaryRoots.push(root);
  return root;
};

const writeSettings = (homeDirectory: string, content: string): void => {
  const settingsDirectory = join(homeDirectory, '.bridl');
  mkdirSync(settingsDirectory, { recursive: true });
  writeFileSync(join(settingsDirectory, 'settings.yml'), content);
};

const writeCachedProfile = (cachePath: string, profileId = 'remote'): void => {
  const profileDirectory = join(cachePath, profileId);
  mkdirSync(profileDirectory, { recursive: true });
  writeFileSync(join(profileDirectory, 'profile.yml'), `id: ${profileId}\ncontrols: {}\n`);
};

const createGitProfileRepository = (root: string): string => {
  const repositoryPath = join(root, 'remote-profiles');
  writeCachedProfile(repositoryPath, 'remote');
  execFileSync('git', ['init'], { cwd: repositoryPath, stdio: 'pipe' });
  execFileSync('git', ['add', '.'], { cwd: repositoryPath, stdio: 'pipe' });
  execFileSync(
    'git',
    ['-c', 'user.name=Bridl Test', '-c', 'user.email=bridl@example.test', 'commit', '-m', 'profiles'],
    {
      cwd: repositoryPath,
      stdio: 'pipe',
    },
  );
  return repositoryPath;
};

afterEach(() => {
  vi.restoreAllMocks();

  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('phase 4 setup and sync commands', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-002.4, BRIDL-REQ-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('creates initial user settings and a default user profile without overwriting existing files', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');

    const firstResult = executeSetupCommand({ homeDirectory, projectDirectory });
    const settingsPath = join(homeDirectory, '.bridl', 'settings.yml');
    const defaultProfilePath = join(homeDirectory, '.bridl', 'profiles', 'default', 'profile.yml');

    expect(firstResult.createdSettings).toBe(true);
    expect(firstResult.createdDefaultProfile).toBe(true);
    expect(readFileSync(settingsPath, 'utf8')).toBe(
      'default_profile: default\nprofile_sources:\n  - path: ./profiles\n',
    );
    expect(readFileSync(defaultProfilePath, 'utf8')).toBe('id: default\nlabel: Default\ncontrols: {}\n');
    expect(firstResult.messages).toContain('No URI profile sources configured; nothing to sync.');

    writeFileSync(defaultProfilePath, 'id: default\nlabel: Custom\n');
    const secondResult = executeSetupCommand({ homeDirectory, projectDirectory });

    expect(secondResult.createdSettings).toBe(false);
    expect(secondResult.createdDefaultProfile).toBe(false);
    expect(readFileSync(defaultProfilePath, 'utf8')).toBe('id: default\nlabel: Custom\n');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('validates discovered settings before setup and runs URI sync behavior', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const uri = 'ssh://git.example.test/team/profiles';
    writeSettings(homeDirectory, `default_profile: remote\nprofile_sources:\n  - uri: ${uri}\n`);

    const result = executeSetupCommand(
      { homeDirectory, projectDirectory },
      {
        synchronizer: {
          sync(source, cachePath) {
            expect(source.uri).toBe(uri);
            writeCachedProfile(cachePath);
            return 'unchanged';
          },
        },
      },
    );

    expect(result.createdSettings).toBe(false);
    expect(result.createdDefaultProfile).toBe(true);
    expect(result.syncResult.sources).toEqual([
      {
        uri,
        cachePath: createProfileSourceCachePath(homeDirectory, uri),
        status: 'unchanged',
        message: '1 profile validated.',
      },
    ]);

    const fallbackHomeDirectory = join(root, 'fallback-home');
    writeSettings(fallbackHomeDirectory, 'profile_sources: []\n');
    const fallbackDefaultResult = executeSetupCommand({ homeDirectory: fallbackHomeDirectory, projectDirectory });
    expect(fallbackDefaultResult.defaultProfilePath).toBe(
      join(fallbackHomeDirectory, '.bridl', 'profiles', 'default', 'profile.yml'),
    );

    const projectDefaultHomeDirectory = join(root, 'project-default-home');
    const projectDefaultDirectory = join(root, 'project-default');
    mkdirSync(join(projectDefaultDirectory, '.bridl'), { recursive: true });
    writeFileSync(join(projectDefaultDirectory, '.bridl', 'settings.yml'), 'default_profile: remote\n');
    const projectDefaultResult = executeSetupCommand({
      homeDirectory: projectDefaultHomeDirectory,
      projectDirectory: projectDefaultDirectory,
    });
    expect(readFileSync(projectDefaultResult.settingsPath, 'utf8')).toContain('default_profile: default');
    expect(projectDefaultResult.defaultProfilePath).toBe(
      join(projectDefaultHomeDirectory, '.bridl', 'profiles', 'default', 'profile.yml'),
    );

    const unsafeDefaultHomeDirectory = join(root, 'unsafe-default-home');
    writeSettings(unsafeDefaultHomeDirectory, 'default_profile: ../../outside\n');
    expect(() => executeSetupCommand({ homeDirectory: unsafeDefaultHomeDirectory, projectDirectory })).toThrow(
      'filesystem-safe',
    );
    expect(existsSync(join(root, 'outside', 'profile.yml'))).toBe(false);

    writeSettings(homeDirectory, 'profile_sources:\n  - only: [remote]\n');
    expect(() => executeSetupCommand({ homeDirectory, projectDirectory })).toThrow(
      'Cannot setup with invalid settings',
    );

    const invalidProjectHomeDirectory = join(root, 'invalid-project-home');
    const invalidProjectDirectory = join(root, 'invalid-project');
    mkdirSync(join(invalidProjectDirectory, '.bridl'), { recursive: true });
    writeFileSync(join(invalidProjectDirectory, '.bridl', 'settings.yml'), 'profile_sources:\n  - only: [remote]\n');
    expect(() =>
      executeSetupCommand({ homeDirectory: invalidProjectHomeDirectory, projectDirectory: invalidProjectDirectory }),
    ).toThrow('Cannot setup with invalid settings');
    expect(existsSync(join(invalidProjectHomeDirectory, '.bridl', 'settings.yml'))).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-004.2).
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
            syncedUris.push(source.uri);
            writeCachedProfile(cachePath);
            return source.uri === firstUri ? 'updated' : 'skipped';
          },
        },
      },
    );

    expect(encodeProfileSourceUri(firstUri)).toMatch(/^[A-Za-z0-9_-]+$/u);
    expect(createProfileSourceCachePath(homeDirectory, firstUri)).toBe(
      join(homeDirectory, '.bridl', 'cache', 'profiles', encodeProfileSourceUri(firstUri)),
    );
    expect(syncedUris).toEqual([firstUri, secondUri]);
    expect(result.sources.map((source) => source.status)).toEqual(['updated', 'skipped']);
    expect(result.messages[0]).toContain(`${firstUri} -> ${createProfileSourceCachePath(homeDirectory, firstUri)}`);
  });

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

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-004.2).
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
    const failedUri = `file://${join(root, 'missing-repository')}`;
    writeSettings(homeDirectory, `profile_sources:\n  - uri: ${failedUri}\n`);
    const failedResult = executeSyncCommand({ homeDirectory, projectDirectory });

    expect(firstResult.sources).toEqual([
      {
        uri,
        cachePath: createProfileSourceCachePath(homeDirectory, uri),
        status: 'updated',
        message: '1 profile validated.',
      },
    ]);
    expect(secondResult.sources[0]?.status).toBe('updated');
    expect(failedResult.sources[0]?.status).toBe('failed');
    expect(failedResult.sources[0]?.message).toContain('does not appear to be a git repository');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-004.2).
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
      'No URI profile sources configured; nothing to sync.',
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-004.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('creates placeholder profiles by scope or path and exposes create-profile as the same command alias', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const byScope = executeCreateProfileCommand({
      name: 'engineering',
      scope: 'user',
      homeDirectory,
      projectDirectory,
    });
    const byProject = executeCreateProfileCommand({
      name: 'project-profile',
      scope: 'project',
      homeDirectory,
      projectDirectory,
    });
    const byProjectLocal = executeCreateProfileCommand({
      name: 'local-profile',
      scope: 'project-local',
      homeDirectory,
      projectDirectory,
    });
    const customRoot = join(root, 'custom-profiles');
    const byPath = executeCreateProfileCommand({ name: 'research', path: customRoot, homeDirectory, projectDirectory });

    expect(readFileSync(byScope.profilePath, 'utf8')).toBe('id: engineering\nlabel: engineering\ncontrols: {}\n');
    expect(existsSync(join(byScope.profileDirectory, 'prompts'))).toBe(true);
    expect(existsSync(join(byScope.profileDirectory, 'skills'))).toBe(true);
    expect(existsSync(join(byScope.profileDirectory, 'extensions'))).toBe(true);
    expect(existsSync(join(byScope.profileDirectory, 'cli_specific', 'pi'))).toBe(true);
    expect(byProject.profileDirectory).toBe(join(projectDirectory, '.bridl', 'profiles', 'project-profile'));
    expect(byProjectLocal.profileDirectory).toBe(
      join(projectDirectory, '.bridl', 'local', 'profiles', 'local-profile'),
    );
    expect(byPath.profileDirectory).toBe(join(customRoot, 'research'));

    writeFileSync(byPath.profilePath, 'id: research\nlabel: Existing\n');
    expect(
      executeCreateProfileCommand({ name: 'research', path: customRoot, homeDirectory, projectDirectory })
        .createdProfile,
    ).toBe(false);

    const program = new Command();
    createCreateProfileCommand().register(program);
    expect(program.commands[0]?.aliases()).toEqual(['create-profile']);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-004.3, BRIDL-REQ-004.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects invalid create_profile inputs and wires command actions to the command object executors', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');

    expect(() =>
      executeCreateProfileCommand({ name: 'Bad Name', scope: 'user', homeDirectory, projectDirectory }),
    ).toThrow('filesystem-safe');
    expect(() => executeCreateProfileCommand({ name: 'valid', homeDirectory, projectDirectory })).toThrow(
      'requires exactly one destination',
    );
    expect(() =>
      executeCreateProfileCommand({ name: 'valid', scope: 'user', path: root, homeDirectory, projectDirectory }),
    ).toThrow('requires exactly one destination');

    const messages: string[] = [];
    const createProgram = new Command();
    createCreateProfileCommand({
      homeDirectory,
      projectDirectory,
      writeLine: (message) => messages.push(message),
    }).register(createProgram);
    await createProgram.parseAsync(['node', 'bridl', 'create-profile', 'valid', '--path', join(root, 'cli-profiles')]);
    expect(messages).toContainEqual(expect.stringContaining("Created profile 'valid'"));
    await createProgram.parseAsync(['node', 'bridl', 'create_profile', 'scoped', '--scope', 'user']);
    expect(existsSync(join(homeDirectory, '.bridl', 'profiles', 'scoped', 'profile.yml'))).toBe(true);
    await expect(
      createProgram.parseAsync(['node', 'bridl', 'create_profile', 'valid', '--scope', 'invalid']),
    ).rejects.toThrow("Unknown profile scope 'invalid'");

    const missingNameProgram = new Command();
    missingNameProgram.exitOverride();
    createCreateProfileCommand({ homeDirectory, projectDirectory }).register(missingNameProgram);
    await expect(missingNameProgram.parseAsync(['node', 'bridl', 'create_profile', '--scope', 'user'])).rejects.toThrow(
      "missing required argument 'name'",
    );

    const syncMessages: string[] = [];
    const syncProgram = new Command();
    writeSettings(homeDirectory, 'default_profile: default\n');
    createSyncCommand({ homeDirectory, projectDirectory, writeLine: (message) => syncMessages.push(message) }).register(
      syncProgram,
    );
    await syncProgram.parseAsync(['node', 'bridl', 'sync']);
    expect(syncMessages).toEqual(['No URI profile sources configured; nothing to sync.']);

    const setupMessages: string[] = [];
    const setupProgram = new Command();
    createSetupCommand({
      homeDirectory: join(root, 'setup-home'),
      projectDirectory,
      writeLine: (message) => setupMessages.push(message),
    }).register(setupProgram);
    await setupProgram.parseAsync(['node', 'bridl', 'setup']);
    expect(setupMessages[0]).toContain('Created user settings');
  });
});
