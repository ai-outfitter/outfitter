/* eslint-disable max-lines */
// Tests first-run welcome choices affecting the launched profile.
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { persistFirstRunWelcomeProfile } from '../../src/cli/commands/FirstRunWelcomeProfile.js';
import { executeRunCommand } from '../../src/cli/commands/RunCommand.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-first-run-welcome-'));
  temporaryRoots.push(root);
  return root;
};

const writeDefaultProfile = (
  profilesDirectory: string,
  profileId: string,
  extensions: readonly string[] = [],
): void => {
  const profileDirectory = join(profilesDirectory, profileId);
  mkdirSync(profileDirectory, { recursive: true });
  const extensionLines =
    extensions.length === 0
      ? ['    extensions: []']
      : ['    extensions:', ...extensions.map((extension) => `      - ${extension}`)];
  writeFileSync(
    join(profileDirectory, 'profile.yml'),
    [
      `id: ${profileId}`,
      `label: ${profileId}`,
      'controls:',
      '  pi:',
      ...extensionLines,
      '  append_system_prompt: |',
      `    Default ${profileId} prompt.`,
      '',
    ].join('\n'),
  );
  mkdirSync(join(profileDirectory, 'cli_specific', 'pi', 'deepwork', 'jobs', profileId), { recursive: true });
  writeFileSync(
    join(profileDirectory, 'cli_specific', 'pi', 'deepwork', 'jobs', profileId, 'job.yml'),
    `name: ${profileId}\nworkflows: {}\n`,
  );
  mkdirSync(join(profileDirectory, 'cli_specific', 'pi', 'skills', 'demos'), { recursive: true });
  writeFileSync(
    join(profileDirectory, 'cli_specific', 'pi', 'skills', 'demos', 'SKILL.md'),
    '---\nname: demos\ndescription: Demo runner\n---\n',
  );
};

const defaultProfileSynchronizer = {
  sync(_source: unknown, cachePath: string) {
    const profilesDirectory = join(cachePath, 'profiles');
    writeDefaultProfile(profilesDirectory, 'engineer', ['git:github.com/ai-outfitter/deepwork']);
    writeDefaultProfile(profilesDirectory, 'data_analyst', [
      'git:github.com/nhorton/pi-pr-alerts',
      'git:github.com/ai-outfitter/deepwork',
      'npm:pi-subagents',
    ]);
    writeDefaultProfile(profilesDirectory, 'analysis');
    return 'updated' as const;
  },
};

const engineerOnlySynchronizer = {
  sync(_source: unknown, cachePath: string) {
    writeDefaultProfile(join(cachePath, 'profiles'), 'engineer', ['git:github.com/ai-outfitter/deepwork']);
    return 'updated' as const;
  },
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('first-run welcome profile', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-004.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('leaves first-run welcome opt-out on the generated role profile before launching pi', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const launches: unknown[] = [];

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
        output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
        synchronizer: defaultProfileSynchronizer,
        writeLine: () => undefined,
        selectDefaultProfile() {
          throw new Error('first-run setup should let welcome choose the profile');
        },
        selectWelcomePlan() {
          return Promise.resolve({ answerQuestions: false });
        },
        launcher: {
          launch(plan) {
            launches.push(plan);
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(result.profileId).toBe('engineer');
    expect(launches).toHaveLength(1);
    expect(readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8')).toContain(
      'default_profile: engineer',
    );
    expect(readFileSync(join(homeDirectory, '.outfitter', 'profiles', 'engineer', 'profile.yml'), 'utf8')).toBe(
      'id: engineer\nlabel: Default\ncontrols: {}\n',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.2, OFTR-010.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('persists first-run welcome role selection with no loadout items before launching pi', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
        output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
        synchronizer: defaultProfileSynchronizer,
        writeLine: () => undefined,
        selectDefaultProfile() {
          return Promise.resolve('engineer');
        },
        selectWelcomePlan() {
          return Promise.resolve({ answerQuestions: true, selectedRoleId: 'engineer', loadoutItemIds: [] });
        },
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(result.profileId).toBe('engineer');
    expect(result.launchPlan.args).toContain('--append-system-prompt');
    expect(readFileSync(join(homeDirectory, '.outfitter', 'profiles', 'engineer', 'profile.yml'), 'utf8')).toContain(
      'extensions: []',
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('opens pi login automatically on the first launch after welcome when pi is not logged in', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const messages: string[] = [];
    const providerApiKey = 'outfitter-test-provider-api-key';
    const previousOpenAiApiKey = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = providerApiKey;

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
        output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
        synchronizer: defaultProfileSynchronizer,
        writeLine: (message) => messages.push(message),
        selectDefaultProfile() {
          return Promise.resolve('engineer');
        },
        selectWelcomePlan() {
          return Promise.resolve({ answerQuestions: false });
        },
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    ).finally(() => {
      if (previousOpenAiApiKey === undefined) {
        delete process.env.OPENAI_API_KEY;
        return;
      }

      process.env.OPENAI_API_KEY = previousOpenAiApiKey;
    });

    expect(result.launchPlan.args[0]).toBe('--extension');
    const loginExtensionContent = readFileSync(result.launchPlan.args[1] ?? '', 'utf8');
    expect(loginExtensionContent).toContain('setEditorText("/login")');
    expect(loginExtensionContent).toContain('handleInput?.("\\r")');
    expect(messages).toContain(
      'Pi does not appear to be logged in yet. Outfitter will open `/login` automatically after Pi starts.',
    );
    expect(messages.join('\n')).not.toContain(providerApiKey);
    expect(loginExtensionContent).not.toContain(providerApiKey);
    expect(JSON.stringify(result.launchPlan)).not.toContain(providerApiKey);
    for (const fileName of ['auth.json', 'models.json', 'mcp.json']) {
      const piStatePath = join(homeDirectory, '.pi', 'agent', fileName);
      if (existsSync(piStatePath)) {
        expect(readFileSync(piStatePath, 'utf8')).not.toContain(providerApiKey);
      }
    }
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('leaves non-interactive pi launches on a manual login notice after welcome', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    const messages: string[] = [];

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory, passThroughArgs: ['--print', 'hello'] },
      {
        interactive: true,
        input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
        output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
        synchronizer: defaultProfileSynchronizer,
        writeLine: (message) => messages.push(message),
        selectDefaultProfile() {
          return Promise.resolve('engineer');
        },
        selectWelcomePlan() {
          return Promise.resolve({ answerQuestions: false });
        },
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(result.launchPlan.args).toContain('--print');
    expect(result.launchPlan.args.slice(-2)).toEqual(['--print', 'hello']);
    expect(messages).toContain(
      'Pi does not appear to be logged in yet. After Pi starts, run `/login` and choose a subscription such as Codex or provide an API key from another model provider.',
    );
  });

  it('persists a role-only welcome result without loadout data', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const settingsPath = join(homeDirectory, '.outfitter', 'settings.yml');
    mkdirSync(join(homeDirectory, '.outfitter'), { recursive: true });
    writeFileSync(settingsPath, 'default_profile: engineer\nprofile_sources:\n  - path: ./profiles\n');

    const persisted = persistFirstRunWelcomeProfile(homeDirectory, settingsPath, {
      answered: true,
      selectedRole: { id: 'engineer', label: 'Engineer' },
      warnings: [],
      messages: [],
    });

    const profile = readFileSync(join(homeDirectory, '.outfitter', 'profiles', 'engineer', 'profile.yml'), 'utf8');
    expect(persisted).toEqual({ profileId: 'engineer', createdProfile: true });
    expect(profile).toContain('append_system_prompt: |');
    expect(profile).not.toContain('extensions:');
    expect(readFileSync(settingsPath, 'utf8')).toContain('default_profile: engineer');
  });

  it('does not overwrite an existing role profile when persisting welcome', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const settingsPath = join(homeDirectory, '.outfitter', 'settings.yml');
    const profilePath = join(homeDirectory, '.outfitter', 'profiles', 'engineer', 'profile.yml');
    mkdirSync(join(homeDirectory, '.outfitter', 'profiles', 'engineer'), { recursive: true });
    writeFileSync(settingsPath, 'default_profile: data_analyst\nprofile_sources:\n  - path: ./profiles\n');
    writeFileSync(profilePath, 'id: engineer\nlabel: Custom Engineer\ncontrols: {}\n');

    const persisted = persistFirstRunWelcomeProfile(homeDirectory, settingsPath, {
      answered: true,
      selectedRole: { id: 'engineer', label: 'Engineer' },
      selectedLoadout: {
        id: 'recommended',
        label: 'Recommended',
        selectedItems: [{ id: 'deepwork', label: 'DeepWork', kind: 'extension', source: 'git:x' }],
      },
      warnings: [],
      messages: [],
    });

    expect(persisted).toEqual({ profileId: 'engineer', createdProfile: false });
    expect(readFileSync(profilePath, 'utf8')).toBe('id: engineer\nlabel: Custom Engineer\ncontrols: {}\n');
    expect(readFileSync(settingsPath, 'utf8')).toContain('default_profile: engineer');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.2, OFTR-010.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('falls back to a generated welcome profile when the selected role is not cached', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');

    await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
        output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
        synchronizer: engineerOnlySynchronizer,
        writeLine: () => undefined,
        selectDefaultProfile() {
          return Promise.resolve('engineer');
        },
        selectWelcomePlan() {
          return Promise.resolve({
            answerQuestions: true,
            selectedRoleId: 'data_analyst',
            loadoutItemIds: ['deepwork'],
          });
        },
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );

    const profileDirectory = join(homeDirectory, '.outfitter', 'profiles', 'data_analyst');
    expect(readFileSync(join(profileDirectory, 'profile.yml'), 'utf8')).toContain(
      'git:github.com/ai-outfitter/deepwork',
    );
    expect(existsSync(join(profileDirectory, 'cli_specific'))).toBe(false);
  });

  it('copies source profiles even when the profile and settings YAML are empty', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const settingsPath = join(homeDirectory, '.outfitter', 'settings.yml');
    const sourceProfileDirectory = join(root, 'default-profiles', 'data_analyst');
    mkdirSync(join(homeDirectory, '.outfitter'), { recursive: true });
    mkdirSync(sourceProfileDirectory, { recursive: true });
    writeFileSync(settingsPath, '');
    writeFileSync(join(sourceProfileDirectory, 'profile.yml'), '');

    const persisted = persistFirstRunWelcomeProfile(
      homeDirectory,
      settingsPath,
      {
        answered: true,
        selectedRole: { id: 'data_analyst', label: 'Data Analyst' },
        warnings: [],
        messages: [],
      },
      { sourceProfileDirectory },
    );

    expect(persisted).toEqual({
      profileId: 'data_analyst',
      createdProfile: true,
      messages: [
        `Copied the Data Analyst profile locally so your extension choices can be edited at ${join(
          homeDirectory,
          '.outfitter',
          'profiles',
          'data_analyst',
          'profile.yml',
        )}.`,
      ],
    });
    expect(readFileSync(settingsPath, 'utf8')).toContain('profile_sources: []');
    expect(readFileSync(settingsPath, 'utf8')).toContain('default_profile: data_analyst');
  });

  it('handles malformed scalar source profiles when copying welcome choices', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const settingsPath = join(homeDirectory, '.outfitter', 'settings.yml');
    const sourceProfileDirectory = join(root, 'default-profiles', 'data_analyst');
    mkdirSync(join(homeDirectory, '.outfitter'), { recursive: true });
    mkdirSync(sourceProfileDirectory, { recursive: true });
    writeFileSync(
      settingsPath,
      'default_profile: engineer\nprofile_sources:\n  - github: ai-outfitter/default-profiles\n    path: profiles\n',
    );
    writeFileSync(join(sourceProfileDirectory, 'profile.yml'), 'scalar-profile\n');

    persistFirstRunWelcomeProfile(
      homeDirectory,
      settingsPath,
      {
        answered: true,
        selectedRole: { id: 'data_analyst', label: 'Data Analyst' },
        selectedLoadout: {
          id: 'recommended',
          label: 'Recommended',
          selectedItems: [{ id: 'deepwork', label: 'DeepWork', kind: 'extension', source: 'git:x' }],
        },
        warnings: [],
        messages: [],
      },
      { sourceProfileDirectory },
    );

    const copiedProfile = readFileSync(
      join(homeDirectory, '.outfitter', 'profiles', 'data_analyst', 'profile.yml'),
      'utf8',
    );
    expect(copiedProfile).toContain('controls:');
    expect(copiedProfile).toContain('git:x');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('adds copied profile exclusions to the default profile source', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const settingsPath = join(homeDirectory, '.outfitter', 'settings.yml');
    const sourceProfileDirectory = join(root, 'default-profiles', 'data_analyst');
    mkdirSync(join(homeDirectory, '.outfitter'), { recursive: true });
    mkdirSync(sourceProfileDirectory, { recursive: true });
    writeFileSync(
      settingsPath,
      [
        'default_profile: engineer',
        'profile_sources:',
        '  - github: ai-outfitter/default-profiles',
        '    path: profiles',
        '    except:',
        '      - engineer',
        '      - 7',
        '  - uri: git+https://github.com/ai-outfitter/default-profiles.git',
        '    path: profiles',
        '  - uri: git+https://github.com/ai-outfitter/other-profiles.git',
        '    path: profiles',
        '  - path: ./profiles',
        '  - literal-source',
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(sourceProfileDirectory, 'profile.yml'),
      [
        'id: data_analyst',
        'controls:',
        '  extensions:',
        '    - git:github.com/ai-outfitter/default-generic',
        '  pi:',
        '    extensions:',
        '      - git:github.com/ai-outfitter/default-pi',
        '',
      ].join('\n'),
    );

    persistFirstRunWelcomeProfile(
      homeDirectory,
      settingsPath,
      {
        answered: true,
        selectedRole: { id: 'data_analyst', label: 'Data Analyst' },
        selectedLoadout: {
          id: 'recommended',
          label: 'Recommended',
          selectedItems: [{ id: 'deepwork', label: 'DeepWork', kind: 'extension', source: 'git:selected' }],
        },
        warnings: [],
        messages: [],
      },
      { sourceProfileDirectory },
    );

    const settings = readFileSync(settingsPath, 'utf8');
    expect(settings).toContain('except:');
    expect(settings).toContain('- engineer');
    expect(settings.match(/- data_analyst/gu)).toHaveLength(2);
    expect(settings).not.toContain('- 7');
    expect(settings).toContain('literal-source');

    const copiedProfile = readFileSync(
      join(homeDirectory, '.outfitter', 'profiles', 'data_analyst', 'profile.yml'),
      'utf8',
    );
    expect(copiedProfile).toContain('extensions: []');
    expect(copiedProfile).toContain('git:selected');
    expect(copiedProfile).not.toContain('default-generic');
    expect(copiedProfile).not.toContain('default-pi');
  });

  it('adds a default profile setting when persisting welcome into sparse settings', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const settingsPath = join(homeDirectory, '.outfitter', 'settings.yml');
    mkdirSync(join(homeDirectory, '.outfitter'), { recursive: true });
    writeFileSync(settingsPath, 'profile_sources:\n  - path: ./profiles\n');

    persistFirstRunWelcomeProfile(homeDirectory, settingsPath, {
      answered: true,
      selectedRole: { id: 'data_analyst', label: 'Data Analyst' },
      warnings: [],
      messages: [],
    });

    expect(readFileSync(settingsPath, 'utf8')).toContain('default_profile: data_analyst');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('persists first-run welcome loadout selection before launching pi', async () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');

    const result = await executeRunCommand(
      { homeDirectory, projectDirectory },
      {
        interactive: true,
        input: { isTTY: true } as NodeJS.ReadableStream & { isTTY: true },
        output: { isTTY: true } as NodeJS.WritableStream & { isTTY: true },
        synchronizer: defaultProfileSynchronizer,
        writeLine: () => undefined,
        selectDefaultProfile() {
          return Promise.resolve('data_analyst');
        },
        selectWelcomePlan() {
          return Promise.resolve({
            answerQuestions: true,
            selectedRoleId: 'data_analyst',
            loadoutItemIds: ['deepwork', 'pi-mcp-adapter'],
          });
        },
        launcher: {
          launch() {
            return Promise.resolve(0);
          },
        },
      },
    );

    expect(result.profileId).toBe('data_analyst');
    expect(result.launchPlan.args).toContain('git:github.com/ai-outfitter/deepwork');
    expect(result.launchPlan.args).toContain('npm:pi-mcp-adapter');
    expect(result.launchPlan.args).not.toContain('git:github.com/nhorton/pi-pr-alerts');
    const settings = readFileSync(join(homeDirectory, '.outfitter', 'settings.yml'), 'utf8');
    const copiedProfile = readFileSync(
      join(homeDirectory, '.outfitter', 'profiles', 'data_analyst', 'profile.yml'),
      'utf8',
    );

    expect(settings).toContain('default_profile: data_analyst');
    expect(settings).toContain('except:');
    expect(settings).toContain('- data_analyst');
    expect(copiedProfile).toContain('git:github.com/ai-outfitter/deepwork');
    expect(copiedProfile).toContain('npm:pi-mcp-adapter');
    expect(copiedProfile).not.toContain('git:github.com/nhorton/pi-pr-alerts');
    expect(
      existsSync(
        join(
          homeDirectory,
          '.outfitter',
          'profiles',
          'data_analyst',
          'cli_specific',
          'pi',
          'deepwork',
          'jobs',
          'data_analyst',
          'job.yml',
        ),
      ),
    ).toBe(true);
    expect(
      existsSync(
        join(
          homeDirectory,
          '.outfitter',
          'profiles',
          'data_analyst',
          'cli_specific',
          'pi',
          'skills',
          'demos',
          'SKILL.md',
        ),
      ),
    ).toBe(true);
  });
});
