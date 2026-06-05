// Tests setup command behavior.
import { PassThrough } from 'node:stream';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeSetupCommand, updateSettingsDefaultProfile } from '../../src/cli/commands/SetupCommand.js';
import { createProfileSourceCachePath, createRemoteRepositoryCachePath } from '../../src/profiles/ProfileCache.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'applepi-setup-command-'));
  temporaryRoots.push(root);
  return root;
};

const writeSettings = (homeDirectory: string, content: string): void => {
  const settingsDirectory = join(homeDirectory, '.applepi');
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
  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-002.4, APPLEPI-REQ-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('creates initial user settings and a default user profile without overwriting existing files', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');

    const firstResult = await executeSetupCommand(
      { homeDirectory, projectDirectory },
      { synchronizer: defaultProfileSynchronizer },
    );
    const settingsPath = join(homeDirectory, '.applepi', 'settings.yml');
    const defaultProfilePath = join(homeDirectory, '.applepi', 'profiles', 'engineer', 'profile.yml');

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

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('uses a setup source repository as the initial user settings and profiles without overwriting files', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const setupSourceUri = 'https://user:secret@example.test/applepi-config';
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
    expect(readFileSync(join(homeDirectory, '.applepi', 'settings.yml'), 'utf8')).toBe(
      'default_profile: team\nprofile_sources:\n  - path: ./profiles\n',
    );
    expect(readFileSync(join(homeDirectory, '.applepi', 'profiles', 'team', 'profile.yml'), 'utf8')).toBe(
      'id: team\nlabel: Team\ncontrols: {}\n',
    );

    writeFileSync(join(homeDirectory, '.applepi', 'settings.yml'), 'default_profile: custom\n');
    writeFileSync(join(homeDirectory, '.applepi', 'profiles', 'team', 'profile.yml'), 'id: team\nlabel: Custom\n');
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
    expect(readFileSync(join(homeDirectory, '.applepi', 'settings.yml'), 'utf8')).toBe('default_profile: custom\n');
    expect(readFileSync(join(homeDirectory, '.applepi', 'profiles', 'team', 'profile.yml'), 'utf8')).toBe(
      'id: team\nlabel: Custom\n',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-004.1).
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
    const fallbackDefaultResult = await executeSetupCommand({ homeDirectory: fallbackHomeDirectory, projectDirectory });
    expect(fallbackDefaultResult.defaultProfilePath).toBe(
      join(fallbackHomeDirectory, '.applepi', 'profiles', 'engineer', 'profile.yml'),
    );
    expect(readFileSync(join(fallbackHomeDirectory, '.applepi', 'settings.yml'), 'utf8')).toContain(
      'default_profile: engineer',
    );

    const projectDefaultHomeDirectory = join(root, 'project-default-home');
    const projectDefaultDirectory = join(root, 'project-default');
    mkdirSync(join(projectDefaultDirectory, '.applepi'), { recursive: true });
    writeFileSync(join(projectDefaultDirectory, '.applepi', 'settings.yml'), 'default_profile: remote\n');
    const projectDefaultResult = await executeSetupCommand(
      {
        homeDirectory: projectDefaultHomeDirectory,
        projectDirectory: projectDefaultDirectory,
      },
      { synchronizer: defaultProfileSynchronizer },
    );
    expect(readFileSync(projectDefaultResult.settingsPath, 'utf8')).toContain('default_profile: engineer');
    expect(projectDefaultResult.defaultProfilePath).toBe(
      join(projectDefaultHomeDirectory, '.applepi', 'profiles', 'engineer', 'profile.yml'),
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
    mkdirSync(join(invalidProjectDirectory, '.applepi'), { recursive: true });
    writeFileSync(join(invalidProjectDirectory, '.applepi', 'settings.yml'), 'profile_sources:\n  - only: [remote]\n');
    await expect(
      executeSetupCommand({ homeDirectory: invalidProjectHomeDirectory, projectDirectory: invalidProjectDirectory }),
    ).rejects.toThrow('Cannot setup with invalid settings');
    expect(existsSync(join(invalidProjectHomeDirectory, '.applepi', 'settings.yml'))).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-002.4, APPLEPI-REQ-003.2, APPLEPI-REQ-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
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

    await expect(
      executeSetupCommand(
        { homeDirectory: join(root, 'unsafe-home'), projectDirectory },
        {
          interactive: true,
          input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
          output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
          writeLine: () => undefined,
          synchronizer: defaultProfileSynchronizer,
          selectDefaultProfile() {
            return Promise.resolve('bad\nprofile');
          },
        },
      ),
    ).rejects.toThrow('filesystem-safe');
    await expect(
      executeSetupCommand(
        { homeDirectory: join(root, 'unlisted-home'), projectDirectory },
        {
          interactive: true,
          input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
          output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
          writeLine: () => undefined,
          synchronizer: defaultProfileSynchronizer,
          selectDefaultProfile() {
            return Promise.resolve('unlisted');
          },
        },
      ),
    ).rejects.toThrow('not one of the available setup profiles');

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

    expect(result.defaultProfilePath).toBe(join(homeDirectory, '.applepi', 'profiles', 'data_analyst', 'profile.yml'));
    expect(readFileSync(result.defaultProfilePath, 'utf8')).toBe('id: data_analyst\nlabel: Default\ncontrols: {}\n');
    expect(result.messages).toContain("Selected default profile 'data_analyst'.");
    expect(messages).toEqual([
      'Welcome to ApplePi. ApplePi is the easiest way to run Pi.',
      'ApplePi manages full pi configurations for you, so you can use different profiles in different situations.',
    ]);
    expect(readFileSync(join(homeDirectory, '.applepi', 'settings.yml'), 'utf8')).toContain(
      'default_profile: data_analyst',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('loads wizard choices from legacy URI and repository subpath sources', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const legacyUri = 'https://example.test/legacy-profiles.git';
    const repositoryUri = 'https://example.test/repository-profiles.git';
    const duplicateUri = 'https://example.test/duplicate-profiles.git';
    writeSettings(
      homeDirectory,
      [
        'default_profile: legacy',
        'profile_sources:',
        `  - uri: ${legacyUri}`,
        `  - uri: ${repositoryUri}`,
        '    ref: main',
        '    path: profiles',
        `  - uri: ${duplicateUri}`,
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
            } else if (source.uri === repositoryUri) {
              expect(cachePath).toBe(createRemoteRepositoryCachePath(homeDirectory, source));
              writeCachedProfile(join(cachePath, 'profiles'), 'repository');
              writeFileSync(
                join(cachePath, 'profiles', 'repository', 'profile.yml'),
                'id: repository\nlabel: Repository\ncontrols: {}\n',
              );
            } else {
              expect(source.uri).toBe(duplicateUri);
              expect(cachePath).toBe(createRemoteRepositoryCachePath(homeDirectory, source));
              writeCachedProfile(join(cachePath, 'profiles'), 'repository');
            }

            return 'updated';
          },
        },
        selectDefaultProfile(profiles) {
          expect(profiles.map((profile) => profile.id)).toEqual(['legacy', 'repository']);
          expect(profiles.find((profile) => profile.id === 'repository')?.label).toBe('Repository');
          return Promise.resolve('repository');
        },
      },
    );

    expect(result.messages).toContain("Selected default profile 'repository'.");
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('updates the effective default profile when duplicate settings keys are present', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const missingDefaultHomeDirectory = join(root, 'missing-default-home');
    const settingsPath = join(homeDirectory, '.applepi', 'settings.yml');
    const missingDefaultSettingsPath = join(missingDefaultHomeDirectory, '.applepi', 'settings.yml');
    writeSettings(
      homeDirectory,
      ['default_profile: legacy', 'profile_sources: []', 'default_profile: current', ''].join('\n'),
    );
    writeSettings(missingDefaultHomeDirectory, 'profile_sources: []\n');

    updateSettingsDefaultProfile(settingsPath, 'selected');
    updateSettingsDefaultProfile(missingDefaultSettingsPath, 'selected');

    expect(readFileSync(settingsPath, 'utf8')).toBe(
      ['default_profile: selected', 'profile_sources: []', 'default_profile: selected', ''].join('\n'),
    );
    expect(readFileSync(missingDefaultSettingsPath, 'utf8')).toBe('profile_sources: []\ndefault_profile: selected\n');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
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
      },
    );

    expect(result.messages).toContain("Selected default profile 'solo'.");
    expect(messages[0]).toContain('Welcome to ApplePi');
    expect(readFileSync(join(homeDirectory, '.applepi', 'settings.yml'), 'utf8')).toContain('default_profile: solo');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects out-of-range readline setup prompt selections', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const profilesDirectory = join(homeDirectory, '.applepi', 'profiles');
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
        },
      ),
    ).rejects.toThrow('out of range');
  });
});
