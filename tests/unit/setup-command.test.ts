// Tests setup command behavior.
import { PassThrough } from 'node:stream';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeSetupCommand } from '../../src/cli/commands/SetupCommand.js';
import { createProfileSourceCachePath, createRemoteRepositoryCachePath } from '../../src/profiles/ProfileCache.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'bridl-setup-command-'));
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

const defaultProfileSynchronizer = {
  sync(_source: unknown, cachePath: string) {
    writeCachedProfile(join(cachePath, 'profiles'), 'engineer');
    writeCachedProfile(join(cachePath, 'profiles'), 'data_analyst');
    return 'updated' as const;
  },
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('setup command', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-002.4, BRIDL-REQ-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('creates initial user settings and a default user profile without overwriting existing files', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');

    const firstResult = await executeSetupCommand(
      { homeDirectory, projectDirectory },
      { synchronizer: defaultProfileSynchronizer },
    );
    const settingsPath = join(homeDirectory, '.bridl', 'settings.yml');
    const defaultProfilePath = join(homeDirectory, '.bridl', 'profiles', 'engineer', 'profile.yml');

    expect(firstResult.createdSettings).toBe(true);
    expect(firstResult.createdDefaultProfile).toBe(true);
    expect(readFileSync(settingsPath, 'utf8')).toBe(
      [
        'default_profile: engineer',
        'profile_sources:',
        '  - path: ./profiles',
        '  - github: Unsupervisedcom/applepi-default-profiles',
        '    ref: main',
        '    path: profiles',
        '',
      ].join('\n'),
    );
    expect(readFileSync(defaultProfilePath, 'utf8')).toBe('id: engineer\nlabel: Default\ncontrols: {}\n');
    expect(firstResult.messages).toContain("Selected default profile 'engineer'.");
    expect(firstResult.syncResult.sources[0]?.message).toBe('2 profiles validated.');

    writeFileSync(defaultProfilePath, 'id: default\nlabel: Custom\n');
    const secondResult = await executeSetupCommand(
      { homeDirectory, projectDirectory },
      { synchronizer: defaultProfileSynchronizer },
    );

    expect(secondResult.createdSettings).toBe(false);
    expect(secondResult.createdDefaultProfile).toBe(false);
    expect(readFileSync(defaultProfilePath, 'utf8')).toBe('id: default\nlabel: Custom\n');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('uses a setup source repository as the initial user settings and profiles without overwriting files', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const setupSourceUri = 'https://user:secret@example.test/bridl-config';
    const sourceCachePath = join(root, 'starter-cache');
    mkdirSync(join(sourceCachePath, 'profiles', 'team'), { recursive: true });
    writeFileSync(
      join(sourceCachePath, 'settings.yml'),
      'default_profile: team\nprofile_sources:\n  - path: ./profiles\n',
    );
    writeFileSync(join(sourceCachePath, 'profiles', 'team', 'profile.yml'), 'id: team\nlabel: Team\ncontrols: {}\n');

    const result = await executeSetupCommand(
      { homeDirectory, projectDirectory, setupSourceUri },
      {
        setupSourceSynchronizer: {
          sync(uri, cachePath) {
            expect(uri).toBe(setupSourceUri);
            mkdirSync(cachePath, { recursive: true });
            writeFileSync(join(cachePath, 'settings.yml'), readFileSync(join(sourceCachePath, 'settings.yml'), 'utf8'));
            mkdirSync(join(cachePath, 'profiles', 'team'), { recursive: true });
            writeFileSync(
              join(cachePath, 'profiles', 'team', 'profile.yml'),
              readFileSync(join(sourceCachePath, 'profiles', 'team', 'profile.yml'), 'utf8'),
            );
          },
        },
      },
    );

    expect(result.createdSettings).toBe(true);
    expect(result.copiedStarterProfileFiles).toBe(1);
    expect(result.messages.join('\n')).not.toContain('secret');
    expect(result.createdDefaultProfile).toBe(false);
    expect(readFileSync(join(homeDirectory, '.bridl', 'settings.yml'), 'utf8')).toBe(
      'default_profile: team\nprofile_sources:\n  - path: ./profiles\n',
    );
    expect(readFileSync(join(homeDirectory, '.bridl', 'profiles', 'team', 'profile.yml'), 'utf8')).toBe(
      'id: team\nlabel: Team\ncontrols: {}\n',
    );

    writeFileSync(join(homeDirectory, '.bridl', 'settings.yml'), 'default_profile: custom\n');
    writeFileSync(join(homeDirectory, '.bridl', 'profiles', 'team', 'profile.yml'), 'id: team\nlabel: Custom\n');
    const secondResult = await executeSetupCommand(
      { homeDirectory, projectDirectory, setupSourceUri },
      {
        setupSourceSynchronizer: {
          sync(_uri, cachePath) {
            mkdirSync(cachePath, { recursive: true });
            writeFileSync(join(cachePath, 'settings.yml'), 'default_profile: team\n');
            mkdirSync(join(cachePath, 'profiles', 'team'), { recursive: true });
            writeFileSync(join(cachePath, 'profiles', 'team', 'profile.yml'), 'id: team\nlabel: Starter\n');
          },
        },
      },
    );

    expect(secondResult.createdSettings).toBe(false);
    expect(secondResult.copiedStarterProfileFiles).toBe(0);
    expect(readFileSync(join(homeDirectory, '.bridl', 'settings.yml'), 'utf8')).toBe('default_profile: custom\n');
    expect(readFileSync(join(homeDirectory, '.bridl', 'profiles', 'team', 'profile.yml'), 'utf8')).toBe(
      'id: team\nlabel: Custom\n',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('validates discovered settings before setup and runs URI sync behavior', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const uri = 'ssh://git.example.test/team/profiles';
    writeSettings(homeDirectory, `default_profile: remote\nprofile_sources:\n  - uri: ${uri}\n`);

    const result = await executeSetupCommand(
      { homeDirectory, projectDirectory },
      {
        synchronizer: {
          sync(source, cachePath) {
            if (source.uri === uri) {
              writeCachedProfile(cachePath);
              return 'unchanged';
            }

            expect(source.github).toBe('Unsupervisedcom/applepi-default-profiles');
            writeCachedProfile(join(cachePath, 'profiles'), 'engineer');
            writeCachedProfile(join(cachePath, 'profiles'), 'data_analyst');
            return 'updated';
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
      expect.objectContaining({
        uri: 'git+https://github.com/Unsupervisedcom/applepi-default-profiles.git#main:profiles',
        status: 'updated',
        message: '2 profiles validated.',
      }),
    ]);

    const fallbackHomeDirectory = join(root, 'fallback-home');
    writeSettings(fallbackHomeDirectory, 'profile_sources: []\n');
    const fallbackDefaultResult = await executeSetupCommand(
      { homeDirectory: fallbackHomeDirectory, projectDirectory },
      { synchronizer: defaultProfileSynchronizer },
    );
    expect(fallbackDefaultResult.defaultProfilePath).toBe(
      join(fallbackHomeDirectory, '.bridl', 'profiles', 'default', 'profile.yml'),
    );
    expect(readFileSync(join(fallbackHomeDirectory, '.bridl', 'settings.yml'), 'utf8')).toContain(
      'default_profile: default',
    );

    const projectDefaultHomeDirectory = join(root, 'project-default-home');
    const projectDefaultDirectory = join(root, 'project-default');
    mkdirSync(join(projectDefaultDirectory, '.bridl'), { recursive: true });
    writeFileSync(join(projectDefaultDirectory, '.bridl', 'settings.yml'), 'default_profile: remote\n');
    const projectDefaultResult = await executeSetupCommand(
      {
        homeDirectory: projectDefaultHomeDirectory,
        projectDirectory: projectDefaultDirectory,
      },
      { synchronizer: defaultProfileSynchronizer },
    );
    expect(readFileSync(projectDefaultResult.settingsPath, 'utf8')).toContain('default_profile: engineer');
    expect(projectDefaultResult.defaultProfilePath).toBe(
      join(projectDefaultHomeDirectory, '.bridl', 'profiles', 'engineer', 'profile.yml'),
    );

    const unsafeDefaultHomeDirectory = join(root, 'unsafe-default-home');
    writeSettings(unsafeDefaultHomeDirectory, 'default_profile: ../../outside\n');
    await expect(executeSetupCommand({ homeDirectory: unsafeDefaultHomeDirectory, projectDirectory })).rejects.toThrow(
      'filesystem-safe',
    );
    expect(existsSync(join(root, 'outside', 'profile.yml'))).toBe(false);

    writeSettings(homeDirectory, 'profile_sources:\n  - only: [remote]\n');
    await expect(executeSetupCommand({ homeDirectory, projectDirectory })).rejects.toThrow(
      'Cannot setup with invalid settings',
    );

    const invalidProjectHomeDirectory = join(root, 'invalid-project-home');
    const invalidProjectDirectory = join(root, 'invalid-project');
    mkdirSync(join(invalidProjectDirectory, '.bridl'), { recursive: true });
    writeFileSync(join(invalidProjectDirectory, '.bridl', 'settings.yml'), 'profile_sources:\n  - only: [remote]\n');
    await expect(
      executeSetupCommand({ homeDirectory: invalidProjectHomeDirectory, projectDirectory: invalidProjectDirectory }),
    ).rejects.toThrow('Cannot setup with invalid settings');
    expect(existsSync(join(invalidProjectHomeDirectory, '.bridl', 'settings.yml'))).toBe(false);
  });

  it('requires an interactive terminal and lets the setup wizard choose the default profile', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const messages: string[] = [];

    await expect(
      executeSetupCommand(
        { homeDirectory, projectDirectory },
        {
          interactive: true,
          input: { isTTY: false } as NodeJS.ReadableStream & { isTTY: false },
          output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
        },
      ),
    ).rejects.toThrow('requires an interactive TTY');
    await expect(
      executeSetupCommand(
        { homeDirectory, projectDirectory },
        {
          interactive: true,
          input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
          output: { isTTY: false } as NodeJS.WritableStream & { isTTY: false },
        },
      ),
    ).rejects.toThrow('requires an interactive TTY');

    const result = await executeSetupCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
        output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
        writeLine: (message) => messages.push(message),
        synchronizer: defaultProfileSynchronizer,
        selectDefaultProfile(profiles, currentDefault) {
          expect(currentDefault).toBe('engineer');
          expect(profiles.map((profile) => profile.id)).toEqual(['data_analyst', 'engineer']);
          return Promise.resolve('data_analyst');
        },
      },
    );

    expect(result.messages).toContain("Selected default profile 'data_analyst'.");
    expect(messages).toEqual([
      'Welcome to Bridl. Bridl is the easiest way to run Pi.',
      'Bridl manages full pi configurations for you, so you can use different profiles in different situations.',
    ]);
    expect(readFileSync(join(homeDirectory, '.bridl', 'settings.yml'), 'utf8')).toContain(
      'default_profile: data_analyst',
    );
  });

  it('loads wizard choices from legacy URI and repository subpath sources', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const legacyUri = 'https://example.test/legacy-profiles.git';
    const repositoryUri = 'https://example.test/repository-profiles.git';
    writeSettings(
      homeDirectory,
      [
        'default_profile: legacy',
        'profile_sources:',
        `  - uri: ${legacyUri}`,
        `  - uri: ${repositoryUri}`,
        '    ref: main',
        '    path: profiles',
        '',
      ].join('\n'),
    );

    const result = await executeSetupCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
        output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
        synchronizer: {
          sync(source, cachePath) {
            if (source.uri === legacyUri) {
              expect(cachePath).toBe(createProfileSourceCachePath(homeDirectory, legacyUri));
              writeCachedProfile(cachePath, 'legacy');
            } else {
              expect(cachePath).toBe(createRemoteRepositoryCachePath(homeDirectory, source));
              writeCachedProfile(join(cachePath, 'profiles'), 'repository');
            }

            return 'updated';
          },
        },
        selectDefaultProfile(profiles) {
          expect(profiles.map((profile) => profile.id)).toEqual(['legacy', 'repository']);
          return Promise.resolve('repository');
        },
      },
    );

    expect(result.messages).toContain("Selected default profile 'repository'.");
  });

  it('uses the readline setup prompt when no selector dependency is injected', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    const messages: string[] = [];
    writeSettings(homeDirectory, 'default_profile: solo\nprofile_sources: []\n');
    input.end('\n');

    const result = await executeSetupCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        input,
        output,
        writeLine: (message) => messages.push(message),
        synchronizer: defaultProfileSynchronizer,
      },
    );

    expect(result.messages).toContain("Selected default profile 'data_analyst'.");
    expect(messages[0]).toContain('Welcome to Bridl');
    expect(readFileSync(join(homeDirectory, '.bridl', 'settings.yml'), 'utf8')).toContain(
      'default_profile: data_analyst',
    );
  });

  it('rejects out-of-range readline setup prompt selections', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const profilesDirectory = join(homeDirectory, '.bridl', 'profiles');
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    writeSettings(homeDirectory, 'default_profile: labeled\nprofile_sources:\n  - path: ./profiles\n');
    writeCachedProfile(profilesDirectory, 'labeled');
    writeFileSync(join(profilesDirectory, 'labeled', 'profile.yml'), 'id: labeled\nlabel: Labeled\ncontrols: {}\n');
    input.end('9\n');

    await expect(
      executeSetupCommand(
        { homeDirectory, projectDirectory },
        {
          interactive: true,
          input,
          output,
          writeLine: () => undefined,
          synchronizer: defaultProfileSynchronizer,
        },
      ),
    ).rejects.toThrow('out of range');
  });
});
