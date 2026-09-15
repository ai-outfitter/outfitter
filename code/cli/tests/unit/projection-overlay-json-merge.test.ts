// Tests the JSON deep-merge semantics of pi/ overlay materialization: cross-layer object merge,
// scalar and array override policy, non-JSON and non-object passthrough, malformed-JSON warning
// and fallback, per-agent vs settings-layer tier collisions, determinism, and the untouched
// generated-file tiers.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import { materializeConfigurationOverlays } from '../../src/projection/Materialize.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';
import type { CompositionPlan } from '../../src/composer/Composition.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';

const roots: string[] = [];
const newRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'outfitter-overlay-merge-'));
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

const overlayWith = (files: Readonly<Record<string, string>>): string => {
  const dir = newRoot();
  for (const [relativePath, content] of Object.entries(files)) write(join(dir, relativePath), content);
  return dir;
};

const readRoot = (root: string, relativePath: string): string => readFileSync(join(root, relativePath), 'utf8');

const planWith = (): CompositionPlan => ({
  agent: 'lead',
  identity: { agentBody: 'Body.' },
  loadout: {
    skills: [],
    commands: [],
    delegateSkills: [],
    subagents: [],
    mcp: [],
    mcpServers: {},
    extensions: [],
    extensionDeclarations: [],
    plugins: [],
  },
  warnings: [],
});

describe('overlay JSON deep-merge across layers', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.27).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('merges an additive child mcp.json without wiping the parent servers', () => {
    const parent = overlayWith({ 'mcp.json': '{"mcpServers":{"alpha":{"command":"run-a"}}}' });
    const child = overlayWith({ 'mcp.json': '{"mcpServers":{"beta":{"command":"run-b"}}}' });
    const root = newRoot();

    materializeConfigurationOverlays([child, parent], root, { warnings: [] });

    expect(JSON.parse(readRoot(root, 'mcp.json'))).toEqual({
      mcpServers: { alpha: { command: 'run-a' }, beta: { command: 'run-b' } },
    });
  });

  it('merges deeply nested objects at every level', () => {
    const parent = overlayWith({ 'settings.json': '{"a":{"b":{"c":1,"d":2}}}' });
    const child = overlayWith({ 'settings.json': '{"a":{"b":{"c":9},"e":{"f":3}}}' });
    const root = newRoot();

    materializeConfigurationOverlays([child, parent], root, { warnings: [] });

    expect(JSON.parse(readRoot(root, 'settings.json'))).toEqual({ a: { b: { c: 9, d: 2 }, e: { f: 3 } } });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.27).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('overrides scalars and replaces arrays with the higher layer documents', () => {
    const parent = overlayWith({ 'extensions/pruning.json': '{"mode":"fast","tags":["x"],"n":1}' });
    const child = overlayWith({ 'extensions/pruning.json': '{"mode":"slow","tags":["y"],"n":2}' });
    const root = newRoot();

    materializeConfigurationOverlays([child, parent], root, { warnings: [] });

    expect(JSON.parse(readRoot(root, join('extensions', 'pruning.json')))).toEqual({
      mode: 'slow',
      tags: ['y'],
      n: 2,
    });
  });

  it('writes merged JSON in canonical 2-space formatting with a trailing newline', () => {
    const parent = overlayWith({ 'settings.json': '{"a":1}' });
    const child = overlayWith({ 'settings.json': '{"b":2}' });
    const root = newRoot();

    materializeConfigurationOverlays([child, parent], root, { warnings: [] });

    expect(readRoot(root, 'settings.json')).toBe('{\n  "a": 1,\n  "b": 2\n}\n');
  });

  it('produces byte-identical merged files across repeated projections', () => {
    const files = (tier: string): Readonly<Record<string, string>> => ({
      'settings.json': `{"tier":"${tier}","nested":{"shared":{"${tier}":1}}}`,
      'mcp.json': `{"mcpServers":{"${tier}":{"command":"run-${tier}"}}}`,
    });
    const parentA = overlayWith(files('parent'));
    const childA = overlayWith(files('child'));
    const parentB = overlayWith(files('parent'));
    const childB = overlayWith(files('child'));
    const rootA = newRoot();
    const rootB = newRoot();

    materializeConfigurationOverlays([childA, parentA], rootA, { warnings: [] });
    materializeConfigurationOverlays([childB, parentB], rootB, { warnings: [] });

    for (const relativePath of ['settings.json', 'mcp.json']) {
      expect(readRoot(rootB, relativePath)).toBe(readRoot(rootA, relativePath));
    }
  });
});

describe('non-mergeable overlay files keep whole-file replacement', () => {
  it('replaces non-JSON files wholesale', () => {
    const parent = overlayWith({ 'agents/general-purpose.md': 'PARENT' });
    const child = overlayWith({ 'agents/general-purpose.md': 'CHILD' });
    const root = newRoot();

    materializeConfigurationOverlays([child, parent], root, { warnings: [] });

    expect(readRoot(root, join('agents', 'general-purpose.md'))).toBe('CHILD');
  });

  it('replaces with a valid non-object JSON document without a warning', () => {
    const parent = overlayWith({ 'data.json': '{"k":1}' });
    const child = overlayWith({ 'data.json': '[1,2]' });
    const root = newRoot();
    const warnings: string[] = [];

    materializeConfigurationOverlays([child, parent], root, { warnings });

    expect(readRoot(root, 'data.json')).toBe('[1,2]');
    expect(warnings).toEqual([]);
  });

  it('replaces a malformed lower-precedence file silently when the higher document is valid', () => {
    const parent = overlayWith({ 'settings.json': '{"broken' });
    const child = overlayWith({ 'settings.json': '{"k":1}' });
    const root = newRoot();
    const warnings: string[] = [];

    materializeConfigurationOverlays([child, parent], root, { warnings });

    expect(JSON.parse(readRoot(root, 'settings.json'))).toEqual({ k: 1 });
    expect(warnings).toEqual([]);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.27).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns and falls back to whole-file replacement when the higher JSON is malformed', () => {
    const parent = overlayWith({ 'mcp.json': '{"mcpServers":{"alpha":{}}}' });
    const child = overlayWith({ 'mcp.json': '{"mcpServers":' });
    const root = newRoot();
    const warnings: string[] = [];

    materializeConfigurationOverlays([child, parent], root, { warnings });

    expect(readRoot(root, 'mcp.json')).toBe('{"mcpServers":');
    expect(warnings).toEqual([
      `overlay JSON file '${join(child, 'mcp.json')}' is not valid JSON; it replaces the lower-precedence file instead of merging.`,
    ]);
  });
});

describe('overlay tier collisions and generated tiers', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.27).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('merges the per-agent overlay over the settings layer with most-specific-wins', () => {
    const dir = newRoot();
    const settingsOverlay = overlayWith({ 'settings.json': '{"fleet":"settings-layer","mode":"settings-layer"}' });
    const perAgentOverlay = overlayWith({ 'settings.json': '{"agent":"per-agent","mode":"per-agent"}' });

    projectComposition(planWith(), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
      configurationOverlayDirectories: [perAgentOverlay],
      agentDefaultsOverlayDirectories: [settingsOverlay],
    });

    expect(JSON.parse(readRoot(dir, 'settings.json'))).toEqual({
      fleet: 'settings-layer',
      agent: 'per-agent',
      mode: 'per-agent',
      quietStartup: true,
    });
  });

  it('replaces a generated extension config file wholesale instead of merging', () => {
    const dir = newRoot();
    const overlay = overlayWith({ 'extensions/pruning.json': '{"overlay":true}' });

    projectComposition(planWith(), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
      agentDefaultsOverlayDirectories: [overlay],
      agentDefaultsExtensionConfigs: { pruning: { generated: true, keep: 'generated' } },
    });

    expect(JSON.parse(readRoot(dir, join('extensions', 'pruning.json')))).toEqual({ overlay: true });
  });

  it('keeps the generated settings reconciliation below an overlay settings document', () => {
    const dir = newRoot();
    const overlay = overlayWith({ 'settings.json': '{"theme":"overlay"}' });

    projectComposition(planWith(), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
      agentDefaultsOverlayDirectories: [overlay],
      harnessDefaults: { theme: 'harness-default', only: 'default' },
    });

    expect(JSON.parse(readRoot(dir, 'settings.json'))).toEqual({
      theme: 'overlay',
      only: 'default',
      quietStartup: true,
    });
  });
});

describe('run with colliding overlay JSON', () => {
  interface CapturedRun {
    readonly plan: AgentLaunchPlan;
    readonly mcpJson: string | undefined;
  }
  const capturedRuns: CapturedRun[] = [];
  const launcher = (plan: AgentLaunchPlan): Promise<number> => {
    const runtimeDir = plan.env.PI_CODING_AGENT_DIR ?? '';
    let mcpJson: string | undefined;
    try {
      mcpJson = readFileSync(join(runtimeDir, 'mcp.json'), 'utf8');
    } catch {
      mcpJson = undefined;
    }
    capturedRuns.push({ plan, mcpJson });
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

  const declareOverlay = (agentsDirectory: string, relativeOverlay: string): void => {
    write(join(agentsDirectory, 'settings.yml'), `agent_defaults:\n  pi_overlay: ${relativeOverlay}\n`);
  };

  it('warns without failing a non-strict run, delivering the raw higher-layer file', async () => {
    const { home, project } = runTree();
    const userOverlay = join(home, '.agents', 'user-overlay');
    write(join(userOverlay, 'mcp.json'), '{"mcpServers":{"alpha":{"command":"run-a"}}}');
    const projectOverlay = join(project, '.agents', 'project-overlay');
    write(join(projectOverlay, 'mcp.json'), '{"mcpServers":');
    declareOverlay(join(home, '.agents'), 'user-overlay');
    declareOverlay(join(project, '.agents'), 'project-overlay');
    capturedRuns.length = 0;

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'solo',
      harness: 'pi',
      launcher,
    });

    expect(result.exitCode).toBe(0);
    expect(result.messages.join('\n')).toContain('is not valid JSON');
    expect(capturedRuns[0].mcpJson).toBe('{"mcpServers":');
  });

  it('fails a strict run before launch on the malformed overlay JSON warning', async () => {
    const { home, project } = runTree();
    const userOverlay = join(home, '.agents', 'user-overlay');
    write(join(userOverlay, 'mcp.json'), '{"mcpServers":{"alpha":{"command":"run-a"}}}');
    const projectOverlay = join(project, '.agents', 'project-overlay');
    write(join(projectOverlay, 'mcp.json'), '{"mcpServers":');
    declareOverlay(join(home, '.agents'), 'user-overlay');
    declareOverlay(join(project, '.agents'), 'project-overlay');
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
    expect(result.messages.join('\n')).toContain('is not valid JSON');
    expect(capturedRuns).toEqual([]);
  });
});
