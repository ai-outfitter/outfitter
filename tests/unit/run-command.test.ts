// Tests run command composite profile assembly, launch behavior, and error handling.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunCommand, resolveChildExitCode } from '../../src/cli/commands/RunCommand.js';
import { createCompositeProfile } from '../../src/compositeProfile/CompositeProfile.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'applepi-run-command-'));
  temporaryRoots.push(root);
  return root;
};

const writeSettings = (homeDirectory: string, content: string): void => {
  mkdirSync(join(homeDirectory, '.applepi'), { recursive: true });
  writeFileSync(join(homeDirectory, '.applepi', 'settings.yml'), content);
};

const writeProfile = (root: string, id: string, content: string): string => {
  const profileDirectory = join(root, id);
  mkdirSync(profileDirectory, { recursive: true });
  const profilePath = join(profileDirectory, 'profile.yml');
  writeFileSync(profilePath, content);
  return profilePath;
};

const waitForFileContaining = async (path: string, content: string): Promise<void> => {
  await waitForFileMatching(path, (actual) => actual.includes(content));
  expect(readFileSync(path, 'utf8')).toContain(content);
};

const waitForFileMatching = async (path: string, predicate: (content: string) => boolean): Promise<void> => {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (existsSync(path) && predicate(readFileSync(path, 'utf8'))) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 25));
  }
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('run command', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.1, APPLEPI-REQ-005.2, APPLEPI-REQ-005.3, APPLEPI-REQ-005.4, APPLEPI-REQ-005.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('resolves the default profile, writes and refreshes a temp compositeProfile, warns, and passes through args', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const profilesDirectory = join(homeDirectory, '.applepi', 'profiles');
    writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    const baseProfilePath = writeProfile(
      profilesDirectory,
      'base',
      ['id: base', 'controls:', '  model: base-model', '  environment:', '    BASE_ENV: inherited', ''].join('\n'),
    );
    const profilePath = writeProfile(
      profilesDirectory,
      'default',
      [
        'id: default',
        'inherits: [base]',
        'controls:',
        '  model: test-model',
        '  environment:',
        '    TEST_ENV: yes',
        '  unsupported_feature: true',
        '',
      ].join('\n'),
    );
    const unrelatedProfilePath = writeProfile(
      profilesDirectory,
      'unrelated',
      'id: unrelated\ncontrols:\n  model: unrelated-model\n',
    );
    const warnings: string[] = [];
    const launches: unknown[] = [];

    const result = await executeRunCommand(
      {
        homeDirectory,
        projectDirectory,
        passThroughArgs: ['--debug', 'prompt text'],
      },
      {
        writeError: (message) => warnings.push(message),
        launcher: {
          launch(plan) {
            launches.push(plan);
            return new Promise((resolve) => {
              setTimeout(() => {
                writeFileSync(
                  profilePath,
                  [
                    'id: default',
                    'inherits: [base]',
                    'controls:',
                    '  model: test-model',
                    '  environment:',
                    '    TEST_ENV: yes',
                    '    LIVE_ENV: refreshed',
                    '  unsupported_feature: true',
                    '',
                  ].join('\n'),
                );
                resolve(
                  waitForFileContaining(join(plan.env.PI_CODING_AGENT_DIR, 'applepi', 'profile.json'), 'LIVE_ENV').then(
                    () => 0,
                  ),
                );
              }, 25);
            });
          },
        },
      },
    );

    expect(result.profileId).toBe('default');
    expect(result.compositeProfileDirectory).toContain('applepi-default-pi-');
    expect(existsSync(join(result.compositeProfileDirectory, 'applepi', 'profile.json'))).toBe(true);
    const profileMetadata = readFileSync(join(result.compositeProfileDirectory, 'applepi', 'profile.json'), 'utf8');
    expect(profileMetadata).toContain('test-model');
    expect(profileMetadata).toContain('BASE_ENV');
    expect(profileMetadata).toContain('LIVE_ENV');
    expect(profileMetadata).not.toContain('unrelated-model');
    expect(result.launchPlan.args).toEqual(['--model', 'test-model', '--debug', 'prompt text']);
    expect(result.launchPlan.env.TEST_ENV).toBe('yes');
    expect(result.launchPlan.env.PI_CODING_AGENT_DIR).toBe(result.compositeProfileDirectory);
    expect(result.warnings).toEqual(["pi adapter cannot translate requested control 'unsupported_feature'."]);
    expect(warnings).toEqual(result.warnings);
    expect(launches).toHaveLength(1);
    expect(profilePath).toContain('profile.yml');
    expect(baseProfilePath).toContain('profile.yml');
    expect(unrelatedProfilePath).toContain('profile.yml');

    await executeRunCommand(
      { homeDirectory, projectDirectory, profileId: 'default' },
      {
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('runs setup automatically before the default run when user setup has not run', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const messages: string[] = [];

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        writeLine: (message) => messages.push(message),
        synchronizer: {
          sync(_source, cachePath) {
            mkdirSync(join(cachePath, 'profiles', 'engineer'), { recursive: true });
            writeFileSync(join(cachePath, 'profiles', 'engineer', 'profile.yml'), 'id: engineer\ncontrols: {}\n');
            return 'updated';
          },
        },
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(messages).toEqual([
      '`applepi setup` has not been run yet - running now',
      '→ resolving profile engineer',
      `✓ profile layer engineer  ${join(homeDirectory, '.applepi', 'profiles', 'engineer')}`,
      '✓ profile layer engineer  github:Unsupervisedcom/applepi-default-profiles@main/profiles',
      '✓ merged controls',
      `✓ prepared composite profile  ${result.compositeProfileDirectory}`,
      '↳ launching pi …',
    ]);
    expect(result.profileId).toBe('engineer');
    expect(existsSync(join(homeDirectory, '.applepi', 'settings.yml'))).toBe(true);
    expect(existsSync(join(homeDirectory, '.applepi', 'profiles', 'engineer', 'profile.yml'))).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-002.3, APPLEPI-REQ-002.4, APPLEPI-REQ-003.1, APPLEPI-REQ-006.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports invalid settings, invalid profile sources, missing profiles, URI caches, and child exit codes', async () => {
    const root = createTemporaryRoot();
    const badSettingsHome = join(root, 'bad-settings-home');
    const projectDirectory = join(root, 'project');
    writeSettings(badSettingsHome, 'profile_sources:\n  - only: [default]\n');
    await expect(executeRunCommand({ homeDirectory: badSettingsHome, projectDirectory })).rejects.toThrow(
      'Cannot run with invalid settings',
    );

    const badProfileHome = join(root, 'bad-profile-home');
    writeSettings(badProfileHome, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    writeProfile(
      join(badProfileHome, '.applepi', 'profiles'),
      'default',
      'id: default\ncontrols:\n  environment:\n    COUNT: 1\n',
    );
    await expect(executeRunCommand({ homeDirectory: badProfileHome, projectDirectory })).rejects.toThrow(
      'Cannot run with invalid profiles',
    );

    const missingProfileHome = join(root, 'missing-profile-home');
    writeSettings(missingProfileHome, 'default_profile: missing\nprofile_sources:\n  - path: ./profiles\n');
    mkdirSync(join(missingProfileHome, '.applepi', 'profiles'), { recursive: true });
    await expect(executeRunCommand({ homeDirectory: missingProfileHome, projectDirectory })).rejects.toThrow(
      "Cannot resolve profile 'missing'",
    );

    const uriHome = join(root, 'uri-home');
    const uri = 'https://example.test/team/profiles.git';
    writeSettings(uriHome, `default_profile: cached\nprofile_sources:\n  - uri: ${uri}\n`);
    writeProfile(
      join(uriHome, '.applepi', 'cache', 'profiles', Buffer.from(uri).toString('base64url')),
      'cached',
      'id: cached\ncontrols: {}\n',
    );
    const result = await executeRunCommand(
      { homeDirectory: uriHome, projectDirectory, profileId: 'cached' },
      {
        launcher: {
          launch() {
            return Promise.resolve(7);
          },
        },
      },
    );
    expect(result.exitCode).toBe(7);

    const fallbackHome = join(root, 'fallback-home');
    writeSettings(fallbackHome, 'profile_sources:\n  - path: ./profiles\n');
    writeProfile(join(fallbackHome, '.applepi', 'profiles'), 'default', 'id: default\ncontrols: {}\n');
    await expect(
      executeRunCommand(
        { homeDirectory: fallbackHome, projectDirectory },
        {
          launcher: {
            launch() {
              return Promise.resolve(0);
            },
          },
        },
      ),
    ).rejects.toThrow('Cannot run without a selected profile or default_profile');

    const spawnedHome = join(root, 'spawned-home');
    writeSettings(spawnedHome, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    writeProfile(join(spawnedHome, '.applepi', 'profiles'), 'default', 'id: default\ncontrols: {}\n');
    const spawnedResult = await executeRunCommand(
      { homeDirectory: spawnedHome, projectDirectory },
      {
        adapter: {
          id: 'node',
          supportedControls: [],
          createCompositeProfile(_profile, compositeProfileInput) {
            return { compositeProfile: createCompositeProfile(compositeProfileInput.rootDirectory, []), warnings: [] };
          },
          createLaunchPlan(compositeProfile) {
            return {
              command: process.execPath,
              args: ['-e', 'process.exit(0)'],
              env: { COMPOSITE_PROFILE: compositeProfile.rootDirectory },
            };
          },
          getUnsupportedControls() {
            return [];
          },
        },
      },
    );
    expect(spawnedResult.exitCode).toBe(0);
  });

  it('maps child process exits and signals to command exit codes', () => {
    expect(resolveChildExitCode(7, null)).toBe(7);
    expect(resolveChildExitCode(null, 'SIGINT')).toBe(130);
    expect(resolveChildExitCode(null, 'SIGTERM')).toBe(143);
    expect(resolveChildExitCode(null, 'SIGHUP')).toBe(129);
    expect(resolveChildExitCode(null, null)).toBe(1);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-005.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('makes unsupported control warnings fatal when strict is enabled', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    writeProfile(
      join(homeDirectory, '.applepi', 'profiles'),
      'default',
      'id: default\ncontrols:\n  unsupported_feature: true\n',
    );

    await expect(
      executeRunCommand(
        { homeDirectory, projectDirectory, strict: true },
        {
          launcher: {
            launch() {
              return Promise.resolve(0);
            },
          },
        },
      ),
    ).rejects.toThrow("Strict failed for pi: pi adapter cannot translate requested control 'unsupported_feature'.");
  });
});
