// Tests pi/claude extension projection: --extension args and extension unsupported-set handling.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CompositionPlan } from '../../src/composer/Composition.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';

const roots: string[] = [];
const root = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'outfitter-project-'));
  roots.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const planWith = (extensions: readonly string[]): CompositionPlan => ({
  agent: 'agent',
  identity: { agentBody: 'Body.' },
  loadout: { skills: [], subagents: [], mcp: [], extensions: [...extensions], plugins: [] },
  warnings: [],
});

describe('projectComposition extensions', () => {
  it('loads pi extension dirs with --extension and drops extensions from unsupported', () => {
    const dir = root();
    const projection = projectComposition(planWith(['git:github.com/o/r']), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
      extensionLoadDirs: ['/cache/git/github.com/o/r'],
    });
    const args = projection.launch.args;
    expect(args[args.indexOf('/cache/git/github.com/o/r') - 1]).toBe('--extension');
    expect(projection.unsupported).not.toContain('extensions');
  });

  it('reports extensions unsupported for pi when no load dirs are provided (adds no --extension)', () => {
    const dir = root();
    const projection = projectComposition(planWith(['git:github.com/o/r']), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
    });
    expect(projection.launch.args).not.toContain('--extension');
    expect(projection.unsupported).toContain('extensions');
  });

  it('never adds --extension for claude and keeps extensions unsupported', () => {
    const dir = root();
    const projection = projectComposition(planWith(['git:github.com/o/r']), {
      harness: 'claude',
      rootDirectory: dir,
      homeDirectory: dir,
      extensionLoadDirs: ['/cache/git/github.com/o/r'],
    });
    expect(projection.launch.args).not.toContain('--extension');
    expect(projection.unsupported).toContain('extensions');
  });
});

describe('projectComposition native configuration overlays', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.17).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('materializes lower-precedence Pi configuration before higher-precedence configuration', () => {
    const dir = root();
    const low = join(root(), 'low');
    const high = join(root(), 'high');
    mkdirSync(join(low, 'themes'), { recursive: true });
    mkdirSync(join(high, 'themes'), { recursive: true });
    writeFileSync(join(low, 'keybindings.json'), '{"tui.editor.yank":"alt+y"}');
    writeFileSync(join(low, 'settings.json'), '{"theme":"dark"}');
    writeFileSync(join(low, 'themes', 'shared.json'), '{"name":"low"}');
    writeFileSync(join(high, 'keybindings.json'), '{"tui.editor.yank":"ctrl+shift+y"}');
    writeFileSync(join(high, 'themes', 'shared.json'), '{"name":"high"}');

    projectComposition(planWith([]), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
      extensionLoadDirs: [],
      configurationOverlayDirectories: [high, low],
    });

    expect(readFileSync(join(dir, 'keybindings.json'), 'utf8')).toContain('ctrl+shift+y');
    expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toContain('dark');
    expect(readFileSync(join(dir, 'themes', 'shared.json'), 'utf8')).toContain('high');
  });

  it('keeps generated composition files authoritative over native overlay collisions', () => {
    const dir = root();
    const overlay = root();
    writeFileSync(join(overlay, 'agent.md'), 'overlay body');
    mkdirSync(join(overlay, 'skills', 'extra'), { recursive: true });
    writeFileSync(join(overlay, 'skills', 'extra', 'note.md'), 'native extra');

    projectComposition(planWith([]), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
      extensionLoadDirs: [],
      configurationOverlayDirectories: [overlay],
    });

    expect(readFileSync(join(dir, 'agent.md'), 'utf8')).toBe('Body.');
    expect(readFileSync(join(dir, 'skills', 'extra', 'note.md'), 'utf8')).toBe('native extra');
  });

  it('lets a higher-precedence overlay replace a file with a directory and a directory with a file', () => {
    const dir = root();
    const low = root();
    const high = root();
    writeFileSync(join(low, 'becomes-directory'), 'low file');
    mkdirSync(join(low, 'becomes-file'), { recursive: true });
    writeFileSync(join(low, 'becomes-file', 'nested'), 'low nested file');
    mkdirSync(join(high, 'becomes-directory'), { recursive: true });
    writeFileSync(join(high, 'becomes-directory', 'nested'), 'high nested file');
    writeFileSync(join(high, 'becomes-file'), 'high file');

    projectComposition(planWith([]), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
      extensionLoadDirs: [],
      configurationOverlayDirectories: [high, low],
    });

    expect(readFileSync(join(dir, 'becomes-directory', 'nested'), 'utf8')).toBe('high nested file');
    expect(readFileSync(join(dir, 'becomes-file'), 'utf8')).toBe('high file');
  });

  it('replaces an overlay directory when generated composition owns the same file path', () => {
    const dir = root();
    const overlay = root();
    mkdirSync(join(overlay, 'agent.md'), { recursive: true });
    writeFileSync(join(overlay, 'agent.md', 'nested'), 'overlay');

    projectComposition(planWith([]), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
      extensionLoadDirs: [],
      configurationOverlayDirectories: [overlay],
    });

    expect(readFileSync(join(dir, 'agent.md'), 'utf8')).toBe('Body.');
  });

  it('does not follow a symlinked native configuration overlay', () => {
    const dir = root();
    const external = root();
    const linked = join(root(), 'linked');
    writeFileSync(join(external, 'keybindings.json'), '{"outside":true}');
    symlinkSync(external, linked);

    projectComposition(planWith([]), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
      extensionLoadDirs: [],
      configurationOverlayDirectories: [linked],
    });

    expect(() => readFileSync(join(dir, 'keybindings.json'), 'utf8')).toThrow();
  });

  it('does not materialize a Pi configuration overlay for another harness', () => {
    const dir = root();
    const overlay = root();
    writeFileSync(join(overlay, 'keybindings.json'), '{"tui.editor.yank":"ctrl+shift+y"}');

    projectComposition(planWith([]), {
      harness: 'claude',
      rootDirectory: dir,
      homeDirectory: dir,
      configurationOverlayDirectories: [overlay],
    });

    expect(() => readFileSync(join(dir, 'keybindings.json'), 'utf8')).toThrow();
  });
});
