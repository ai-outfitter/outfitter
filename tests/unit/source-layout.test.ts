// Tests the initial source layout scaffolding for Bridl modules.
import { readFileSync } from 'node:fs';

import type { AnySchema } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';

import { createPiAdapter } from '../../src/agents/pi/PiAdapter.js';
import { createPiTackPaths } from '../../src/agents/pi/PiTackWriter.js';
import { createBridlProgram, createDefaultCommands } from '../../src/cli/BridlCli.js';
import { describeCommandObject } from '../../src/cli/commands/CommandObject.js';
import { createCreateProfileCommand } from '../../src/cli/commands/CreateProfileCommand.js';
import { createRunCommand } from '../../src/cli/commands/RunCommand.js';
import { createSetupCommand } from '../../src/cli/commands/SetupCommand.js';
import { createSyncCommand } from '../../src/cli/commands/SyncCommand.js';
import { createEmptyProfile } from '../../src/profiles/Profile.js';
import { createProfileLoadPlan } from '../../src/profiles/ProfileLoader.js';
import { mergeProfileStack } from '../../src/profiles/ProfileMerger.js';
import { createLocalProfileSource, createUriProfileSource } from '../../src/profiles/ProfileSource.js';
import { profileSchemaDocument, profileSourceSchemaDocument, settingsSchemaDocument } from '../../src/schemas/SchemaDocument.js';
import { emptySettings } from '../../src/settings/Settings.js';
import { createSettingsLoadPlan } from '../../src/settings/SettingsLoader.js';
import { mergeSettingsStack } from '../../src/settings/SettingsMerger.js';
import { createTack } from '../../src/tack/Tack.js';
import { assembleTack } from '../../src/tack/TackAssembler.js';
import { createTackFile } from '../../src/tack/TackFile.js';
import { createTackWatchPlan } from '../../src/tack/TackWatcher.js';
import { createValidationResult } from '../../src/validation/SchemaValidator.js';

const readJson = <T>(relativePath: string): T =>
  JSON.parse(readFileSync(new URL(relativePath, import.meta.url), 'utf8')) as T;

describe('source layout scaffolding', () => {
  // THIS TEST VALIDATES COMMAND-AVAILABILITY CLAUSES IN HARD REQUIREMENTS (BRIDL-REQ-004.1, BRIDL-REQ-004.2, BRIDL-REQ-004.3, BRIDL-REQ-005.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('exposes focused command objects for the initial CLI commands', () => {
    const commands = createDefaultCommands();
    const program = createBridlProgram(commands);

    expect(commands.map((command) => command.name)).toEqual(['run', 'setup', 'sync', 'create_profile']);
    expect(program.commands.map((command) => command.name())).toEqual(['run', 'setup', 'sync', 'create_profile']);
    expect(program.commands.at(3)?.aliases()).toEqual(['create-profile']);
    expect(describeCommandObject(createRunCommand())).toEqual({
      name: 'run',
      description: 'Assemble a profile tack and launch the selected agent CLI.',
    });

    const standaloneProgram = new Command();
    createSetupCommand().register(standaloneProgram);
    createSyncCommand().register(standaloneProgram);
    createCreateProfileCommand().register(standaloneProgram);

    expect(standaloneProgram.commands.map((command) => command.name())).toEqual([
      'setup',
      'sync',
      'create_profile',
    ]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-002.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('validates profile source entries with exactly one source location', () => {
    const ajv = new Ajv2020();
    const profileSourceSchema = readJson<AnySchema>('../../src/schemas/profile-source.schema.json');
    const validate = ajv.compile(profileSourceSchema);

    expect(validate({ path: './profiles' })).toBe(true);
    expect(validate({ uri: 'git+https://example.test/profiles.git' })).toBe(true);
    expect(validate({ path: './profiles', uri: 'git+https://example.test/profiles.git' })).toBe(false);
    expect(validate({ only: ['engineering'] })).toBe(false);
  });

  it('defines settings and profile source scaffolding boundaries', () => {
    const localSource = createLocalProfileSource('./profiles');
    const uriSource = createUriProfileSource('git+https://example.test/profiles.git');
    const settings = emptySettings();
    const mergedSettings = mergeSettingsStack([
      settings,
      { defaultProfile: 'engineering', profileSources: [localSource] },
    ]);
    const settingsLoadPlan = createSettingsLoadPlan([
      { scope: 'user', path: '~/.bridl/settings.yml' },
      { scope: 'project', path: '.bridl/settings.yml' },
      { scope: 'project-local', path: '.bridl/local/settings.yml' },
    ]);
    const profileLoadPlan = createProfileLoadPlan([localSource, uriSource]);

    expect(mergedSettings.defaultProfile).toBe('engineering');
    expect(mergedSettings.profileSources).toEqual([localSource]);
    expect(settingsLoadPlan.locations.map((location) => location.scope)).toEqual([
      'user',
      'project',
      'project-local',
    ]);
    expect(profileLoadPlan.sources).toEqual([localSource, uriSource]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-003.6).
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

  // THIS TEST VALIDATES A HARD REQUIREMENT (BRIDL-REQ-006.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('creates a pi launch plan using PI_CODING_AGENT_DIR as the configuration boundary', () => {
    const tackRoot = 'bridl-tack-root';
    const tack = createTack(tackRoot, []);
    const launchPlan = createPiAdapter().createLaunchPlan(tack);
    const piPaths = createPiTackPaths(tack.rootDirectory);

    expect(launchPlan).toEqual({
      command: 'pi',
      args: [],
      env: { PI_CODING_AGENT_DIR: tackRoot },
    });
    expect(piPaths.agentDirectory).toBe(tackRoot);
  });

  it('defines tack, schema, and validation scaffolding boundaries', () => {
    const tackFile = createTackFile('SYSTEM.md', 'hello');
    const tack = createTack('bridl-tack-root', [tackFile]);
    const assembledTack = assembleTack({ rootDirectory: tack.rootDirectory, files: tack.files });
    const watchPlan = createTackWatchPlan(['profile.yml']);

    expect(assembledTack.files).toEqual([tackFile]);
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
