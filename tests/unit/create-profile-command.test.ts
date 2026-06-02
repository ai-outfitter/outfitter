// Tests create-profile command behavior.
import { existsSync, mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Command } from 'commander';
import { afterEach, describe, expect, it } from 'vitest';

import {
  executeCreateProfileCommand,
  createCreateProfileCommand,
} from '../../src/cli/commands/CreateProfileCommand.js';
import { createSetupCommand } from '../../src/cli/commands/SetupCommand.js';
import { createSyncCommand } from '../../src/cli/commands/SyncCommand.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'bridl-create-profile-command-'));
  temporaryRoots.push(root);
  return root;
};

const writeSettings = (homeDirectory: string, content: string): void => {
  const settingsDirectory = join(homeDirectory, '.bridl');
  mkdirSync(settingsDirectory, { recursive: true });
  writeFileSync(join(settingsDirectory, 'settings.yml'), content);
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('create-profile command', () => {
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
    expect(existsSync(join(byScope.profileDirectory, 'cli_specific', 'claude'))).toBe(true);
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
    missingNameProgram.configureOutput({ writeErr: () => undefined });
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
    expect(syncMessages).toEqual(['No URI profile or remote settings sources configured; nothing to sync.']);

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
