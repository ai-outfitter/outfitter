// Tests how the `harnesses:` settings block folds across Outfitter's precedence layers.
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { emptyHarnessSettings, mergeHarnessSettings } from '../../src/harness/HarnessSettings.js';
import { discoverSettingsLoadPlan, loadSettings } from '../../src/settings/SettingsLoader.js';

const temporaryRoots: string[] = [];

const createRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-harness-settings-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('harness settings merge', () => {
  it('returns the defined side when only one is present', () => {
    expect(mergeHarnessSettings(undefined, undefined)).toBeUndefined();
    expect(mergeHarnessSettings({ link: 'none' }, undefined)).toEqual({ link: 'none' });
    expect(mergeHarnessSettings(undefined, { link: 'none' })).toEqual({ link: 'none' });
    expect(emptyHarnessSettings()).toEqual({});
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.5.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('lets the higher-precedence selection replace the lower one wholesale', () => {
    expect(mergeHarnessSettings({ link: ['claude', 'codex'] }, { link: ['gemini'] })?.link).toEqual(['gemini']);
    // An absent higher-precedence selection leaves the lower one in place.
    expect(mergeHarnessSettings({ link: ['claude'] }, { hooks: [] })?.link).toEqual(['claude']);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.5.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('accumulates hooks lowest-precedence first rather than replacing them', () => {
    const merged = mergeHarnessSettings(
      { hooks: [{ event: 'before_tool', command: 'user' }] },
      { hooks: [{ event: 'after_tool', command: 'project' }] },
    );

    expect(merged?.hooks).toEqual([
      { event: 'before_tool', command: 'user' },
      { event: 'after_tool', command: 'project' },
    ]);
  });

  it('omits hooks and overrides entirely when neither layer declares any', () => {
    const merged = mergeHarnessSettings({ link: 'none' }, {});

    expect(merged).not.toHaveProperty('hooks');
    expect(merged).not.toHaveProperty('overrides');
  });

  it('merges per-harness overrides field by field across layers', () => {
    const merged = mergeHarnessSettings(
      { overrides: { claude: { enabled: true, resources: ['skills'] }, codex: { enabled: true } } },
      { overrides: { claude: { resources: ['skills', 'commands'] }, gemini: { enabled: false } } },
    );

    // `enabled` survives from the lower layer while `resources` is replaced by the higher one.
    expect(merged?.overrides?.claude).toEqual({ enabled: true, resources: ['skills', 'commands'] });
    expect(merged?.overrides?.codex).toEqual({ enabled: true });
    expect(merged?.overrides?.gemini).toEqual({ enabled: false });
  });
});

describe('harness settings loading', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.5.1, OFTR-011.5.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('converts the harnesses block, including snake_case config directories', () => {
    const root = createRoot();
    write(
      join(root, 'home', '.agents', 'settings.yml'),
      [
        'harnesses:',
        '  link: [claude, gemini]',
        '  hooks:',
        '    - event: before_tool',
        '      matcher: Bash',
        '      command: guard.sh',
        '  claude:',
        '    enabled: true',
        '    resources: [skills, commands]',
        '    config_directories: ["~/.claude", "~/.claude-work"]',
        '',
      ].join('\n'),
    );

    const loaded = loadSettings(
      discoverSettingsLoadPlan({ homeDirectory: join(root, 'home'), projectDirectory: join(root, 'project') }),
    );

    expect(loaded.issues).toEqual([]);
    expect(loaded.settings.harnesses).toEqual({
      link: ['claude', 'gemini'],
      hooks: [{ event: 'before_tool', matcher: 'Bash', command: 'guard.sh' }],
      overrides: {
        claude: {
          enabled: true,
          resources: ['skills', 'commands'],
          configDirectories: ['~/.claude', '~/.claude-work'],
        },
      },
    });
  });

  it('yields an empty block when settings declare no harnesses', () => {
    const root = createRoot();
    write(join(root, 'home', '.agents', 'settings.yml'), 'default_agent: engineer\n');

    const loaded = loadSettings(
      discoverSettingsLoadPlan({ homeDirectory: join(root, 'home'), projectDirectory: join(root, 'project') }),
    );

    expect(loaded.settings.harnesses).toEqual({});
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-011.5.5).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('applies project settings over user settings for the harnesses block', () => {
    const root = createRoot();
    write(
      join(root, 'home', '.agents', 'settings.yml'),
      'harnesses:\n  link: [claude]\n  hooks:\n    - event: before_tool\n      command: user.sh\n',
    );
    write(
      join(root, 'project', '.agents', 'settings.yml'),
      'harnesses:\n  link: [gemini]\n  hooks:\n    - event: after_tool\n      command: project.sh\n',
    );

    const loaded = loadSettings(
      discoverSettingsLoadPlan({ homeDirectory: join(root, 'home'), projectDirectory: join(root, 'project') }),
    );

    expect(loaded.settings.harnesses?.link).toEqual(['gemini']);
    expect(loaded.settings.harnesses?.hooks?.map((hook) => hook.command)).toEqual(['user.sh', 'project.sh']);
  });

  it('rejects an unknown harness id and an unknown override key', () => {
    const root = createRoot();
    write(join(root, 'home', '.agents', 'settings.yml'), 'harnesses:\n  emacs:\n    enabled: true\n');

    const loaded = loadSettings(
      discoverSettingsLoadPlan({ homeDirectory: join(root, 'home'), projectDirectory: join(root, 'project') }),
    );

    expect(loaded.issues.length).toBeGreaterThan(0);
  });
});
