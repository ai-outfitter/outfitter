// Tests the `agent_defaults.extension_configs` settings surface: read-boundary schema validation
// of the name-to-object map and its per-extension deep-merge across the settings stack.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createSettingsLoadPlan,
  discoverSettingsLoadPlan,
  loadSettings,
  loadSettingsFiles,
} from '../../src/settings/SettingsLoader.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-extension-configs-settings-'));
  temporaryRoots.push(root);
  return root;
};

const writeSettings = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('agent_defaults extension configs settings', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.16).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('accepts a name-to-object map as declared', () => {
    const root = createTemporaryRoot();
    const settingsPath = join(root, '.agents', 'settings.yml');
    writeSettings(
      settingsPath,
      'agent_defaults:\n  extension_configs:\n    dynamic-context-pruning:\n      rejectedSummaryMode: reject\n',
    );

    const loaded = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'project', path: settingsPath }]));

    expect(loaded.issues).toEqual([]);
    expect(loaded.files[0]?.settings.agentDefaults?.extensionConfigs).toEqual({
      'dynamic-context-pruning': { rejectedSummaryMode: 'reject' },
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.16).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('accepts an empty config object for an extension', () => {
    const root = createTemporaryRoot();
    const settingsPath = join(root, '.agents', 'settings.yml');
    writeSettings(settingsPath, 'agent_defaults:\n  extension_configs:\n    pruning: {}\n');

    const loaded = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user', path: settingsPath }]));

    expect(loaded.issues).toEqual([]);
    expect(loaded.files[0]?.settings.agentDefaults?.extensionConfigs).toEqual({ pruning: {} });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.16).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('rejects malformed extension_configs shapes at the read boundary', () => {
    const root = createTemporaryRoot();
    const settingsPath = join(root, '.agents', 'settings.yml');
    const shapes = [
      '[a, b]',
      'dynamic-context-pruning',
      '42',
      'dynamic-context-pruning: true',
      'dynamic-context-pruning: [a]',
      '../evil: {}',
      'a/b: {}',
      '@scope/pkg: {}',
    ];

    for (const shape of shapes) {
      writeSettings(settingsPath, `agent_defaults:\n  extension_configs:\n    ${shape}\n`);

      const loaded = loadSettingsFiles(createSettingsLoadPlan([{ scope: 'user', path: settingsPath }]));

      expect(loaded.files).toEqual([]);
      expect(loaded.issues.length).toBeGreaterThan(0);
      expect(loaded.issues.every((issue) => issue.filePath === settingsPath)).toBe(true);
    }
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.17).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('deep-merges per extension name across layers with higher leaves replacing lower', () => {
    const root = createTemporaryRoot();
    const homeDirectory = join(root, 'home');
    const projectDirectory = join(root, 'project');
    writeSettings(
      join(homeDirectory, '.agents', 'settings.yml'),
      'agent_defaults:\n  extension_configs:\n    alpha:\n      enabled: true\n      mode: summary\n',
    );
    writeSettings(
      join(projectDirectory, '.agents', 'settings.yml'),
      'agent_defaults:\n  extension_configs:\n    alpha:\n      mode: reject\n    beta:\n      pinned: [one]\n',
    );

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory, projectDirectory }));

    expect(loaded.issues).toEqual([]);
    expect(loaded.settings.agentDefaults?.extensionConfigs).toEqual({
      alpha: { enabled: true, mode: 'reject' },
      beta: { pinned: ['one'] },
    });
  });
});
