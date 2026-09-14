// Tests the settings-layer extension config surface (`agent_defaults.extension_configs`):
// delivery of `extensions/<name>.json` to every Pi projection as generated defaults, precedence
// against the per-agent pi/ overlay and the settings-layer pi_overlay, standalone-agent delivery,
// non-Pi/strict reporting, and dump reporting.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { executeDumpCommand } from '../../src/cli/commands/DumpCommand.js';
import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import type { CompositionPlan } from '../../src/composer/Composition.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';

const roots: string[] = [];
const newRoot = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'outfitter-extension-configs-'));
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

const planWith = (): CompositionPlan => ({
  agent: 'lead',
  identity: { agentBody: 'Body.' },
  loadout: {
    skills: [],
    delegateSkills: [],
    subagents: [],
    mcp: [],
    mcpServers: {},
    extensions: [],
    plugins: [],
  },
  warnings: [],
});

const extensionConfigs = {
  'dynamic-context-pruning': { rejectedSummaryMode: 'reject' },
};

const readRuntimeConfig = (rootDirectory: string, name: string): string | undefined => {
  const path = join(rootDirectory, 'extensions', `${name}.json`);
  return existsSync(path) ? readFileSync(path, 'utf8') : undefined;
};

describe('extension config projection', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.18).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('writes every merged entry and leaves native settings to harness defaults', () => {
    const dir = newRoot();

    projectComposition(planWith(), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
      agentDefaultsExtensionConfigs: extensionConfigs,
      harnessDefaults: { theme: 'harness-default' },
    });

    expect(JSON.parse(readRuntimeConfig(dir, 'dynamic-context-pruning')!)).toEqual({
      rejectedSummaryMode: 'reject',
    });
    expect(JSON.parse(readFileSync(join(dir, 'settings.json'), 'utf8'))).toEqual({
      theme: 'harness-default',
      quietStartup: true,
    });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.18).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('delivers a generated config to a Pi projection with no selected extensions and no overlay', () => {
    const dir = newRoot();

    projectComposition(planWith(), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
      agentDefaultsExtensionConfigs: extensionConfigs,
    });

    expect(existsSync(join(dir, 'extensions', 'dynamic-context-pruning.json'))).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.18).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('lets the per-agent pi overlay replace a generated same-named config', () => {
    const dir = newRoot();
    const perAgentOverlay = join(newRoot(), 'pi');
    write(join(perAgentOverlay, 'extensions', 'dynamic-context-pruning.json'), '{"rejectedSummaryMode":"summary"}');

    projectComposition(planWith(), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
      configurationOverlayDirectories: [perAgentOverlay],
      agentDefaultsExtensionConfigs: extensionConfigs,
    });

    expect(JSON.parse(readRuntimeConfig(dir, 'dynamic-context-pruning')!)).toEqual({ rejectedSummaryMode: 'summary' });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.18).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('lets the settings-layer pi_overlay replace a generated same-named config', () => {
    const dir = newRoot();
    const settingsOverlay = join(newRoot(), 'overlay');
    write(join(settingsOverlay, 'extensions', 'dynamic-context-pruning.json'), '{"rejectedSummaryMode":"summary"}');

    projectComposition(planWith(), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
      agentDefaultsOverlayDirectories: [settingsOverlay],
      agentDefaultsExtensionConfigs: extensionConfigs,
    });

    expect(JSON.parse(readRuntimeConfig(dir, 'dynamic-context-pruning')!)).toEqual({ rejectedSummaryMode: 'summary' });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.19).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns for claude and codex that extension configs cannot be projected', () => {
    for (const harness of ['claude', 'codex'] as const) {
      const dir = newRoot();
      const projection = projectComposition(planWith(), {
        harness,
        rootDirectory: dir,
        homeDirectory: dir,
        agentDefaultsExtensionConfigs: extensionConfigs,
      });

      expect(projection.warnings).toContain(
        `harness '${harness}' cannot project the settings-layer extension configs (agent_defaults.extension_configs); they will not be applied.`,
      );
      expect(existsSync(join(dir, 'extensions'))).toBe(false);
    }
  });

  it('stays silent when no extension configs are configured', () => {
    const dir = newRoot();
    const projection = projectComposition(planWith(), {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
    });

    expect(projection.warnings).toEqual([]);
    expect(existsSync(join(dir, 'extensions'))).toBe(false);
  });
});

describe('run with extension configs', () => {
  interface CapturedRun {
    readonly exitCode: number;
    readonly messages: readonly string[];
    readonly runtimeDir: string;
    readonly configContent: string | undefined;
  }
  const capturedRuns: CapturedRun[] = [];
  const launcher = (plan: AgentLaunchPlan): Promise<number> => {
    // The projection root is removed after the run, so capture runtime contents at launch time.
    const runtimeDir = plan.env.PI_CODING_AGENT_DIR ?? '';
    capturedRuns.push({
      exitCode: 0,
      messages: [],
      runtimeDir,
      configContent: readRuntimeConfig(runtimeDir, 'dynamic-context-pruning'),
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

  const writeExtensionConfigSettings = (project: string, loadoutLine?: string): void => {
    write(
      join(project, '.agents', 'settings.yml'),
      `agent_defaults:\n  extension_configs:\n    dynamic-context-pruning:\n      rejectedSummaryMode: reject\n${loadoutLine ?? ''}`,
    );
  };

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.18).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('delivers the config file to a standalone non-inheriting agent', async () => {
    const { home, project } = runTree();
    writeExtensionConfigSettings(project);
    capturedRuns.length = 0;

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'solo',
      harness: 'pi',
      launcher,
    });

    expect(result.exitCode).toBe(0);
    expect(capturedRuns[0].configContent).toContain('"rejectedSummaryMode": "reject"');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.16).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('composes cleanly when agent_defaults declares only extension_configs', async () => {
    const { home, project } = runTree();
    writeExtensionConfigSettings(project);
    capturedRuns.length = 0;

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'solo',
      harness: 'pi',
      launcher,
    });

    expect(result.exitCode).toBe(0);
    expect(result.messages.join('\n')).not.toContain('agent_defaults');
    expect(capturedRuns[0].configContent).not.toBeUndefined();
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.19).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('fails a strict claude run before launch when extension configs are configured', async () => {
    const { home, project } = runTree();
    writeExtensionConfigSettings(project);
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
    expect(result.messages.join('\n')).toContain('cannot project the settings-layer extension configs');
    expect(capturedRuns).toEqual([]);
  });
});

describe('dump with extension configs', () => {
  const dumpTree = (): { home: string; project: string; out: string } => {
    const root = newRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    write(join(project, '.agents', 'system-prompt.md'), 'BASE');
    write(join(project, '.agents', 'agents', 'solo', 'agent.md'), '---\nname: solo\nskills: [wiki]\n---\n\nSolo.\n');
    write(join(project, '.agents', 'skills', 'wiki', 'SKILL.md'), '---\nname: wiki\n---\n\nWiki.\n');
    write(
      join(project, '.agents', 'settings.yml'),
      'agent_defaults:\n  extension_configs:\n    dynamic-context-pruning:\n      rejectedSummaryMode: reject\n  skills:\n    - wiki\n',
    );
    return { project, out: join(newRoot(), 'review'), home };
  };

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.19).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('warns that the configs are not carried and omits the key from the dumped settings', () => {
    const { home, project, out } = dumpTree();

    const result = executeDumpCommand({ homeDirectory: home, projectDirectory: project, agent: 'solo', out });

    expect(result.ok).toBe(true);
    expect(result.messages.join('\n')).toContain('not carried into the dumped tree');
    const dumpedSettings = readFileSync(join(out, '.agents', 'settings.yml'), 'utf8');
    expect(dumpedSettings).toContain('agent_defaults');
    expect(dumpedSettings).toContain('skills');
    expect(dumpedSettings).not.toContain('extension_configs');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-002.10.19).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('produces deterministic dump output across runs', () => {
    const { home, project } = dumpTree();
    const first = join(newRoot(), 'first');
    const second = join(newRoot(), 'second');

    const firstResult = executeDumpCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'solo',
      out: first,
    });
    const secondResult = executeDumpCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'solo',
      out: second,
    });

    expect(firstResult.ok).toBe(true);
    expect(secondResult.ok).toBe(true);
    const relative = (out: string, paths: readonly string[]): readonly string[] =>
      paths.map((path) => path.slice(out.length + 1));
    expect(relative(second, secondResult.writtenPaths)).toEqual(relative(first, firstResult.writtenPaths));
    expect(readFileSync(join(second, '.agents', 'settings.yml'), 'utf8')).toBe(
      readFileSync(join(first, '.agents', 'settings.yml'), 'utf8'),
    );
  });
});
