// Tests profile command behavior.
import { existsSync, mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createProfileCommands,
  executeCreateProfileCommand,
  executeListProfilesCommand,
} from '../../src/cli/commands/profile/Command.js';
import { createSetupCommand } from '../../src/cli/commands/SetupCommand.js';
import { createSyncCommand } from '../../src/cli/commands/SyncCommand.js';
import { createProfileSourceCachePath, createRemoteRepositoryCachePath } from '../../src/profiles/ProfileCache.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-profile-command-'));
  temporaryRoots.push(root);
  return root;
};

const writeSettings = (homeDirectory: string, content: string): void => {
  const settingsDirectory = join(homeDirectory, '.outfitter');
  mkdirSync(settingsDirectory, { recursive: true });
  writeFileSync(join(settingsDirectory, 'settings.yml'), content);
};

const writeProfile = (profilesRoot: string, id: string, content = `id: ${id}\ncontrols: {}\n`): void => {
  const profileDirectory = join(profilesRoot, id);
  mkdirSync(profileDirectory, { recursive: true });
  writeFileSync(join(profileDirectory, 'profile.yml'), content);
};

const registerProfileCommands = (
  program: Command,
  dependencies: Parameters<typeof createProfileCommands>[0] = {},
): void => {
  for (const command of createProfileCommands(dependencies)) {
    command.register(program);
  }
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('profile command', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('creates placeholder profiles by scope or path under profile create', async () => {
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
    expect(existsSync(join(byScope.profileDirectory, 'cli_specific', 'claude'))).toBe(true);
    expect(byProject.profileDirectory).toBe(join(projectDirectory, '.outfitter', 'profiles', 'project-profile'));
    expect(byProjectLocal.profileDirectory).toBe(
      join(projectDirectory, '.outfitter', 'local', 'profiles', 'local-profile'),
    );
    expect(byPath.profileDirectory).toBe(join(customRoot, 'research'));

    writeFileSync(byPath.profilePath, 'id: research\nlabel: Existing\n');
    expect(
      executeCreateProfileCommand({ name: 'research', path: customRoot, homeDirectory, projectDirectory })
        .createdProfile,
    ).toBe(false);

    const messages: string[] = [];
    const program = new Command();
    registerProfileCommands(program, {
      homeDirectory,
      projectDirectory,
      writeLine: (message) => messages.push(message),
    });
    await program.parseAsync(['node', 'outfitter', 'profile', 'create', 'valid', '--path', join(root, 'cli-profiles')]);

    expect(messages).toContainEqual(expect.stringContaining("Created profile 'valid'"));
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.3, OFTR-004.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects invalid profile create inputs and missing command arguments', async () => {
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

    const program = new Command();
    registerProfileCommands(program, { homeDirectory, projectDirectory, writeLine: () => undefined });
    await program.parseAsync(['node', 'outfitter', 'profile', 'create', 'scoped', '--scope', 'user']);
    expect(existsSync(join(homeDirectory, '.outfitter', 'profiles', 'scoped', 'profile.yml'))).toBe(true);
    await expect(
      program.parseAsync(['node', 'outfitter', 'profile', 'create', 'valid', '--scope', 'invalid']),
    ).rejects.toThrow("Unknown profile scope 'invalid'");

    const missingNameProgram = new Command();
    registerProfileCommands(missingNameProgram, { homeDirectory, projectDirectory });
    const profileCreateCommand = missingNameProgram.commands[0]?.commands.find(
      (command) => command.name() === 'create',
    );
    profileCreateCommand?.exitOverride();
    profileCreateCommand?.configureOutput({ writeErr: () => undefined });
    await expect(
      missingNameProgram.parseAsync(['node', 'outfitter', 'profile', 'create', '--scope', 'user']),
    ).rejects.toThrow("missing required argument 'name'");
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('wires setup and sync command actions to command object executors', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const syncMessages: string[] = [];
    const syncProgram = new Command();
    writeSettings(homeDirectory, 'default_profile: default\n');
    createSyncCommand({ homeDirectory, projectDirectory, writeLine: (message) => syncMessages.push(message) }).register(
      syncProgram,
    );
    await syncProgram.parseAsync(['node', 'outfitter', 'sync']);
    expect(syncMessages).toEqual(['No URI profile or remote settings sources configured; nothing to sync.']);

    const setupMessages: string[] = [];
    const setupProgram = new Command();
    createSetupCommand({
      homeDirectory: join(root, 'setup-home'),
      projectDirectory,
      input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
      output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
      writeLine: (message) => setupMessages.push(message),
      synchronizer: {
        sync(_source, cachePath) {
          mkdirSync(join(cachePath, 'profiles', 'engineer'), { recursive: true });
          writeFileSync(join(cachePath, 'profiles', 'engineer', 'profile.yml'), 'id: engineer\ncontrols: {}\n');
          return 'updated';
        },
      },
      selectDefaultProfile() {
        return Promise.resolve('engineer');
      },
      selectWelcomePlan() {
        return Promise.resolve({ answerQuestions: false });
      },
    }).register(setupProgram);
    await setupProgram.parseAsync(['node', 'outfitter', 'setup']);
    expect(setupMessages).not.toContain('Welcome to Outfitter. Outfitter is the easiest way to run Pi.');
    expect(setupMessages).toContainEqual(expect.stringContaining('Created user settings'));
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('lists unique profiles from configured local and cached remote sources', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const localProfiles = join(homeDirectory, '.outfitter', 'profiles');
    const remoteSource = { github: 'example/team-profiles', ref: 'main', path: 'profiles' };
    const uri = 'https://example.test/plain-profiles.git';
    const remoteProfiles = join(createRemoteRepositoryCachePath(homeDirectory, remoteSource), 'profiles');
    const uriProfiles = createProfileSourceCachePath(homeDirectory, uri);
    writeSettings(
      homeDirectory,
      [
        'profile_sources:',
        '  - path: ./profiles',
        '  - github: example/team-profiles',
        '    ref: main',
        '    path: profiles',
        `  - uri: ${uri}`,
        '',
      ].join('\n'),
    );
    writeProfile(localProfiles, 'engineering', 'id: engineering\nlabel: User Engineering\ncontrols: {}\n');
    writeProfile(localProfiles, 'research');
    writeProfile(remoteProfiles, 'engineering', 'id: engineering\nlabel: Remote Engineering\ncontrols: {}\n');
    writeProfile(remoteProfiles, 'support');
    writeProfile(uriProfiles, 'plain-uri');

    const result = executeListProfilesCommand({ homeDirectory, projectDirectory });

    expect(result.profiles.map((profile) => profile.id)).toEqual(['engineering', 'plain-uri', 'research', 'support']);
    expect(result.profiles.find((profile) => profile.id === 'engineering')?.label).toBe('Remote Engineering');
    expect(result.messages).toEqual(['engineering', 'plain-uri', 'research', 'support']);

    const messages: string[] = [];
    const program = new Command();
    registerProfileCommands(program, {
      homeDirectory,
      projectDirectory,
      writeLine: (message) => messages.push(message),
    });
    await program.parseAsync(['node', 'outfitter', 'profile', 'list']);
    expect(messages).toEqual(['engineering', 'plain-uri', 'research', 'support']);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('reports empty profile lists and invalid list inputs', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(homeDirectory, 'profile_sources: []\n');

    expect(executeListProfilesCommand({ homeDirectory, projectDirectory }).messages).toEqual(['No profiles found.']);

    writeSettings(homeDirectory, 'profile_sources:\n  - only: [bad]\n');
    expect(() => executeListProfilesCommand({ homeDirectory, projectDirectory })).toThrow(
      'Cannot list profiles with invalid settings',
    );

    writeSettings(homeDirectory, 'profile_sources:\n  - path: ./missing\n');
    expect(() => executeListProfilesCommand({ homeDirectory, projectDirectory })).toThrow(
      'Cannot list profiles with invalid profiles',
    );
  });
});
