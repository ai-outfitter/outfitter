// Tests the settings-layer Pi runtime-file overlay (`agent_defaults.pi_overlay`): projection
// precedence against the per-agent pi/ overlay and harness defaults, delivery to standalone
// agents, survival across the manifest-scoped subagent rebuild, non-Pi/strict reporting, and
// dump reporting.
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeDumpCommand } from '../../src/cli/commands/DumpCommand.js';
import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import type { CompositionPlan } from '../../src/composer/Composition.js';
import { materializeComposition, materializeConfigurationOverlays } from '../../src/projection/Materialize.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';
import type { ResolvedResource } from '../../src/resolver/Resource.js';

const roots: string[] = [];
const newRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'outfitter-pi-overlay-'));
  roots.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

const planWith = (subagentSlugs: readonly string[] = [], layerRoot = newRoot()): CompositionPlan => ({
  agent: 'lead',
  identity: { agentBody: 'Body.' },
  loadout: {
    skills: [],
    commands: [],
    delegateSkills: [],
    subagents: subagentSlugs.map((slug) => subagentResource(layerRoot, slug)),
    mcp: [],
    mcpServers: {},
    extensions: [],
    extensionDeclarations: [],
    plugins: [],
  },
  warnings: [],
});

/** A resolvable subagent definition under `<layerRoot>/agents/<slug>/agent.md`. */
const subagentResource = (layerRoot: string, slug: string): ResolvedResource => {
  const definitionPath = join(layerRoot, 'agents', slug, 'agent.md');
  write(definitionPath, `---\nname: ${slug}\ndescription: ${slug} delegate.\n---\n\n${slug} body.\n`);
  return {
    kind: 'agent',
    slug,
    winner: {
      kind: 'agent',
      slug,
      layer: { root: layerRoot, origin: 'workspace', label: 'workspace' },
      path: definitionPath,
    },
    shadowed: [],
  };
};

const overlayWith = (files: Readonly<Record<string, string>>): string => {
  const dir = newRoot();
  for (const [relativePath, content] of Object.entries(files)) write(join(dir, relativePath), content);
  return dir;
};

describe('settings-layer pi overlay projection', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.14).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('projects the settings overlay below the per-agent overlay and above generated defaults', () => {
    const dir = newRoot();
    const settingsOverlay = overlayWith({
      'agents/general-purpose.md': 'SETTINGS LAYER',
      'extensions/pruning.json': '{}',
      'settings.json': '{"theme":"settings-layer"}',
    });
    const perAgentOverlay = overlayWith({ 'agents/general-purpose.md': 'PER AGENT' });

    projectComposition(planWith(), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
      configurationOverlayDirectories: [perAgentOverlay],
      agentDefaultsOverlayDirectories: [settingsOverlay],
      harnessDefaults: { theme: 'harness-default' },
    });

    expect(readFileSync(join(dir, 'agents', 'general-purpose.md'), 'utf8')).toBe('PER AGENT');
    expect(readFileSync(join(dir, 'extensions', 'pruning.json'), 'utf8')).toBe('{}');
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
      theme: 'settings-layer',
      quietStartup: true,
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.12).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('composes multiple settings layers so the higher-precedence file replaces the lower', () => {
    const dir = newRoot();
    const userOverlay = overlayWith({
      'agents/general-purpose.md': 'USER LAYER',
      'extensions/pruning.json': '{}',
    });
    const projectOverlay = overlayWith({ 'agents/general-purpose.md': 'PROJECT LAYER' });

    projectComposition(planWith(), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
      agentDefaultsOverlayDirectories: [projectOverlay, userOverlay],
    });

    expect(readFileSync(join(dir, 'agents', 'general-purpose.md'), 'utf8')).toBe('PROJECT LAYER');
    expect(readFileSync(join(dir, 'extensions', 'pruning.json'), 'utf8')).toBe('{}');
  });

  it('warns when a declared overlay directory is missing or a symlink', () => {
    const missing = join(newRoot(), 'absent');
    const linked = join(newRoot(), 'link');
    symlinkSync(newRoot(), linked);

    for (const unusable of [missing, linked]) {
      const root = newRoot();
      const projection = projectComposition(planWith(), {
        harness: 'pi',
        rootDirectory: root,
        homeDirectory: root,
        agentDefaultsOverlayDirectories: [unusable],
      });

      expect(projection.warnings).toEqual([
        `agent_defaults pi overlay '${unusable}' is not a usable overlay directory (missing, not a directory, or a symlink).`,
      ]);
    }
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.15).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns for claude and codex that the settings-layer pi overlay cannot be projected', () => {
    const overlay = overlayWith({ 'agents/general-purpose.md': 'SETTINGS LAYER' });

    for (const harness of ['claude', 'codex'] as const) {
      const dir = newRoot();
      const projection = projectComposition(planWith(), {
        harness,
        rootDirectory: dir,
        homeDirectory: dir,
        agentDefaultsOverlayDirectories: [overlay],
      });

      expect(projection.warnings).toContain(
        `harness '${harness}' cannot project the settings-layer pi overlay (agent_defaults.pi_overlay); it will not be applied.`,
      );
      expect(existsSync(join(dir, 'agents', 'general-purpose.md'))).toBe(false);
    }
  });

  it('stays silent when no settings-layer overlay is configured', () => {
    const dir = newRoot();
    const projection = projectComposition(planWith(), {
      harness: 'claude',
      rootDirectory: dir,
      homeDirectory: dir,
    });

    expect(projection.warnings).toEqual([]);
  });
});

describe('settings-layer overlay and the subagent rebuild', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.14).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('keeps settings-layer agent definitions when the rebuild declares delegates', () => {
    const root = newRoot();
    const settingsOverlay = overlayWith({ 'agents/general-purpose.md': 'SETTINGS LAYER' });
    materializeConfigurationOverlays([settingsOverlay], root);

    materializeComposition(planWith(['reviewer']), root, 'pi');

    expect(readFileSync(join(root, 'agents', 'general-purpose.md'), 'utf8')).toBe('SETTINGS LAYER');
    expect(readFileSync(join(root, 'agents', 'reviewer.md'), 'utf8')).toContain('name: "reviewer"');
  });

  it('keeps settings-layer files when a retained root re-projects with fewer and then zero delegates', () => {
    const root = newRoot();
    const settingsOverlay = overlayWith({ 'agents/general-purpose.md': 'SETTINGS LAYER' });

    materializeConfigurationOverlays([settingsOverlay], root);
    materializeComposition(planWith(['reviewer', 'lead']), root, 'pi');
    materializeComposition(planWith(['reviewer']), root, 'pi');
    materializeComposition(planWith([]), root, 'pi');

    expect(readFileSync(join(root, 'agents', 'general-purpose.md'), 'utf8')).toBe('SETTINGS LAYER');
    expect(readdirSync(join(root, 'agents')).sort()).toEqual(['general-purpose.md']);
  });
});

describe('run with a settings-layer pi overlay', () => {
  interface CapturedRun {
    readonly plan: AgentLaunchPlan;
    readonly runtimeDir: string;
    readonly files: Readonly<Record<string, string | undefined>>;
  }
  const capturedRuns: CapturedRun[] = [];
  const readRuntimeFile = (runtimeDir: string, relativePath: string): string | undefined => {
    try {
      return readFileSync(join(runtimeDir, relativePath), 'utf8');
    } catch {
      return undefined;
    }
  };
  const launcher = (plan: AgentLaunchPlan): Promise<number> => {
    // The projection root is removed after the run, so capture runtime contents at launch time.
    const runtimeDir = plan.env.PI_CODING_AGENT_DIR ?? '';
    capturedRuns.push({
      plan,
      runtimeDir,
      files: {
        'agents/general-purpose.md': readRuntimeFile(runtimeDir, join('agents', 'general-purpose.md')),
        'extensions/dynamic-context-pruning.json': readRuntimeFile(
          runtimeDir,
          join('extensions', 'dynamic-context-pruning.json'),
        ),
      },
    });
    return Promise.resolve(0);
  };

  const runTree = (): { home: string; project: string } => {
    const root = newRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'system-prompt.md'), 'BASE PROMPT');
    write(
      join(project, '.agents', 'agents', 'solo', 'agent.md'),
      '---\nname: solo\n---\n\nStandalone agent with no inheritance and no pi/ overlay.\n',
    );
    return { home, project };
  };

  const writeProjectOverlay = (project: string): string => {
    const overlay = join(project, '.agents', 'pi-defaults');
    write(join(overlay, 'agents', 'general-purpose.md'), 'FLEET GENERAL PURPOSE');
    write(join(overlay, 'extensions', 'dynamic-context-pruning.json'), '{"enabled":true}');
    return overlay;
  };

  const writeOverlaySettings = (project: string): void => {
    write(join(project, '.agents', 'settings.yml'), 'agent_defaults:\n  pi_overlay: pi-defaults/\n');
  };

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.14).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('delivers the settings overlay to a standalone agent', async () => {
    const { home, project } = runTree();
    writeProjectOverlay(project);
    writeOverlaySettings(project);
    capturedRuns.length = 0;

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'solo',
      harness: 'pi',
      launcher,
    });

    expect(result.exitCode).toBe(0);
    expect(capturedRuns[0].files['agents/general-purpose.md']).toBe('FLEET GENERAL PURPOSE');
    expect(capturedRuns[0].files['extensions/dynamic-context-pruning.json']).toBe('{"enabled":true}');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.15).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('fails a strict claude run before launch when the overlay cannot be projected', async () => {
    const { home, project } = runTree();
    writeProjectOverlay(project);
    writeOverlaySettings(project);
    capturedRuns.length = 0;

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'solo',
      harness: 'claude',
      strict: true,
      launcher,
    });

    expect(result.exitCode).toBe(1);
    expect(result.messages.join('\n')).toContain('cannot project the settings-layer pi overlay');
    expect(capturedRuns).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.15).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('fails a strict pi run before launch when the overlay directory is missing', async () => {
    const { home, project } = runTree();
    write(join(project, '.agents', 'settings.yml'), 'agent_defaults:\n  pi_overlay: absent-dir/\n');
    capturedRuns.length = 0;

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'solo',
      harness: 'pi',
      strict: true,
      launcher,
    });

    expect(result.exitCode).toBe(1);
    expect(result.messages.join('\n')).toContain('is not a usable overlay directory');
    expect(capturedRuns).toEqual([]);
  });
});

describe('dump with a settings-layer pi overlay', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.15).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns that the overlay is not carried and omits the key from the dumped settings', () => {
    const root = newRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'system-prompt.md'), 'BASE');
    write(join(project, '.agents', 'agents', 'solo', 'agent.md'), '---\nname: solo\nskills: [wiki]\n---\n\nSolo.\n');
    write(join(project, '.agents', 'skills', 'wiki', 'SKILL.md'), '---\nname: wiki\n---\n\nWiki.\n');
    write(join(project, '.agents', 'pi-defaults', 'agents', 'general-purpose.md'), 'FLEET');
    write(
      join(project, '.agents', 'settings.yml'),
      'agent_defaults:\n  pi_overlay: pi-defaults/\n  skills:\n    - wiki\n',
    );
    const out = join(newRoot(), 'review');

    const result = executeDumpCommand({ homeDirectory: home, projectDirectory: project, agent: 'solo', out });

    expect(result.ok).toBe(true);
    expect(result.messages.join('\n')).toContain('not carried into the dumped tree');
    const dumpedSettings = readFileSync(join(out, '.agents', 'settings.yml'), 'utf8');
    expect(dumpedSettings).toContain('agent_defaults');
    expect(dumpedSettings).not.toContain('pi_overlay');
  });
});
