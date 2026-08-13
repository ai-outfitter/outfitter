// Tests pi/claude extension projection: --extension args and extension unsupported-set handling.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { CompositionPlan } from '../../src/composer/Composition.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';
import type { ResolvedResource } from '../../src/resolver/Resource.js';

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
  loadout: {
    skills: [],
    delegateSkills: [],
    subagents: [],
    mcp: [],
    mcpServers: {},
    extensions: [...extensions],
    plugins: [],
  },
  warnings: [],
});

describe('projectComposition prompt templates', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('projects prompt_template for pi and reports it unsupported for claude', () => {
    const piDir = root();
    const claudeDir = root();
    const templatePlan: CompositionPlan = {
      ...planWith([]),
      identity: {
        agentBody: 'Body.',
        promptTemplate: {
          kind: 'file',
          content: 'Template {{input}}',
          label: 'template',
          trust: 'catalog',
        },
      },
    };

    const pi = projectComposition(templatePlan, { harness: 'pi', rootDirectory: piDir, homeDirectory: piDir });
    const claude = projectComposition(templatePlan, {
      harness: 'claude',
      rootDirectory: claudeDir,
      homeDirectory: claudeDir,
    });

    expect(pi.launch.args).toContain('--prompt-template');
    expect(readFileSync(join(piDir, 'prompt-template.md'), 'utf8')).toBe('Template {{input}}');
    expect(pi.unsupported).not.toContain('prompt_template');
    expect(claude.launch.args).not.toContain('--prompt-template');
    expect(claude.unsupported).toContain('prompt_template');
  });
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

describe('projectComposition Claude MCP projection', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.11).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('passes selected MCP servers through an isolated Claude MCP config', () => {
    const dir = root();
    const plan = planWith([]);
    const projection = projectComposition(
      {
        ...plan,
        loadout: {
          ...plan.loadout,
          mcp: ['github'],
          mcpServers: { github: { command: 'github-mcp-server' } },
        },
      },
      { harness: 'claude', rootDirectory: dir, homeDirectory: dir },
    );

    expect(projection.launch.args).toEqual(
      expect.arrayContaining(['--mcp-config', join(dir, 'mcp.json'), '--strict-mcp-config']),
    );
    expect(JSON.parse(readFileSync(join(dir, 'mcp.json'), 'utf8'))).toEqual({
      mcpServers: { github: { command: 'github-mcp-server' } },
    });
    expect(projection.unsupported).not.toContain('mcp');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.5.11).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('replaces a conflicting directory with an isolated empty Claude MCP config', () => {
    const dir = root();
    mkdirSync(join(dir, 'mcp.json'));
    const projection = projectComposition(planWith([]), {
      harness: 'claude',
      rootDirectory: dir,
      homeDirectory: dir,
    });

    expect(projection.launch.args).toEqual(
      expect.arrayContaining(['--mcp-config', join(dir, 'mcp.json'), '--strict-mcp-config']),
    );
    expect(JSON.parse(readFileSync(join(dir, 'mcp.json'), 'utf8'))).toEqual({ mcpServers: {} });
  });
});

const subagentResource = (slug: string, path: string, layerRoot: string): ResolvedResource => ({
  kind: 'agent',
  slug,
  winner: {
    kind: 'agent',
    slug,
    path,
    layer: { root: layerRoot, origin: 'workspace', label: 'workspace' },
  },
  shadowed: [],
});

const skillResource = (slug: string, path: string, layerRoot: string): ResolvedResource => ({
  kind: 'skill',
  slug,
  winner: {
    kind: 'skill',
    slug,
    path,
    layer: { root: layerRoot, origin: 'workspace', label: 'workspace' },
  },
  shadowed: [],
});

describe('projectComposition Pi delegates', () => {
  it('materializes a minimal selected subagent with a usable fallback description', () => {
    const dir = root();
    const catalog = root();
    const path = join(catalog, 'agents', 'reviewer', 'agent.md');
    mkdirSync(join(catalog, 'agents', 'reviewer'), { recursive: true });
    writeFileSync(path, '---\nname: reviewer\n---\n\nReview carefully.\n');
    const plan = planWith([]);
    const projection = projectComposition(
      { ...plan, loadout: { ...plan.loadout, subagents: [subagentResource('reviewer', path, catalog)] } },
      {
        harness: 'pi',
        rootDirectory: dir,
        homeDirectory: dir,
      },
    );

    expect(readFileSync(join(dir, 'agents', 'reviewer.md'), 'utf8')).toContain(
      'description: "Delegated reviewer agent."',
    );
    expect(projection.unsupported).not.toContain('subagents');
  });

  it('serializes selected delegate controls and writes only selected MCP servers', () => {
    const dir = root();
    const catalog = root();
    const path = join(catalog, 'agents', 'reviewer', 'agent.md');
    mkdirSync(join(catalog, 'agents', 'reviewer'), { recursive: true });
    writeFileSync(
      path,
      [
        '---',
        'name: reviewer',
        'description: Reviews implementation changes.',
        'skills: [review, style]',
        'extensions: [npm:review-extension, git:github.com/example/review]',
        'model: review-model',
        'thinking: high',
        'tools:',
        '  allow: [read, bash, write]',
        '  deny: [bash]',
        '---',
        '',
        'Review carefully.',
        '',
      ].join('\n'),
    );
    const reviewSkill = join(catalog, 'skills', 'review', 'SKILL.md');
    const styleSkill = join(catalog, 'skills', 'style', 'SKILL.md');
    mkdirSync(join(catalog, 'skills', 'review'), { recursive: true });
    mkdirSync(join(catalog, 'skills', 'style'), { recursive: true });
    writeFileSync(reviewSkill, '---\nname: review\n---\n\nReview skill.\n');
    writeFileSync(styleSkill, '---\nname: style\n---\n\nStyle skill.\n');
    const plan = planWith([]);
    const projection = projectComposition(
      {
        ...plan,
        loadout: {
          ...plan.loadout,
          delegateSkills: [skillResource('review', reviewSkill, catalog), skillResource('style', styleSkill, catalog)],
          subagents: [subagentResource('reviewer', path, catalog)],
          mcp: ['playwright'],
          mcpServers: { playwright: { command: 'playwright-mcp' } },
        },
      },
      {
        harness: 'pi',
        rootDirectory: dir,
        homeDirectory: dir,
      },
    );

    const reviewer = readFileSync(join(dir, 'agents', 'reviewer.md'), 'utf8');
    expect(reviewer).toContain('description: "Reviews implementation changes."');
    expect(reviewer).toContain('model: "review-model"');
    expect(reviewer).toContain('thinking: "high"');
    expect(reviewer).toContain('tools: "read, write"');
    expect(reviewer).toContain('skills: "review, style"');
    expect(reviewer).toContain('extensions: "npm:review-extension, git:github.com/example/review"');
    expect(reviewer).toContain('Review carefully.');
    expect(readFileSync(join(dir, 'skills', 'review', 'SKILL.md'), 'utf8')).toContain('Review skill.');
    expect(readFileSync(join(dir, 'skills', 'style', 'SKILL.md'), 'utf8')).toContain('Style skill.');
    expect(projection.launch.args).not.toContain('review');
    expect(projection.launch.args).not.toContain('style');
    expect(JSON.parse(readFileSync(join(dir, 'mcp.json'), 'utf8'))).toEqual({
      mcpServers: { playwright: { command: 'playwright-mcp' } },
    });
  });

  it('reports a selected subagent whose definition cannot be materialized', () => {
    const dir = root();
    const catalog = root();
    const path = join(catalog, 'agents', 'broken', 'agent.md');
    mkdirSync(join(catalog, 'agents', 'broken'), { recursive: true });
    writeFileSync(path, 'missing frontmatter');
    const plan = planWith([]);
    const projection = projectComposition(
      { ...plan, loadout: { ...plan.loadout, subagents: [subagentResource('broken', path, catalog)] } },
      {
        harness: 'pi',
        rootDirectory: dir,
        homeDirectory: dir,
      },
    );

    expect(projection.unsupported).toContain('subagent:broken (invalid definition)');
  });

  it('reports a selected subagent whose declared name does not match its slug', () => {
    const dir = root();
    const catalog = root();
    const path = join(catalog, 'agents', 'reviewer', 'agent.md');
    mkdirSync(join(catalog, 'agents', 'reviewer'), { recursive: true });
    writeFileSync(path, '---\nname: other\n---\n\nReview carefully.\n');
    const plan = planWith([]);
    const projection = projectComposition(
      { ...plan, loadout: { ...plan.loadout, subagents: [subagentResource('reviewer', path, catalog)] } },
      {
        harness: 'pi',
        rootDirectory: dir,
        homeDirectory: dir,
      },
    );

    expect(projection.unsupported).toContain('subagent:reviewer (invalid definition)');
    expect(() => readFileSync(join(dir, 'agents', 'reviewer.md'), 'utf8')).toThrow();
  });

  it('accepts a config-only overlay layer for a selected subagent', () => {
    const dir = root();
    const catalog = root();
    const overlay = root();
    const path = join(catalog, 'agents', 'reviewer', 'agent.md');
    const configPath = join(overlay, 'agents', 'reviewer', 'config.json');
    mkdirSync(join(catalog, 'agents', 'reviewer'), { recursive: true });
    mkdirSync(join(overlay, 'agents', 'reviewer'), { recursive: true });
    writeFileSync(path, '---\nname: reviewer\n---\n\nReview carefully.\n');
    writeFileSync(configPath, '{"model":"review-model"}');
    const plan = planWith([]);
    const reviewer = {
      ...subagentResource('reviewer', path, catalog),
      configPaths: [configPath],
      configLayerRoots: [overlay],
    };
    const projection = projectComposition(
      { ...plan, loadout: { ...plan.loadout, subagents: [reviewer] } },
      {
        harness: 'pi',
        rootDirectory: dir,
        homeDirectory: dir,
      },
    );

    expect(readFileSync(join(dir, 'agents', 'reviewer.md'), 'utf8')).toContain('model: "review-model"');
    expect(projection.unsupported).not.toContain('subagents');
  });

  it('does not materialize a selected subagent through an escaping symlink', () => {
    const dir = root();
    const catalog = root();
    const external = join(root(), 'outside-agent.md');
    const path = join(catalog, 'agents', 'linked', 'agent.md');
    writeFileSync(external, '---\nname: linked\n---\n\nOutside.\n');
    mkdirSync(join(catalog, 'agents', 'linked'), { recursive: true });
    symlinkSync(external, path);
    const plan = planWith([]);
    const linked = subagentResource('linked', path, catalog);
    const projection = projectComposition(
      {
        ...plan,
        loadout: {
          ...plan.loadout,
          subagents: [
            {
              ...linked,
              shadowed: [
                {
                  kind: 'agent',
                  slug: 'linked',
                  path,
                  layer: { root: catalog, origin: 'global', label: 'global' },
                },
              ],
            },
          ],
        },
      },
      {
        harness: 'pi',
        rootDirectory: dir,
        homeDirectory: dir,
      },
    );

    expect(projection.unsupported).toContain('subagent:linked (invalid definition)');
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
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
      theme: 'dark',
      quietStartup: true,
    });
    expect(readFileSync(join(dir, 'themes', 'shared.json'), 'utf8')).toContain('high');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.6).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('defaults Pi to quiet startup while preserving an explicit profile override', () => {
    const quietDir = root();
    projectComposition(planWith([]), { harness: 'pi', rootDirectory: quietDir, homeDirectory: quietDir });
    expect(JSON.parse(readFileSync(join(quietDir, 'settings.json'), 'utf8'))).toEqual({ quietStartup: true });

    const verboseDir = root();
    const overlay = root();
    writeFileSync(join(overlay, 'settings.json'), '{"quietStartup":false,"theme":"light"}');
    projectComposition(planWith([]), {
      harness: 'pi',
      rootDirectory: verboseDir,
      homeDirectory: verboseDir,
      configurationOverlayDirectories: [overlay],
    });
    expect(JSON.parse(readFileSync(join(verboseDir, 'settings.json'), 'utf8'))).toEqual({
      quietStartup: false,
      theme: 'light',
    });
  });

  it('preserves malformed and non-object native Pi settings for Pi to diagnose', () => {
    for (const content of ['not json', 'null', '[]', 'true']) {
      const dir = root();
      const overlay = root();
      writeFileSync(join(overlay, 'settings.json'), content);
      projectComposition(planWith([]), {
        harness: 'pi',
        rootDirectory: dir,
        homeDirectory: dir,
        configurationOverlayDirectories: [overlay],
      });
      expect(readFileSync(join(dir, 'settings.json'), 'utf8')).toBe(content);
    }
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.3, OFTR-006.3.17).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
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

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.17).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('preserves an overlay MCP config when the composition selects no servers', () => {
    const dir = root();
    const overlay = root();
    writeFileSync(join(overlay, 'mcp.json'), '{"mcpServers":{"native":{"command":"native-mcp"}}}');

    projectComposition(planWith([]), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
      extensionLoadDirs: [],
      configurationOverlayDirectories: [overlay],
    });

    expect(JSON.parse(readFileSync(join(dir, 'mcp.json'), 'utf8'))).toEqual({
      mcpServers: { native: { command: 'native-mcp' } },
    });
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
