// Tests the shared tilde-expansion rule for settings-resolved paths (pi_binary_path, cache_directory,
// source paths, agent_defaults.pi_overlay): a leading `~` or `~/` expands to the user's home
// directory, `~name` forms and relative paths keep the declaring-directory rule, and absolute paths
// are untouched.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createSettingsLoadPlan, discoverSettingsLoadPlan, loadSettings } from '../../src/settings/SettingsLoader.js';

const temporaryRoots: string[] = [];

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-tilde-'));
  temporaryRoots.push(root);
  return root;
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('settings path tilde expansion', () => {
  const tree = (): { home: string; project: string } => {
    const root = createTemporaryRoot();
    return { home: join(root, 'home'), project: join(root, 'project') };
  };

  const writeSettings = (path: string, yaml: string): void => {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, yaml);
  };

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.12.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('expands a leading ~ in pi_binary_path to the user home from home-scope settings', () => {
    const { home, project } = tree();
    writeSettings(join(home, '.agents', 'settings.yml'), "pi_binary: path\npi_binary_path: '~/tools/pi'\n");

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory: home, projectDirectory: project }));

    expect(loaded.issues).toEqual([]);
    expect(loaded.settings.piBinaryPath).toBe(join(home, 'tools', 'pi'));
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.12.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('still resolves a relative pi_binary_path against the declaring settings directory', () => {
    const { home, project } = tree();
    writeSettings(join(home, '.agents', 'settings.yml'), "pi_binary: path\npi_binary_path: './vendor/pi'\n");

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory: home, projectDirectory: project }));

    expect(loaded.settings.piBinaryPath).toBe(join(home, '.agents', 'vendor', 'pi'));
  });

  it('expands a bare ~ value to the home root itself', () => {
    const { home, project } = tree();
    writeSettings(join(home, '.agents', 'settings.yml'), "pi_binary: path\npi_binary_path: '~'\n");

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory: home, projectDirectory: project }));

    expect(loaded.settings.piBinaryPath).toBe(home);
  });

  it('leaves ~name values to the declaring-directory rule', () => {
    const { home, project } = tree();
    writeSettings(join(home, '.agents', 'settings.yml'), "pi_binary: path\npi_binary_path: '~shared/pi'\n");

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory: home, projectDirectory: project }));

    expect(loaded.settings.piBinaryPath).toBe(join(home, '.agents', '~shared', 'pi'));
  });

  it('leaves already-absolute paths untouched', () => {
    const { home, project } = tree();
    writeSettings(join(home, '.agents', 'settings.yml'), "pi_binary: path\npi_binary_path: '/opt/pi/bin/pi'\n");

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory: home, projectDirectory: project }));

    expect(loaded.settings.piBinaryPath).toBe('/opt/pi/bin/pi');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.5.3, OFTR-002.7.2, OFTR-002.10.12).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('expands ~ across the other settings-resolved surfaces', () => {
    const { home, project } = tree();
    writeSettings(
      join(home, '.agents', 'settings.yml'),
      [
        'cache_directory: ~/cache',
        'sources:',
        '  - path: ~/agents-source',
        'agent_defaults:',
        '  pi_overlay: ~/overlay',
        '',
      ].join('\n'),
    );

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory: home, projectDirectory: project }));

    expect(loaded.issues).toEqual([]);
    expect(loaded.settings.cacheDirectory).toBe(join(home, 'cache'));
    expect(loaded.settings.sources).toEqual([{ path: join(home, 'agents-source') }]);
    expect(loaded.settings.agentDefaults?.piOverlayDirectories).toEqual([join(home, 'overlay')]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.5.3, OFTR-002.7.2, OFTR-002.12.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('expands project-scope tilde paths against the user home, never the declaring directory', () => {
    const { home, project } = tree();
    writeSettings(
      join(project, '.agents', 'settings.yml'),
      "pi_binary: path\npi_binary_path: '~/tools/pi'\ncache_directory: ~/cache\n",
    );

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory: home, projectDirectory: project }));

    expect(loaded.issues).toEqual([]);
    expect(loaded.settings.piBinaryPath).toBe(join(home, 'tools', 'pi'));
    expect(loaded.settings.cacheDirectory).toBe(join(home, 'cache'));
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.12.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('keeps cross-layer precedence when user and project layers both declare tilde paths', () => {
    const { home, project } = tree();
    writeSettings(join(home, '.agents', 'settings.yml'), "pi_binary: path\npi_binary_path: '~/user-pi'\n");
    writeSettings(join(project, '.agents', 'settings.yml'), "pi_binary_path: '~/project-pi'\n");

    const loaded = loadSettings(discoverSettingsLoadPlan({ homeDirectory: home, projectDirectory: project }));

    expect(loaded.issues).toEqual([]);
    expect(loaded.settings.piBinaryPath).toBe(join(home, 'project-pi')); // project layer wins, expanded
    const userFile = loaded.files.find((file) => file.location.scope === 'user');
    expect(userFile?.settings.piBinaryPath).toBe(join(home, 'user-pi')); // loser still expanded
  });

  it('does not expand tilde values when the load plan carries no home directory', () => {
    const { project } = tree();
    const settingsPath = join(project, '.agents', 'settings.yml');
    writeSettings(settingsPath, "pi_binary: path\npi_binary_path: '~/tools/pi'\n");

    const loaded = loadSettings(createSettingsLoadPlan([{ scope: 'project', path: settingsPath }]));

    expect(loaded.settings.piBinaryPath).toBe(join(project, '.agents', '~', 'tools', 'pi'));
  });
});
