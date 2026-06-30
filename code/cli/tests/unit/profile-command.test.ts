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
  executeProfileLintCommand,
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

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.4).
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

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.7, OFTR-004.5).
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
    writeProfile(localProfiles, 'shared-prose', 'id: shared-prose\ntemplate: true\ncontrols: {}\n');
    writeProfile(remoteProfiles, 'engineering', 'id: engineering\nlabel: Remote Engineering\ncontrols: {}\n');
    writeProfile(remoteProfiles, 'support');
    writeProfile(uriProfiles, 'plain-uri');

    const result = executeListProfilesCommand({ homeDirectory, projectDirectory });
    const allResult = executeListProfilesCommand({ homeDirectory, projectDirectory, includeTemplates: true });

    expect(result.profiles.map((profile) => profile.id)).toEqual(['engineering', 'plain-uri', 'research', 'support']);
    expect(result.profiles.find((profile) => profile.id === 'engineering')?.label).toBe('Remote Engineering');
    expect(result.profiles.every((profile) => !profile.template)).toBe(true);
    expect(result.messages).toEqual(['engineering', 'plain-uri', 'research', 'support']);
    expect(allResult.profiles.map((profile) => profile.id)).toEqual([
      'engineering',
      'plain-uri',
      'research',
      'shared-prose',
      'support',
    ]);
    expect(allResult.profiles.find((profile) => profile.id === 'shared-prose')?.template).toBe(true);
    expect(allResult.messages).toContain('shared-prose (template)');

    const messages: string[] = [];
    const program = new Command();
    registerProfileCommands(program, {
      homeDirectory,
      projectDirectory,
      writeLine: (message) => messages.push(message),
    });
    await program.parseAsync(['node', 'outfitter', 'profile', 'list']);
    expect(messages).toEqual(['engineering', 'plain-uri', 'research', 'support']);

    const allMessages: string[] = [];
    const allProgram = new Command();
    registerProfileCommands(allProgram, {
      homeDirectory,
      projectDirectory,
      writeLine: (message) => allMessages.push(message),
    });
    await allProgram.parseAsync(['node', 'outfitter', 'profile', 'list', '--all']);
    expect(allMessages).toContain('shared-prose (template)');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.1, OFTR-003.4, OFTR-003.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('lints profile schema, inheritance, and prompt include diagnostics with strict warnings', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const profilesRoot = join(homeDirectory, '.outfitter', 'profiles');
    writeSettings(homeDirectory, 'profile_sources:\n  - path: ./profiles\n');
    writeProfile(
      profilesRoot,
      'engineer',
      'id: engineer\ninherits:\n  - missing\ncontrols:\n  append_system_prompt:\n    - file: prompts/missing.md\n    - ./prompts/raw.md\n',
    );

    const result = executeProfileLintCommand({ homeDirectory, projectDirectory, strict: true });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual(
      expect.arrayContaining([
        "Profile 'missing' was not found.",
        "Prompt file include 'prompts/missing.md' was not found.",
        "Raw append_system_prompt entry looks like a file path; use { file: './prompts/raw.md' }.",
      ]),
    );
    expect(
      result.diagnostics.filter((diagnostic) =>
        diagnostic.message.includes("Prompt file include 'prompts/missing.md' was not found."),
      ),
    ).toHaveLength(1);
  });

  it('lints prompt includes once when adapter-specific controls are present', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const profilesRoot = join(homeDirectory, '.outfitter', 'profiles');
    writeSettings(homeDirectory, 'profile_sources:\n  - path: ./profiles\n');
    writeProfile(
      profilesRoot,
      'engineer',
      [
        'id: engineer',
        'controls:',
        '  append_system_prompt:',
        '    file: prompts/missing.md',
        '  pi:',
        '    append_system_prompt:',
        '      file: prompts/pi-missing.md',
        '  claude:',
        '    append_system_prompt:',
        '      file: prompts/claude-missing.md',
        '',
      ].join('\n'),
    );

    const result = executeProfileLintCommand({ homeDirectory, projectDirectory });

    expect(result.diagnostics.map((diagnostic) => diagnostic.message)).toEqual([
      "Prompt file include 'prompts/missing.md' was not found.",
      "Prompt file include 'prompts/pi-missing.md' was not found.",
      "Prompt file include 'prompts/claude-missing.md' was not found.",
    ]);
  });

  it('exits non-zero for warning-only profile lint diagnostics in strict mode', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const profilesRoot = join(homeDirectory, '.outfitter', 'profiles');
    writeSettings(homeDirectory, 'profile_sources:\n  - path: ./profiles\n');
    writeProfile(
      profilesRoot,
      'engineer',
      'id: engineer\ncontrols:\n  append_system_prompt:\n    - ./prompts/raw.md\n',
    );

    const result = executeProfileLintCommand({ homeDirectory, projectDirectory, strict: true });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics).toEqual(
      expect.arrayContaining([
        {
          severity: 'warning',
          path: join(profilesRoot, 'engineer', 'profile.yml') + '#/controls/append_system_prompt/0',
          message: "Raw append_system_prompt entry looks like a file path; use { file: './prompts/raw.md' }.",
        },
      ]),
    );
  });

  it('prints profile lint diagnostics in human and JSON formats', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const profilesRoot = join(homeDirectory, '.outfitter', 'profiles');
    const messages: string[] = [];
    writeSettings(homeDirectory, 'profile_sources:\n  - path: ./profiles\n');
    writeProfile(profilesRoot, 'engineer', 'id: engineer\ncontrols:\n  unsupported_control: true\n');

    const program = new Command();
    registerProfileCommands(program, {
      homeDirectory,
      projectDirectory,
      writeLine: (message) => messages.push(message),
    });
    await program.parseAsync(['node', 'outfitter', 'profile', 'lint', '--json']);

    expect(JSON.parse(messages[0] ?? '[]')).toEqual([
      {
        severity: 'warning',
        path: '/profiles/engineer',
        message: "pi adapter cannot translate requested control 'unsupported_control'.",
      },
    ]);

    const humanMessages: string[] = [];
    const humanProgram = new Command();
    registerProfileCommands(humanProgram, {
      homeDirectory,
      projectDirectory,
      writeLine: (message) => humanMessages.push(message),
    });
    await humanProgram.parseAsync(['node', 'outfitter', 'profile', 'lint']);
    expect(humanMessages).toEqual([
      "warning: /profiles/engineer pi adapter cannot translate requested control 'unsupported_control'.",
    ]);

    const consoleMessages: string[] = [];
    const originalCwd = process.cwd();
    const originalConsoleLog = console.log;
    const defaultProjectDirectory = join(root, 'default-project');
    mkdirSync(defaultProjectDirectory, { recursive: true });
    console.log = (message?: unknown) => consoleMessages.push(String(message));
    try {
      process.chdir(defaultProjectDirectory);
      const defaultWriterProgram = new Command();
      registerProfileCommands(defaultWriterProgram, { homeDirectory });
      await defaultWriterProgram.parseAsync(['node', 'outfitter', 'profile', 'lint']);
    } finally {
      process.chdir(originalCwd);
      console.log = originalConsoleLog;
    }
    expect(consoleMessages).toEqual([
      "warning: /profiles/engineer pi adapter cannot translate requested control 'unsupported_control'.",
    ]);

    const cleanMessages: string[] = [];
    const cleanHomeDirectory = join(root, 'clean-home');
    const cleanProfilesRoot = join(cleanHomeDirectory, '.outfitter', 'profiles');
    writeSettings(cleanHomeDirectory, 'profile_sources:\n  - path: ./profiles\n');
    writeProfile(cleanProfilesRoot, 'engineer');
    const cleanProgram = new Command();
    registerProfileCommands(cleanProgram, {
      homeDirectory: cleanHomeDirectory,
      projectDirectory,
      writeLine: (message) => cleanMessages.push(message),
    });
    await cleanProgram.parseAsync(['node', 'outfitter', 'profile', 'lint']);

    expect(cleanMessages).toEqual(['No profile lint diagnostics.']);
  });

  it('lints flat profiles without profile resource roots', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const profilesRoot = join(homeDirectory, '.outfitter', 'profiles');
    mkdirSync(profilesRoot, { recursive: true });
    writeSettings(homeDirectory, 'profile_sources:\n  - path: ./profiles\n');
    writeFileSync(join(profilesRoot, 'engineer.yml'), 'id: engineer\ncontrols:\n  unsupported_control: true\n');

    const result = executeProfileLintCommand({ homeDirectory, projectDirectory });

    expect(result.diagnostics).toEqual([
      {
        severity: 'warning',
        path: '/profiles/engineer',
        message: "pi adapter cannot translate requested control 'unsupported_control'.",
      },
    ]);
  });

  it('reports settings errors from profile lint', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(homeDirectory, 'profile_sources:\n  - only: [bad]\n');

    const result = executeProfileLintCommand({ homeDirectory, projectDirectory });

    expect(result.exitCode).toBe(1);
    expect(result.diagnostics[0]?.severity).toBe('error');
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
