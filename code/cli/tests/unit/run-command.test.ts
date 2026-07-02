/* eslint-disable max-lines */
// Tests run command composite profile assembly, launch behavior, and error handling.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunCommand, resolveChildExitCode } from '../../src/cli/commands/RunCommand.js';
import { createCompositeProfile } from '../../src/compositeProfile/CompositeProfile.js';
import { createRemoteRepositoryCachePath } from '../../src/profiles/ProfileCache.js';
import { allowTestConsoleOutput } from '../test-console.js';

const temporaryRoots: string[] = [];
const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const builtInOutfitterSkill = join(repositoryRoot, 'skills', 'outfitter');

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-run-command-'));
  temporaryRoots.push(root);
  return root;
};

const writeSettings = (homeDirectory: string, content: string): void => {
  mkdirSync(join(homeDirectory, '.outfitter'), { recursive: true });
  writeFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), content);
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

const isRunCommandSummaryMessage = (text: string): boolean => {
  const normalizedText = stripAnsiCodes(text);

  return (
    normalizedText.startsWith('→ resolving profile ') ||
    normalizedText.startsWith('✓ profile layer ') ||
    normalizedText.startsWith('✓ merged controls') ||
    normalizedText.startsWith('✓ prepared composite profile ') ||
    normalizedText.startsWith('↳ launching ')
  );
};

const ansiEscapePattern = new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g');

const stripAnsiCodes = (text: string): string => text.replace(ansiEscapePattern, '');

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('run command', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.1, OFTR-005.2, OFTR-005.3, OFTR-005.4, OFTR-005.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('resolves the default profile, writes and refreshes a temp compositeProfile, warns, and passes through args', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const profilesDirectory = join(homeDirectory, '.outfitter', 'profiles');
    writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    writeProfile(
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
    writeProfile(profilesDirectory, 'unrelated', 'id: unrelated\ncontrols:\n  model: unrelated-model\n');
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
        writeLine: () => undefined,
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
                  waitForFileContaining(
                    join(plan.env.PI_CODING_AGENT_DIR, 'outfitter', 'profile.json'),
                    'LIVE_ENV',
                  ).then(() => 0),
                );
              }, 25);
            });
          },
        },
      },
    );

    expect(result.profileId).toBe('default');
    expect(result.compositeProfileDirectory).toContain('outfitter-default-pi-');
    expect(existsSync(join(result.compositeProfileDirectory, 'outfitter', 'profile.json'))).toBe(true);
    const profileMetadata = readFileSync(join(result.compositeProfileDirectory, 'outfitter', 'profile.json'), 'utf8');
    expect(profileMetadata).toContain('test-model');
    expect(profileMetadata).toContain('BASE_ENV');
    expect(profileMetadata).toContain('LIVE_ENV');
    expect(profileMetadata).not.toContain('unrelated-model');
    expect(result.launchPlan.args).toEqual([
      '--extension',
      join(result.compositeProfileDirectory, 'outfitter', 'outfitter-extension.js'),
      '--model',
      'test-model',
      '--skill',
      builtInOutfitterSkill,
      '--debug',
      'prompt text',
    ]);
    expect(result.launchPlan.env.TEST_ENV).toBe('yes');
    expect(result.launchPlan.env.PI_CODING_AGENT_DIR).toBe(result.compositeProfileDirectory);
    expect(result.warnings).toEqual(["pi adapter cannot translate requested control 'unsupported_feature'."]);
    expect(warnings).toEqual(result.warnings);
    expect(launches).toHaveLength(1);

    await executeRunCommand(
      { homeDirectory, projectDirectory, profileId: 'default' },
      {
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
        writeError: () => undefined,
        writeLine: () => undefined,
      },
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.1, OFTR-010.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('starts Pi-native runtime onboarding instead of terminal setup when user settings are missing', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const messages: string[] = [];
    const syncedSources: unknown[] = [];

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        writeLine: (message) => messages.push(message),
        synchronizer: {
          sync(source, cachePath) {
            syncedSources.push(source);
            for (const profileId of ['founder', 'engineer', 'data_analyst']) {
              mkdirSync(join(cachePath, 'profiles', profileId), { recursive: true });
              writeFileSync(join(cachePath, 'profiles', profileId, 'profile.yml'), `id: ${profileId}\ncontrols: {}\n`);
            }
            return 'updated';
          },
        },
        launcher: {
          launch(plan) {
            expect(existsSync(join(homeDirectory, '.outfitter', 'settings.yml'))).toBe(false);
            expect(plan.args).toContain('--extension');
            expect(plan.args).not.toContain('--model');
            expect(readFileSync(join(plan.env.PI_CODING_AGENT_DIR, 'settings.json'), 'utf8')).toContain(
              '"quietStartup": true',
            );
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(messages).toEqual(
      expect.arrayContaining([
        'Outfitter will ask Pi to open `/login` automatically if Pi reports no available models after startup.',
        '→ resolving profile outfitter-bootstrap',
        '✓ merged controls',
        `✓ prepared composite profile  ${result.compositeProfileDirectory}`,
        '↳ launching pi …',
      ]),
    );
    expect(syncedSources).toEqual([{ github: 'ai-outfitter/default-profiles', path: 'profiles' }]);
    expect(result.profileId).toBe('outfitter-bootstrap');
    expect(existsSync(join(homeDirectory, '.outfitter', 'settings.yml'))).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('falls back to the built-in starter profile when the default profiles catalog cannot sync', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const builtinProfilesPath = join(homeDirectory, '.outfitter', 'cache', 'builtin-profiles');
    const warnings: string[] = [];

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        writeLine: () => undefined,
        writeError: (message) => warnings.push(message),
        synchronizer: {
          sync() {
            throw new Error('network blocked');
          },
        },
        launcher: {
          launch(plan) {
            const extensionConfigPath = plan.env.OUTFITTER_PI_EXTENSION_CONFIG ?? '';
            expect(readFileSync(extensionConfigPath, 'utf8')).toContain(JSON.stringify(builtinProfilesPath));
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(result.profileId).toBe('outfitter-bootstrap');
    expect(readFileSync(join(builtinProfilesPath, 'starter', 'profile.yml'), 'utf8')).toContain('id: starter');
    expect(
      warnings.some(
        (message) =>
          message.includes('github:ai-outfitter/default-profiles') &&
          message.includes('network blocked') &&
          message.includes('`outfitter sync`'),
      ),
    ).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('emits runtime login kickoff guidance when no native login state is configured', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const messages: string[] = [];
    writeSettings(
      homeDirectory,
      'default_profile: engineer\nstartup:\n  ascii_art: false\nprofile_sources:\n  - path: ./profiles\n',
    );
    writeProfile(join(homeDirectory, '.outfitter', 'profiles'), 'engineer', 'id: engineer\ncontrols: {}\n');

    const firstResult = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        writeLine: (message) => messages.push(message),
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );

    const extensionConfigPath = firstResult.launchPlan.env.OUTFITTER_PI_EXTENSION_CONFIG;
    if (extensionConfigPath === undefined) {
      throw new Error('Outfitter extension runtime config was not injected.');
    }
    expect(readFileSync(extensionConfigPath, 'utf8')).toContain('"startupAsciiArt": false');
    expect(messages).toContain(
      'Outfitter will ask Pi to open `/login` automatically if Pi reports no available models after startup.',
    );
    expect(messages.join('\n')).not.toContain('sk-');

    messages.length = 0;
    mkdirSync(join(homeDirectory, '.pi', 'agent'), { recursive: true });
    writeFileSync(join(homeDirectory, '.pi', 'agent', 'models.json'), 'not-json\n');
    await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        writeLine: (message) => messages.push(message),
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );
    expect(messages).toContain(
      'Outfitter will ask Pi to open `/login` automatically if Pi reports no available models after startup.',
    );

    messages.length = 0;
    writeFileSync(join(homeDirectory, '.pi', 'agent', 'models.json'), 'null\n');
    await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        writeLine: (message) => messages.push(message),
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );
    expect(messages).toContain(
      'Outfitter will ask Pi to open `/login` automatically if Pi reports no available models after startup.',
    );

    messages.length = 0;
    writeFileSync(join(homeDirectory, '.pi', 'agent', 'auth.json'), 'not-json\n');
    await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        writeLine: (message) => messages.push(message),
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );
    expect(messages).toContain(
      'Outfitter will ask Pi to open `/login` automatically if Pi reports no available models after startup.',
    );

    messages.length = 0;
    writeFileSync(join(homeDirectory, '.pi', 'agent', 'auth.json'), '{"openai":{"type":"oauth"}}\n');
    await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        writeLine: (message) => messages.push(message),
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );
    expect(messages).not.toContain(
      'Outfitter will ask Pi to open `/login` automatically if Pi reports no available models after startup.',
    );

    rmSync(join(homeDirectory, '.pi', 'agent', 'auth.json'), { force: true });
    messages.length = 0;
    writeFileSync(join(homeDirectory, '.pi', 'agent', 'models.json'), '{"models":["codex"]}\n');
    await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        writeLine: (message) => messages.push(message),
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(messages).not.toContain(
      'Outfitter will ask Pi to open `/login` automatically if Pi reports no available models after startup.',
    );

    messages.length = 0;
    writeFileSync(join(homeDirectory, '.pi', 'agent', 'models.json'), '{"codex":{}}\n');
    await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        writeLine: (message) => messages.push(message),
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(messages).not.toContain(
      'Outfitter will ask Pi to open `/login` automatically if Pi reports no available models after startup.',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('does not mutate settings or show onboarding for explicit non-interactive first runs', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');

    await expect(
      executeRunCommand(
        { homeDirectory, projectDirectory },
        {
          interactive: false,
          writeLine: () => undefined,
          synchronizer: {
            sync() {
              throw new Error('non-interactive first runs must not sync onboarding sources');
            },
          },
          launcher: {
            launch() {
              throw new Error('non-interactive first runs must not launch without settings');
            },
          },
        },
      ),
    ).rejects.toThrow('Cannot run without a selected profile or default_profile');

    expect(existsSync(join(homeDirectory, '.outfitter', 'settings.yml'))).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('does not fall back to terminal setup when stdout is not a TTY', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');

    await expect(
      executeRunCommand(
        { homeDirectory, projectDirectory },
        {
          input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
          output: { isTTY: false } as NodeJS.WritableStream & { isTTY: false },
          writeLine: () => undefined,
          launcher: {
            launch() {
              throw new Error('non-TTY first runs must not launch without settings');
            },
          },
        },
      ),
    ).rejects.toThrow('Cannot run without a selected profile or default_profile');

    expect(existsSync(join(homeDirectory, '.outfitter', 'settings.yml'))).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.3, OFTR-002.4, OFTR-003.1, OFTR-006.1).
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
      join(badProfileHome, '.outfitter', 'profiles'),
      'default',
      'id: default\ncontrols:\n  environment:\n    COUNT: 1\n',
    );
    await expect(executeRunCommand({ homeDirectory: badProfileHome, projectDirectory })).rejects.toThrow(
      'Cannot run with invalid profiles',
    );

    const missingProfileHome = join(root, 'missing-profile-home');
    writeSettings(missingProfileHome, 'default_profile: missing\nprofile_sources:\n  - path: ./profiles\n');
    mkdirSync(join(missingProfileHome, '.outfitter', 'profiles'), { recursive: true });
    await expect(executeRunCommand({ homeDirectory: missingProfileHome, projectDirectory })).rejects.toThrow(
      "Cannot resolve profile 'missing'",
    );

    const uriHome = join(root, 'uri-home');
    const uri = 'https://example.test/team/profiles.git';
    writeSettings(uriHome, `default_profile: cached\nprofile_sources:\n  - uri: ${uri}\n`);
    writeProfile(
      join(uriHome, '.outfitter', 'cache', 'profiles', Buffer.from(uri).toString('base64url')),
      'cached',
      'id: cached\ncontrols: {}\n',
    );
    allowTestConsoleOutput(
      ({ method, text }) =>
        method === 'log' &&
        (isRunCommandSummaryMessage(text) || text.startsWith('Outfitter will ask Pi to open `/login` automatically')),
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

    const defaultCatalogHome = join(root, 'default-catalog-home');
    writeSettings(
      defaultCatalogHome,
      [
        'default_profile: founder',
        'profile_sources:',
        '  - github: ai-outfitter/default-profiles',
        '    path: profiles',
        '  - path: ./profiles',
        '',
      ].join('\n'),
    );
    writeProfile(
      join(
        createRemoteRepositoryCachePath(defaultCatalogHome, {
          github: 'ai-outfitter/default-profiles',
          path: 'profiles',
        }),
        'profiles',
      ),
      'founder',
      'id: founder\ncontrols: {}\n',
    );
    const defaultCatalogResult = await executeRunCommand(
      { homeDirectory: defaultCatalogHome, projectDirectory },
      {
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
        writeLine: () => undefined,
      },
    );
    expect(defaultCatalogResult.profileId).toBe('founder');
    expect(existsSync(join(defaultCatalogHome, '.outfitter', 'profiles'))).toBe(true);

    const fallbackHome = join(root, 'fallback-home');
    writeSettings(fallbackHome, 'profile_sources:\n  - path: ./profiles\n');
    writeProfile(join(fallbackHome, '.outfitter', 'profiles'), 'default', 'id: default\ncontrols: {}\n');
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
    writeProfile(join(spawnedHome, '.outfitter', 'profiles'), 'default', 'id: default\ncontrols: {}\n');
    const spawnedResult = await executeRunCommand(
      { homeDirectory: spawnedHome, projectDirectory },
      {
        writeLine: () => undefined,
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

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('makes unsupported control warnings fatal when strict is enabled', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(homeDirectory, 'default_profile: default\nprofile_sources:\n  - path: ./profiles\n');
    writeProfile(
      join(homeDirectory, '.outfitter', 'profiles'),
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
