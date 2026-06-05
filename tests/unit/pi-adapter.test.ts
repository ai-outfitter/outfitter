// Tests pi adapter translation behavior.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createPiAdapter } from '../../src/agents/pi/PiAdapter.js';
import { parseProfileYaml } from '../../src/profiles/ProfileLoader.js';

const temporaryPiSettingsTestHomes: string[] = [];

afterEach(() => {
  for (const homeDirectory of temporaryPiSettingsTestHomes.splice(0)) {
    rmSync(homeDirectory, { recursive: true, force: true });
  }
});

describe('pi adapter', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-006.1, APPLEPI-REQ-006.2, APPLEPI-REQ-006.3, APPLEPI-REQ-006.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('translates generic and pi-specific profile controls into pi env and argv', () => {
    const adapter = createPiAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      {
        id: 'engineering',
        inherits: [],
        controls: {
          model: 'generic-model',
          provider: 'anthropic',
          environment: { GENERIC: '1' },
          extensions: ['ext-a'],
          skills: ['skill-a'],
          promptTemplate: 'template-a',
          systemPrompt: 'base prompt',
          appendSystemPrompt: 'extra prompt',
          pi: {
            model: 'pi-model',
            sessionDirectory: '/tmp/pi-sessions',
            args: ['--share'],
            environment: { PI_ONLY: '1' },
            extensions: ['npm:pi-subagents@2'],
            skills: ['skill-pi'],
          },
        },
      },
      { rootDirectory: '/tmp/applepi-engineering-pi-123', profilePaths: ['/profiles/engineering/profile.yml'] },
    );
    const launchPlan = adapter.createLaunchPlan(compositeProfilePlan.compositeProfile, {
      id: 'engineering',
      inherits: [],
      controls: {
        model: 'generic-model',
        provider: 'anthropic',
        environment: { GENERIC: '1' },
        extensions: ['npm:pi-subagents@1', 'ext-a'],
        skills: ['skill-a'],
        promptTemplate: 'template-a',
        systemPrompt: 'base prompt',
        appendSystemPrompt: 'extra prompt',
        pi: {
          model: 'pi-model',
          sessionDirectory: '/tmp/pi-sessions',
          args: ['--share'],
          environment: { PI_ONLY: '1' },
          extensions: ['npm:pi-subagents@2'],
          skills: ['skill-pi'],
        },
      },
    });

    expect(adapter.id).toBe('pi');
    expect(adapter.supportedControls).toContain('model');
    expect(adapter.supportedControls).toContain('promptTemplate');
    expect(
      adapter.getUnsupportedControls({
        id: 'engineering',
        inherits: [],
        controls: { pi: { unsupportedPiControl: true } },
      }),
    ).toEqual(['pi.unsupportedPiControl']);
    expect(compositeProfilePlan.compositeProfile.rootDirectory).toBe('/tmp/applepi-engineering-pi-123');
    expect(compositeProfilePlan.compositeProfile.files[0]?.sourceInputs).toEqual(['/profiles/engineering/profile.yml']);
    expect(launchPlan.command).toBe('pi');
    expect(launchPlan.env).toEqual({
      GENERIC: '1',
      PI_ONLY: '1',
      PI_CODING_AGENT_DIR: '/tmp/applepi-engineering-pi-123',
    });
    expect(launchPlan.args).toEqual([
      '--model',
      'pi-model',
      '--provider',
      'anthropic',
      '--session-dir',
      '/tmp/pi-sessions',
      '--prompt-template',
      'template-a',
      '--system-prompt',
      'base prompt',
      '--append-system-prompt',
      'extra prompt',
      '--extension',
      'npm:pi-subagents@2',
      '--extension',
      'ext-a',
      '--skill',
      'skill-pi',
      '--skill',
      'skill-a',
      '--share',
    ]);

    const genericFallbackProfile = parseProfileYaml(
      'id: fallback\ncontrols:\n  model: generic-model\n  pi: {}\n',
      'fallback',
    );
    expect('message' in genericFallbackProfile).toBe(false);
    if (!('message' in genericFallbackProfile)) {
      expect(adapter.createLaunchPlan(compositeProfilePlan.compositeProfile, genericFallbackProfile).args).toEqual([
        '--model',
        'generic-model',
      ]);
    }
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-006.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('transforms pi settings packages when profile extensions would duplicate native packages', () => {
    const { homeDirectory, settingsPath } = createPiSettingsTestHome();
    writeFileSync(
      settingsPath,
      JSON.stringify({
        packages: [
          'npm:pi-subagents',
          { source: 'npm:kept-package', extensions: ['index.ts'] },
          { source: 'git+https://github.com/applepi-ai/deepwork.git#main' },
          { source: 42, note: 'kept because it has no string source' },
          null,
        ],
        theme: 'dark',
      }),
    );

    const adapter = createPiAdapter();
    const compositeProfilePlan = adapter.createCompositeProfile(
      {
        id: 'engineering',
        inherits: [],
        controls: {
          pi: {
            extensions: ['npm:pi-subagents@2', 'git:github.com/applepi-ai/deepwork#v1'],
          },
        },
      },
      {
        rootDirectory: '/tmp/applepi-engineering-pi-456',
        profilePaths: ['/profiles/engineering/profile.yml'],
        homeDirectory,
      },
    );

    const transformedSettings = compositeProfilePlan.compositeProfile.files.find(
      (file) => file.relativePath === 'settings.json',
    );

    expect(transformedSettings?.sourceInputs).toEqual([settingsPath, '/profiles/engineering/profile.yml']);
    expect(JSON.parse(transformedSettings?.content ?? '{}')).toEqual({
      packages: [
        { source: 'npm:kept-package', extensions: ['index.ts'] },
        { source: 42, note: 'kept because it has no string source' },
        null,
      ],
      theme: 'dark',
    });
    expect(
      compositeProfilePlan.compositeProfile.statePaths.find((statePath) => statePath.relativePath === 'settings.json'),
    ).toEqual({
      relativePath: 'settings.json',
      strategy: 'discard',
      directory: false,
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (APPLEPI-REQ-006.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('keeps native pi settings state when settings do not need reconciliation or cannot be parsed', () => {
    const noDuplicate = createPiSettingsTestHome();
    writeFileSync(noDuplicate.settingsPath, JSON.stringify({ packages: ['npm:kept-package'] }));

    const invalid = createPiSettingsTestHome();
    writeFileSync(invalid.settingsPath, 'not json');

    const nonObject = createPiSettingsTestHome();
    writeFileSync(nonObject.settingsPath, '[]');

    const malformedPackages = createPiSettingsTestHome();
    writeFileSync(malformedPackages.settingsPath, JSON.stringify({ packages: {} }));

    const adapter = createPiAdapter();
    const profile = {
      id: 'engineering',
      inherits: [],
      controls: { pi: { extensions: ['npm:pi-subagents'] } },
    };

    for (const homeDirectory of [
      noDuplicate.homeDirectory,
      invalid.homeDirectory,
      nonObject.homeDirectory,
      malformedPackages.homeDirectory,
    ]) {
      const compositeProfilePlan = adapter.createCompositeProfile(profile, {
        rootDirectory: '/tmp/applepi-engineering-pi-789',
        profilePaths: ['/profiles/engineering/profile.yml'],
        homeDirectory,
      });

      expect(compositeProfilePlan.compositeProfile.files.some((file) => file.relativePath === 'settings.json')).toBe(
        false,
      );
      expect(
        compositeProfilePlan.compositeProfile.statePaths.some(
          (statePath) => statePath.relativePath === 'settings.json',
        ),
      ).toBe(true);
    }

    const unreadable = createPiSettingsTestHome();
    mkdirSync(unreadable.settingsPath);

    expect(() =>
      adapter.createCompositeProfile(profile, {
        rootDirectory: '/tmp/applepi-engineering-pi-789',
        profilePaths: ['/profiles/engineering/profile.yml'],
        homeDirectory: unreadable.homeDirectory,
      }),
    ).toThrow(/Could not read pi settings file/u);
  });
});

const createPiSettingsTestHome = (): { readonly homeDirectory: string; readonly settingsPath: string } => {
  const homeDirectory = mkdtempSync(join(tmpdir(), 'applepi-pi-settings-'));
  temporaryPiSettingsTestHomes.push(homeDirectory);
  const settingsDirectory = join(homeDirectory, '.pi', 'agent');
  const settingsPath = join(settingsDirectory, 'settings.json');
  mkdirSync(settingsDirectory, { recursive: true });

  return { homeDirectory, settingsPath };
};
