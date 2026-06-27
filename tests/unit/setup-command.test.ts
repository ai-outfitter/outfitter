/* eslint-disable max-lines */
// Tests setup command behavior.
import { PassThrough } from 'node:stream';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { executeSetupCommand, updateSettingsDefaultProfile } from '../../src/cli/commands/SetupCommand.js';
import { createProfileSourceCachePath, createRemoteRepositoryCachePath } from '../../src/profiles/ProfileCache.js';
import { allowTestConsoleOutput } from '../test-console.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-setup-command-'));
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

const waitForOutput = async (chunks: readonly Buffer[], output: PassThrough, expectedText: string): Promise<void> => {
  if (Buffer.concat(chunks).toString('utf8').includes(expectedText)) {
    return;
  }

  await new Promise<void>((resolve, reject) => {
    function checkOutput() {
      if (!Buffer.concat(chunks).toString('utf8').includes(expectedText)) {
        return;
      }

      clearTimeout(timeout);
      output.off('data', checkOutput);
      resolve();
    }

    const timeout = setTimeout(() => {
      output.off('data', checkOutput);
      reject(new Error(`Timed out waiting for output: ${expectedText}`));
    }, 1000);

    output.on('data', checkOutput);
    checkOutput();
  });
};

const waitForCapturedOutput = async (chunks: readonly string[], expectedText: string): Promise<void> => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (chunks.join('').includes(expectedText)) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 10));
  }

  throw new Error(`Timed out waiting for output: ${expectedText}`);
};

const forceProcessStdoutTty = (): (() => void) => {
  const descriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY');
  Object.defineProperty(process.stdout, 'isTTY', { configurable: true, value: true });

  return () => {
    if (descriptor === undefined) {
      Reflect.deleteProperty(process.stdout, 'isTTY');
      return;
    }

    Object.defineProperty(process.stdout, 'isTTY', descriptor);
  };
};

const captureProcessStdout = (chunks: string[]): void => {
  vi.spyOn(process.stdout, 'write').mockImplementation(
    (
      chunk: string | Uint8Array,
      encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
      callback?: (error?: Error | null) => void,
    ) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk.toString('utf8') : String(chunk));
      const done = typeof encodingOrCallback === 'function' ? encodingOrCallback : callback;
      done?.();
      return true;
    },
  );
};

const defaultProfileSynchronizer = {
  sync(_source: unknown, cachePath: string) {
    writeCachedProfile(join(cachePath, 'profiles'), 'engineer');
    writeCachedProfile(join(cachePath, 'profiles'), 'data_analyst');
    return 'updated' as const;
  },
};

afterEach(() => {
  vi.restoreAllMocks();

  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('setup command', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.4, OFTR-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('creates initial user settings and a default user profile without overwriting existing files', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');

    const firstResult = await executeSetupCommand(
      { homeDirectory, projectDirectory },
      { synchronizer: defaultProfileSynchronizer },
    );
    const settingsPath = join(homeDirectory, '.outfitter', 'settings.yml');
    const defaultProfilePath = join(homeDirectory, '.outfitter', 'profiles', 'engineer', 'profile.yml');

    expect(firstResult.createdSettings).toBe(true);
    expect(firstResult.createdDefaultProfile).toBe(true);
    expect(readFileSync(settingsPath, 'utf8')).toBe(
      [
        'default_profile: engineer',
        'profile_sources:',
        '  - github: ai-outfitter/default-profiles',
        '    path: profiles',
        '  - path: ./profiles',
        '',
      ].join('\n'),
    );
    expect(readFileSync(defaultProfilePath, 'utf8')).toBe('id: engineer\nlabel: Default\ncontrols: {}\n');
    expect(firstResult.messages).toContain("Selected default profile 'engineer'.");
    expect(firstResult.syncResult.sources).toHaveLength(1);
    expect(firstResult.syncResult.sources[0]?.uri).toBe(
      'git+https://github.com/ai-outfitter/default-profiles.git:profiles',
    );

    writeFileSync(defaultProfilePath, 'id: default\nlabel: Custom\n');
    const secondResult = await executeSetupCommand(
      { homeDirectory, projectDirectory },
      { synchronizer: defaultProfileSynchronizer },
    );

    expect(secondResult.createdSettings).toBe(false);
    expect(secondResult.createdDefaultProfile).toBe(false);
    expect(readFileSync(defaultProfilePath, 'utf8')).toBe('id: default\nlabel: Custom\n');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('fails first-run setup when the default profile source cannot sync', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');

    const failingDependencies = {
      synchronizer: {
        sync() {
          return 'failed' as const;
        },
      },
    };

    await expect(executeSetupCommand({ homeDirectory, projectDirectory }, failingDependencies)).rejects.toThrow(
      'Cannot complete first-run setup because the default profiles source failed to sync',
    );
    expect(existsSync(join(homeDirectory, '.outfitter', 'settings.yml'))).toBe(false);
    await expect(executeSetupCommand({ homeDirectory, projectDirectory }, failingDependencies)).rejects.toThrow(
      'Cannot complete first-run setup because the default profiles source failed to sync',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('does not delete settings created during setup-source synchronization when first-run sync fails', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const settingsPath = join(homeDirectory, '.outfitter', 'settings.yml');
    const settingsContent = [
      'default_profile: engineer',
      'profile_sources:',
      '  - github: ai-outfitter/default-profiles',
      '    path: profiles',
      '',
    ].join('\n');

    await expect(
      executeSetupCommand(
        { homeDirectory, projectDirectory, setupSourceUri: 'https://example.test/outfitter-config.git' },
        {
          setupSourceSynchronizer: {
            sync(_uri, cachePath) {
              mkdirSync(cachePath, { recursive: true });
              mkdirSync(dirname(settingsPath), { recursive: true });
              writeFileSync(settingsPath, settingsContent);
            },
          },
          synchronizer: {
            sync() {
              return 'failed' as const;
            },
          },
        },
      ),
    ).rejects.toThrow('Cannot complete first-run setup because the default profiles source failed to sync');

    expect(readFileSync(settingsPath, 'utf8')).toBe(settingsContent);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('uses a setup source repository as the initial user settings and profiles without overwriting files', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const setupSourceUri = 'https://user:secret@example.test/outfitter-config';
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
    expect(result.messages.join('\n')).toContain(
      'Start the selected default profile either way:\n  outfitter\n  outfitter --profile team',
    );
    expect(readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8')).toBe(
      'default_profile: team\nprofile_sources:\n  - path: ./profiles\n',
    );
    expect(readFileSync(join(homeDirectory, '.outfitter', 'profiles', 'team', 'profile.yml'), 'utf8')).toBe(
      'id: team\nlabel: Team\ncontrols: {}\n',
    );

    writeFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'default_profile: custom\n');
    writeFileSync(join(homeDirectory, '.outfitter', 'profiles', 'team', 'profile.yml'), 'id: team\nlabel: Custom\n');
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
    expect(readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8')).toBe('default_profile: custom\n');
    expect(readFileSync(join(homeDirectory, '.outfitter', 'profiles', 'team', 'profile.yml'), 'utf8')).toBe(
      'id: team\nlabel: Custom\n',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.1.14).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('limits setup-source wizard profile choices to the passed source', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const setupSourceUri = 'https://example.test/link-profiles';

    writeSettings(
      homeDirectory,
      [
        'default_profile: engineer',
        'profile_sources:',
        '  - github: ai-outfitter/default-profiles',
        '    path: profiles',
        '  - path: ./profiles',
        '',
      ].join('\n'),
    );

    const result = await executeSetupCommand(
      { homeDirectory, projectDirectory, setupSourceUri },
      {
        interactive: true,
        input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
        output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
        writeLine: () => undefined,
        synchronizer: defaultProfileSynchronizer,
        setupSourceSynchronizer: {
          sync(_uri, cachePath) {
            for (const [profileId, label] of [
              ['project-lead', 'Project Lead'],
              ['ops', 'Operations'],
            ] as const) {
              const profileFolder = join(cachePath, 'profiles', profileId);
              mkdirSync(profileFolder, { recursive: true });
              writeFileSync(join(profileFolder, 'profile.yml'), `id: ${profileId}\nlabel: ${label}\ncontrols: {}\n`);
            }
          },
        },
        selectSetupSourceImportTarget(choices, defaultTarget) {
          expect(defaultTarget).toBe('home');
          expect(choices.map((choice) => choice.target)).toEqual(['home', 'project']);
          return Promise.resolve('home');
        },
        selectDefaultProfile(profiles, currentDefault) {
          expect(currentDefault).toBe('engineer');
          expect(profiles.map((profile) => profile.id)).toEqual(['ops', 'project-lead']);
          expect(profiles.map((profile) => profile.label)).toEqual(['Operations', 'Project Lead']);
          return Promise.resolve('project-lead');
        },
        selectWelcomePlan() {
          return Promise.resolve({ answerQuestions: false });
        },
      },
    );

    expect(result.defaultProfilePath).toBe(
      join(homeDirectory, '.outfitter', 'profiles', 'project-lead', 'profile.yml'),
    );
    expect(result.createdDefaultProfile).toBe(false);
    expect(result.messages.join('\n')).not.toContain('Default user profile');
    expect(result.messages).toContain("Selected default profile 'project-lead'.");
    expect(readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8')).toContain(
      'default_profile: project-lead',
    );
  });

  it('uses the setup source default profile as the first readline setup choice', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const setupSourceUri = 'https://example.test/link-profiles';
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const output = Object.assign(new PassThrough(), { isTTY: true });
    const outputChunks: Buffer[] = [];
    output.on('data', (chunk: Buffer) => outputChunks.push(chunk));

    writeSettings(
      homeDirectory,
      [
        'default_profile: engineer',
        'profile_sources:',
        '  - github: ai-outfitter/default-profiles',
        '    path: profiles',
        '  - path: ./profiles',
        '',
      ].join('\n'),
    );

    const resultPromise = executeSetupCommand(
      { homeDirectory, projectDirectory, setupSourceUri },
      {
        interactive: true,
        input,
        output,
        writeLine: () => undefined,
        synchronizer: defaultProfileSynchronizer,
        setupSourceSynchronizer: {
          sync(_uri, cachePath) {
            const outfitterDirectory = join(cachePath, '.outfitter');
            mkdirSync(outfitterDirectory, { recursive: true });
            writeFileSync(
              join(outfitterDirectory, 'settings.yml'),
              'default_profile: project-lead\nprofile_sources:\n  - path: ./profiles\n',
            );

            for (const [profileId, label] of [
              ['engineer', 'Engineer'],
              ['project-lead', 'Project Lead'],
            ] as const) {
              const profileFolder = join(outfitterDirectory, 'profiles', profileId);
              mkdirSync(profileFolder, { recursive: true });
              writeFileSync(join(profileFolder, 'profile.yml'), `id: ${profileId}\nlabel: ${label}\ncontrols: {}\n`);
            }
          },
        },
        selectWelcomePlan() {
          return Promise.resolve({ answerQuestions: false });
        },
      },
    );
    await waitForOutput(outputChunks, output, 'Default profile [1]:');
    input.end('\n');
    const result = await resultPromise;

    const promptOutput = Buffer.concat(outputChunks).toString('utf8');
    expect(promptOutput).toContain('Welcome to Outfitter.');
    expect(promptOutput).toContain("You're importing Outfitter profiles from https://example.test/link-profiles.");
    expect(promptOutput).not.toContain('Choose where to install these profiles:');
    expect(promptOutput).toContain('Choose the default profile from this setup source:');
    expect(promptOutput.match(/Choose the default profile/gu)).toHaveLength(1);
    expect(promptOutput.indexOf('Welcome to Outfitter.')).toBeLessThan(
      promptOutput.indexOf("You're importing Outfitter profiles"),
    );
    expect(promptOutput).toContain('1. project-lead - Project Lead');
    expect(promptOutput).toContain('2. engineer - Engineer');
    expect(promptOutput).toContain('Default profile [1]:');
    expect(promptOutput).toContain('____        _    __ _ _   _');
    expect(promptOutput).not.toContain('____  _');
    expect(result.messages).toContain("Selected default profile 'project-lead'.");
    expect(readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8')).toContain(
      'default_profile: project-lead',
    );
  });

  it('prints the setup-source welcome to stdout when no CLI output writer is injected', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const setupSourceUri = 'https://example.test/link-profiles';
    const input = Object.assign(new PassThrough(), { isTTY: true });
    const stdoutChunks: string[] = [];
    const restoreStdoutTty = forceProcessStdoutTty();
    captureProcessStdout(stdoutChunks);

    writeSettings(
      homeDirectory,
      [
        'default_profile: engineer',
        'profile_sources:',
        '  - github: ai-outfitter/default-profiles',
        '    path: profiles',
        '  - path: ./profiles',
        '',
      ].join('\n'),
    );

    try {
      const resultPromise = executeSetupCommand(
        { homeDirectory, projectDirectory, setupSourceUri },
        {
          interactive: true,
          input,
          synchronizer: defaultProfileSynchronizer,
          setupSourceSynchronizer: {
            sync(_uri, cachePath) {
              const outfitterDirectory = join(cachePath, '.outfitter');
              mkdirSync(outfitterDirectory, { recursive: true });
              writeFileSync(
                join(outfitterDirectory, 'settings.yml'),
                'default_profile: project-lead\nprofile_sources:\n  - path: ./profiles\n',
              );

              for (const [profileId, label] of [
                ['engineer', 'Engineer'],
                ['project-lead', 'Project Lead'],
              ] as const) {
                const profileFolder = join(outfitterDirectory, 'profiles', profileId);
                mkdirSync(profileFolder, { recursive: true });
                writeFileSync(join(profileFolder, 'profile.yml'), `id: ${profileId}\nlabel: ${label}\ncontrols: {}\n`);
              }
            },
          },
        },
      );
      await waitForCapturedOutput(stdoutChunks, 'Default profile [1]:');
      input.end('\n');
      const result = await resultPromise;

      const promptOutput = stdoutChunks.join('');
      expect(promptOutput).toContain('____        _    __ _ _   _');
      expect(promptOutput).toContain('Welcome to Outfitter.');
      expect(promptOutput).toContain("You're importing Outfitter profiles from https://example.test/link-profiles.");
      expect(promptOutput).not.toContain('Choose where to install these profiles:');
      expect(promptOutput).toContain('Choose the default profile from this setup source:');
      expect(promptOutput).toContain('1. project-lead - Project Lead');
      expect(promptOutput).toContain('Default profile [1]:');
      expect(result.messages).toContain("Selected default profile 'project-lead'.");
    } finally {
      restoreStdoutTty();
    }
  });

  it('imports setup-source profiles into the project without changing the user default', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const setupSourceUri = 'https://example.test/link-profiles';

    writeSettings(homeDirectory, 'default_profile: engineer\nprofile_sources:\n  - path: ./profiles\n');

    const result = await executeSetupCommand(
      { homeDirectory, projectDirectory, setupSourceUri },
      {
        interactive: true,
        input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
        output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
        writeLine: () => undefined,
        setupSourceSynchronizer: {
          sync(_uri, cachePath) {
            const outfitterDirectory = join(cachePath, '.outfitter');
            mkdirSync(outfitterDirectory, { recursive: true });
            for (const [profileId, label] of [
              ['engineer', 'Engineer'],
              ['project-lead', 'Project Lead'],
            ] as const) {
              const profileFolder = join(outfitterDirectory, 'profiles', profileId);
              mkdirSync(profileFolder, { recursive: true });
              writeFileSync(join(profileFolder, 'profile.yml'), `id: ${profileId}\nlabel: ${label}\ncontrols: {}\n`);
            }
          },
        },
        selectSetupSourceImportTarget(choices, defaultTarget) {
          expect(defaultTarget).toBe('home');
          expect(choices.map((choice) => choice.target)).toEqual(['home', 'project']);
          return Promise.resolve('project');
        },
        selectDefaultProfile(profiles, currentDefault) {
          expect(currentDefault).toBe('engineer');
          expect(profiles.map((profile) => profile.id)).toEqual(['engineer', 'project-lead']);
          return Promise.resolve('project-lead');
        },
        selectWelcomePlan() {
          throw new Error('source import onboarding should not run the generic welcome role prompt');
        },
      },
    );

    expect(result.settingsPath).toBe(join(projectDirectory, '.outfitter', 'settings.yml'));
    expect(result.defaultProfilePath).toBe(
      join(projectDirectory, '.outfitter', 'profiles', 'project-lead', 'profile.yml'),
    );
    expect(result.createdDefaultProfile).toBe(false);
    expect(result.messages.join('\n')).not.toContain('Default user profile');
    expect(result.messages.join('\n')).toContain(
      'Start the selected default profile either way:\n  outfitter\n  outfitter --profile project-lead',
    );
    expect(readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8')).toBe(
      'default_profile: engineer\nprofile_sources:\n  - path: ./profiles\n',
    );
    expect(readFileSync(join(projectDirectory, '.outfitter', 'settings.yml'), 'utf8')).toContain(
      'default_profile: project-lead',
    );
    expect(readFileSync(join(projectDirectory, '.outfitter', 'settings.yml'), 'utf8')).toContain('path: ./profiles');
    expect(readFileSync(join(projectDirectory, '.outfitter', 'profiles', 'project-lead', 'profile.yml'), 'utf8')).toBe(
      'id: project-lead\nlabel: Project Lead\ncontrols: {}\n',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('starts Outfitter with the selected setup-source default profile when requested', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const launchedProfiles: string[] = [];

    const result = await executeSetupCommand(
      { homeDirectory, projectDirectory, setupSourceUri: 'https://example.test/link-profiles' },
      {
        interactive: true,
        input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
        output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
        writeLine: () => undefined,
        setupSourceSynchronizer: {
          sync(_uri, cachePath) {
            const outfitterDirectory = join(cachePath, '.outfitter');
            const profileFolder = join(outfitterDirectory, 'profiles', 'project-lead');
            mkdirSync(profileFolder, { recursive: true });
            writeFileSync(join(outfitterDirectory, 'settings.yml'), 'default_profile: project-lead\n');
            writeFileSync(join(profileFolder, 'profile.yml'), 'id: project-lead\nlabel: Project Lead\ncontrols: {}\n');
          },
        },
        selectSetupSourceImportTarget() {
          return Promise.resolve('project');
        },
        selectDefaultProfile() {
          return Promise.resolve('project-lead');
        },
        selectSetupSourceLaunchAction(profileId) {
          expect(profileId).toBe('project-lead');
          return Promise.resolve('start');
        },
        launchSetupSourceProfile(input) {
          expect(input.homeDirectory).toBe(homeDirectory);
          expect(input.projectDirectory).toBe(projectDirectory);
          launchedProfiles.push(input.profileId);
          return Promise.resolve();
        },
      },
    );

    expect(launchedProfiles).toEqual(['project-lead']);
    expect(result.messages.join('\n')).not.toContain('outfitter --profile project-lead');
  });

  it('adds a local project profile source when setup-source settings omit profile sources', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');

    const result = await executeSetupCommand(
      { homeDirectory, projectDirectory, setupSourceUri: 'https://example.test/minimal-link-profiles' },
      {
        interactive: true,
        input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
        output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
        writeLine: () => undefined,
        setupSourceSynchronizer: {
          sync(_uri, cachePath) {
            const outfitterDirectory = join(cachePath, '.outfitter');
            const profileFolder = join(outfitterDirectory, 'profiles', 'project-lead');
            mkdirSync(profileFolder, { recursive: true });
            writeFileSync(join(outfitterDirectory, 'settings.yml'), 'default_profile: project-lead\n');
            writeFileSync(join(profileFolder, 'profile.yml'), 'id: project-lead\nlabel: Project Lead\ncontrols: {}\n');
          },
        },
        selectSetupSourceImportTarget() {
          return Promise.resolve('project');
        },
        selectDefaultProfile(profiles, currentDefault) {
          expect(currentDefault).toBe('project-lead');
          expect(profiles.map((profile) => profile.id)).toEqual(['project-lead']);
          return Promise.resolve('project-lead');
        },
      },
    );

    const projectSettings = readFileSync(join(projectDirectory, '.outfitter', 'settings.yml'), 'utf8');
    expect(result.settingsPath).toBe(join(projectDirectory, '.outfitter', 'settings.yml'));
    expect(projectSettings).toContain('default_profile: project-lead');
    expect(projectSettings).toContain('path: ./profiles');
  });

  it('does not promote a setup source default absent from source profile choices', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const setupSourceUri = 'https://example.test/link-profiles';

    writeSettings(homeDirectory, 'default_profile: engineer\nprofile_sources:\n  - path: ./profiles\n');

    const result = await executeSetupCommand(
      { homeDirectory, projectDirectory, setupSourceUri },
      {
        interactive: true,
        input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
        output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
        writeLine: () => undefined,
        setupSourceSynchronizer: {
          sync(_uri, cachePath) {
            const outfitterDirectory = join(cachePath, '.outfitter');
            mkdirSync(outfitterDirectory, { recursive: true });
            writeFileSync(
              join(outfitterDirectory, 'settings.yml'),
              'default_profile: unavailable\nprofile_sources:\n  - path: ./profiles\n',
            );

            for (const [profileId, label] of [
              ['project-lead', 'Project Lead'],
              ['engineer', 'Engineer'],
            ] as const) {
              const profileFolder = join(outfitterDirectory, 'profiles', profileId);
              mkdirSync(profileFolder, { recursive: true });
              writeFileSync(join(profileFolder, 'profile.yml'), `id: ${profileId}\nlabel: ${label}\ncontrols: {}\n`);
            }
          },
        },
        selectSetupSourceImportTarget(choices, defaultTarget) {
          expect(defaultTarget).toBe('home');
          expect(choices.map((choice) => choice.target)).toEqual(['home', 'project']);
          return Promise.resolve('home');
        },
        selectDefaultProfile(profiles, currentDefault) {
          expect(currentDefault).toBe('engineer');
          expect(profiles.map((profile) => profile.id)).toEqual(['engineer', 'project-lead']);
          return Promise.resolve('engineer');
        },
        selectWelcomePlan() {
          return Promise.resolve({ answerQuestions: false });
        },
      },
    );

    expect(result.messages).toContain("Selected default profile 'engineer'.");
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.1).
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
      join(fallbackHomeDirectory, '.outfitter', 'profiles', 'engineer', 'profile.yml'),
    );
    expect(readFileSync(join(fallbackHomeDirectory, '.outfitter', 'settings.yml'), 'utf8')).toContain(
      'default_profile: engineer',
    );

    const projectDefaultHomeDirectory = join(root, 'project-default-home');
    const projectDefaultDirectory = join(root, 'project-default');
    mkdirSync(join(projectDefaultDirectory, '.outfitter'), { recursive: true });
    writeFileSync(join(projectDefaultDirectory, '.outfitter', 'settings.yml'), 'default_profile: remote\n');
    const projectDefaultResult = await executeSetupCommand(
      {
        homeDirectory: projectDefaultHomeDirectory,
        projectDirectory: projectDefaultDirectory,
      },
      { synchronizer: defaultProfileSynchronizer },
    );
    expect(readFileSync(projectDefaultResult.settingsPath, 'utf8')).toContain('default_profile: engineer');
    expect(projectDefaultResult.defaultProfilePath).toBe(
      join(projectDefaultHomeDirectory, '.outfitter', 'profiles', 'engineer', 'profile.yml'),
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
    mkdirSync(join(invalidProjectDirectory, '.outfitter'), { recursive: true });
    writeFileSync(
      join(invalidProjectDirectory, '.outfitter', 'settings.yml'),
      'profile_sources:\n  - only: [remote]\n',
    );
    await expect(
      executeSetupCommand({ homeDirectory: invalidProjectHomeDirectory, projectDirectory: invalidProjectDirectory }),
    ).rejects.toThrow('Cannot setup with invalid settings');
    expect(existsSync(join(invalidProjectHomeDirectory, '.outfitter', 'settings.yml'))).toBe(false);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.4, OFTR-003.2, OFTR-004.1).
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

    const unsafeHomeDirectory = join(root, 'unsafe-home');
    writeSettings(unsafeHomeDirectory, 'default_profile: engineer\nprofile_sources:\n  - path: ./profiles\n');
    await expect(
      executeSetupCommand(
        { homeDirectory: unsafeHomeDirectory, projectDirectory },
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
    const unlistedHomeDirectory = join(root, 'unlisted-home');
    writeSettings(unlistedHomeDirectory, 'default_profile: engineer\nprofile_sources:\n  - path: ./profiles\n');
    await expect(
      executeSetupCommand(
        { homeDirectory: unlistedHomeDirectory, projectDirectory },
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

    writeSettings(homeDirectory, 'default_profile: engineer\nprofile_sources:\n  - path: ./profiles\n');
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
          expect(profiles.map((profile) => profile.id)).toEqual(['engineer', 'data_analyst']);
          return Promise.resolve('data_analyst');
        },
        selectWelcomePlan() {
          return Promise.resolve({ answerQuestions: false });
        },
      },
    );

    const dataAnalystProfilePath = join(homeDirectory, '.outfitter', 'profiles', 'data_analyst', 'profile.yml');
    expect(result.defaultProfilePath).toBe(dataAnalystProfilePath);
    expect(readFileSync(result.defaultProfilePath, 'utf8')).toBe('id: data_analyst\nlabel: Default\ncontrols: {}\n');
    expect(result.messages).toContain("Selected default profile 'data_analyst'.");
    expect(messages).toEqual([
      'Welcome to Outfitter. Outfitter is the easiest way to run Pi.',
      'Outfitter manages full pi configurations for you, so you can use different profiles in different situations.',
    ]);
    expect(readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8')).toContain(
      'default_profile: data_analyst',
    );
  });

  it('uses an injected welcome runner after interactive setup completes', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');

    const result = await executeSetupCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
        output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
        writeLine: () => undefined,
        synchronizer: defaultProfileSynchronizer,
        selectDefaultProfile() {
          return Promise.resolve('engineer');
        },
        runWelcome(input) {
          expect(input.projectDirectory).toBe(projectDirectory);
          return Promise.resolve({
            answered: false,
            warnings: [],
            messages: ['custom welcome runner'],
          });
        },
      },
    );

    expect(result.welcomeResult?.messages).toEqual(['custom welcome runner']);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.2, OFTR-010.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('runs welcome onboarding after interactive setup completes', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');

    const result = await executeSetupCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
        output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
        writeLine: () => undefined,
        synchronizer: defaultProfileSynchronizer,
        selectDefaultProfile() {
          return Promise.resolve('engineer');
        },
        selectWelcomePlan() {
          return Promise.resolve({
            answerQuestions: true,
            selectedRoleId: 'engineer',
            loadoutItemIds: ['deepwork'],
          });
        },
      },
    );

    expect(result.welcomeResult).toEqual({
      answered: true,
      selectedRole: { id: 'engineer', label: 'Engineer' },
      selectedLoadout: {
        id: 'recommended-pi',
        label: 'Recommended Pi productivity loadout',
        selectedItems: [
          {
            id: 'deepwork',
            label: 'DeepWork',
            kind: 'extension',
            source: 'git:github.com/ai-outfitter/deepwork',
          },
        ],
      },
      warnings: [],
      messages: [
        'Installed the founder profile. Use /outfitter inside Pi or run `outfitter profile list` to manage profiles.',
      ],
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('loads wizard choices from legacy URI and repository subpath sources', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const legacyUri = 'https://example.test/legacy-profiles.git';
    const repositoryUri = 'https://example.test/repository-profiles.git';
    const duplicateUri = 'https://example.test/duplicate-profiles.git';
    const githubSource = 'example/github-profiles';
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
        `  - github: ${githubSource}`,
        '    ref: main',
        '    path: profiles',
        '',
      ].join('\n'),
    );

    allowTestConsoleOutput(
      ({ method, text }) =>
        method === 'log' && (text.startsWith('Welcome to Outfitter') || text.startsWith('Outfitter manages')),
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
            } else if (source.uri === duplicateUri) {
              expect(cachePath).toBe(createRemoteRepositoryCachePath(homeDirectory, source));
              writeCachedProfile(join(cachePath, 'profiles'), 'repository');
            } else {
              expect(source.github).toBe(githubSource);
              expect(cachePath).toBe(createRemoteRepositoryCachePath(homeDirectory, source));
              writeCachedProfile(join(cachePath, 'profiles'), 'github');
            }

            return 'updated';
          },
        },
        selectDefaultProfile(profiles) {
          expect(profiles.map((profile) => profile.id)).toEqual(['github', 'legacy', 'repository']);
          expect(profiles.find((profile) => profile.id === 'repository')?.label).toBe('Repository');
          return Promise.resolve('repository');
        },
        selectWelcomePlan() {
          return Promise.resolve({ answerQuestions: false });
        },
      },
    );

    expect(result.messages).toContain("Selected default profile 'repository'.");
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('updates the effective default profile when duplicate settings keys are present', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const missingDefaultHomeDirectory = join(root, 'missing-default-home');
    const settingsPath = join(homeDirectory, '.outfitter', 'settings.yml');
    const missingDefaultSettingsPath = join(missingDefaultHomeDirectory, '.outfitter', 'settings.yml');
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

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('uses the readline setup prompt when no default-profile selector dependency is injected', async () => {
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
        selectWelcomePlan() {
          return Promise.resolve({ answerQuestions: false });
        },
      },
    );

    expect(result.messages).toContain("Selected default profile 'solo'.");
    expect(messages[0]).toContain('Welcome to Outfitter');
    expect(readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8')).toContain('default_profile: solo');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects out-of-range readline setup prompt selections', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const profilesDirectory = join(homeDirectory, '.outfitter', 'profiles');
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
