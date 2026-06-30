// Tests source layout, command registration, schemas, and small boundary helpers.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AnySchema } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { createClaudeAdapter } from '../../src/agents/claude/ClaudeAdapter.js';
import { createClaudeCompositeProfilePaths } from '../../src/agents/claude/ClaudeCompositeProfileWriter.js';
import { createPiAdapter } from '../../src/agents/pi/PiAdapter.js';
import { createPiCompositeProfilePaths } from '../../src/agents/pi/PiCompositeProfileWriter.js';
import { createOutfitterProgram, createDefaultCommands } from '../../src/cli/OutfitterCli.js';
import { describeCommandObject } from '../../src/cli/commands/CommandObject.js';
import { createProfileCommands } from '../../src/cli/commands/profile/Command.js';
import { createRunCommand } from '../../src/cli/commands/RunCommand.js';
import { createSetupCommand } from '../../src/cli/commands/SetupCommand.js';
import { createSyncCommand } from '../../src/cli/commands/SyncCommand.js';
import { createWelcomeCommand } from '../../src/cli/commands/WelcomeCommand.js';
import { createEmptyProfile } from '../../src/profiles/Profile.js';
import { createProfileLoadPlan } from '../../src/profiles/ProfileLoader.js';
import { mergeProfileStack } from '../../src/profiles/ProfileMerger.js';
import {
  createLocalProfileSource,
  createUriProfileSource,
  normalizeRemoteSourceUri,
} from '../../src/profiles/ProfileSource.js';
import {
  profileSchemaDocument,
  profileSourceSchemaDocument,
  settingsSchemaDocument,
} from '../../src/schemas/SchemaDocument.js';
import { emptySettings } from '../../src/settings/Settings.js';
import { createSettingsLoadPlan } from '../../src/settings/SettingsLoader.js';
import { mergeSettingsStack } from '../../src/settings/SettingsMerger.js';
import { createCompositeProfile } from '../../src/compositeProfile/CompositeProfile.js';
import { assembleCompositeProfile } from '../../src/compositeProfile/CompositeProfileAssembler.js';
import { createCompositeProfileFile } from '../../src/compositeProfile/CompositeProfileFile.js';
import { createCompositeProfileWatchPlan } from '../../src/compositeProfile/CompositeProfileWatcher.js';
import { createValidationResult } from '../../src/validation/SchemaValidator.js';

const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as T;

const repositoryRoot = fileURLToPath(new URL('../..', import.meta.url));
const builtInOutfitterSkill = join(repositoryRoot, 'skills', 'outfitter');

describe('source layout scaffolding', () => {
  // THIS TEST VALIDATES COMMAND-AVAILABILITY CLAUSES IN HARD REQUIREMENTS (OFTR-004.1, OFTR-004.2, OFTR-004.3, OFTR-005.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('exposes focused command objects for the initial CLI commands', () => {
    const commands = createDefaultCommands();
    const program = createOutfitterProgram(commands);

    expect(commands.map((command) => command.name)).toEqual([
      'run',
      'setup',
      'sync',
      'welcome',
      'profile',
      'profile list',
      'profile create',
    ]);
    expect(program.commands.map((command) => command.name())).toEqual(['run', 'setup', 'sync', 'welcome', 'profile']);
    expect(program.commands.at(4)?.commands.map((command) => command.name())).toEqual(['list', 'create']);
    expect(describeCommandObject(createRunCommand())).toEqual({
      name: 'run',
      description: 'Assemble a profile compositeProfile and launch the selected agent CLI.',
    });

    const standaloneProgram = new Command();
    createSetupCommand().register(standaloneProgram);
    createSyncCommand().register(standaloneProgram);
    createWelcomeCommand().register(standaloneProgram);
    for (const command of createProfileCommands()) {
      command.register(standaloneProgram);
    }

    expect(standaloneProgram.commands.map((command) => command.name())).toEqual([
      'setup',
      'sync',
      'welcome',
      'profile',
    ]);
    expect(standaloneProgram.commands.at(3)?.commands.map((command) => command.name())).toEqual(['list', 'create']);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('validates profile source entries for local, URI, and GitHub source locations', () => {
    const ajv = new Ajv2020();
    const profileSourceSchema = readJson<AnySchema>('../../src/schemas/profile-source.schema.json');
    const validate = ajv.compile(profileSourceSchema);

    expect(validate({ path: './profiles' })).toBe(true);
    expect(validate({ uri: 'git+https://example.test/profiles.git' })).toBe(true);
    expect(validate({ uri: 'git+https://example.test/profiles.git', path: 'profiles/team', ref: 'main' })).toBe(true);
    expect(validate({ github: 'example/outfitter-config', path: 'profiles' })).toBe(true);
    expect(validate({ path: './profiles', ref: 'main' })).toBe(false);
    expect(validate({ uri: 'git+https://example.test/profiles.git', github: 'example/profiles' })).toBe(false);
    expect(validate({ only: ['engineering'] })).toBe(false);
  });

  it('defines settings and profile source scaffolding boundaries', () => {
    const localSource = createLocalProfileSource('./profiles');
    const uriSource = createUriProfileSource('git+https://example.test/profiles.git');
    const settings = emptySettings();
    const mergedSettings = mergeSettingsStack([
      settings,
      { defaultProfile: 'remote', profileSources: [uriSource], remoteSettings: [] },
      { defaultProfile: 'engineering', profileSources: [localSource], remoteSettings: [] },
    ]);
    const settingsLoadPlan = createSettingsLoadPlan([
      { scope: 'user', path: '~/.outfitter/settings.yml' },
      { scope: 'project', path: '.outfitter/settings.yml' },
      { scope: 'project-local', path: '.outfitter/local/settings.yml' },
    ]);
    const profileLoadPlan = createProfileLoadPlan([localSource, uriSource]);

    expect(mergedSettings.defaultProfile).toBe('engineering');
    expect(mergedSettings.profileSources).toEqual([localSource]);
    expect(
      mergeSettingsStack([
        {
          defaultProfile: 'remote',
          profileSources: [uriSource],
          remoteSettings: [{ github: 'example/remote', path: 'settings.yml' }],
        },
        { profileSources: [], remoteSettings: [] },
      ]),
    ).toEqual({
      profileSources: [],
      remoteSettings: [],
      defaultProfile: 'remote',
      defaultAgent: undefined,
      cacheDirectory: undefined,
      customSettings: {},
      profileExport: undefined,
      startup: {},
    });
    expect(normalizeRemoteSourceUri({ github: 'example/outfitter-config' })).toBe(
      'git+https://github.com/example/outfitter-config.git',
    );
    expect(settingsLoadPlan.locations.map((location) => location.scope)).toEqual(['user', 'project', 'project-local']);
    expect(profileLoadPlan.sources).toEqual([localSource, uriSource]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-003.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('merges profile layers deterministically with higher-precedence values winning', () => {
    const baseProfile = createEmptyProfile('base');
    const mergedProfile = mergeProfileStack([
      baseProfile,
      { id: 'engineering', label: 'Engineering', inherits: ['base'], controls: { model: 'pi/default' } },
    ]);

    expect(mergedProfile.id).toBe('engineering');
    expect(mergedProfile.inherits).toEqual(['base']);
    expect(mergedProfile.controls.model).toBe('pi/default');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3, OFTR-006.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('creates pi and Claude Code launch plans using native config directory boundaries', () => {
    const compositeProfileRoot = 'outfitter-compositeProfile-root';
    const compositeProfile = createCompositeProfile(compositeProfileRoot, []);
    const launchPlan = createPiAdapter().createLaunchPlan(compositeProfile);
    const claudeLaunchPlan = createClaudeAdapter().createLaunchPlan(compositeProfile);
    const piPaths = createPiCompositeProfilePaths(compositeProfile.rootDirectory);
    const claudePaths = createClaudeCompositeProfilePaths(compositeProfile.rootDirectory);

    expect(launchPlan).toEqual({
      command: 'pi',
      args: ['--skill', builtInOutfitterSkill],
      env: { PI_CODING_AGENT_DIR: compositeProfileRoot },
    });
    expect(claudeLaunchPlan).toEqual({
      command: 'claude',
      args: [],
      env: { CLAUDE_CONFIG_DIR: compositeProfileRoot },
    });
    expect(piPaths.agentDirectory).toBe(compositeProfileRoot);
    expect(claudePaths.configDirectory).toBe(compositeProfileRoot);
  });

  it('defines compositeProfile, schema, and validation scaffolding boundaries', () => {
    const compositeProfileFile = createCompositeProfileFile('SYSTEM.md', 'hello');
    const compositeProfile = createCompositeProfile('outfitter-compositeProfile-root', [compositeProfileFile]);
    const assembledCompositeProfile = assembleCompositeProfile({
      rootDirectory: compositeProfile.rootDirectory,
      files: compositeProfile.files,
    });
    const watchPlan = createCompositeProfileWatchPlan(['profile.yml']);

    expect(assembledCompositeProfile.files).toEqual([compositeProfileFile]);
    expect(watchPlan.paths).toEqual(['profile.yml']);
    expect(settingsSchemaDocument.id).toBe('settings');
    expect(profileSchemaDocument.id).toBe('profile');
    expect(profileSourceSchemaDocument.id).toBe('profile-source');
    expect(createValidationResult([])).toEqual({ valid: true, issues: [] });
    expect(createValidationResult([{ path: '/name', message: 'Required' }])).toEqual({
      valid: false,
      issues: [{ path: '/name', message: 'Required' }],
    });
  });
});
