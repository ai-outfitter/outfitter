// Tests run: resolve → compose → project → launch, launch mapping, cleanup, and strict/validation.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createRunAgentCommand,
  executeRunAgentCommand,
  launchThroughSpawn,
} from '../../src/cli/commands/RunAgentCommand.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';
import type { SetupResult } from '../../src/setup/Setup.js';

const temporaryRoots: string[] = [];
let previousExitCode: typeof process.exitCode;

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-run-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

interface CapturedLaunch {
  readonly plan: AgentLaunchPlan;
  readonly runtimeDir: string;
  readonly dirExisted: boolean;
  readonly systemPrompt?: string;
  readonly skillPresent: boolean;
}

const captured: CapturedLaunch[] = [];

const launcher = (plan: AgentLaunchPlan): Promise<number> => {
  const runtimeDir = plan.env.PI_CODING_AGENT_DIR ?? plan.env.CLAUDE_CONFIG_DIR ?? '';
  const promptIndex = plan.args.indexOf('--system-prompt');
  captured.push({
    plan,
    runtimeDir,
    dirExisted: existsSync(runtimeDir),
    systemPrompt: promptIndex >= 0 ? readFileSync(plan.args[promptIndex + 1], 'utf8') : undefined,
    skillPresent: existsSync(join(runtimeDir, 'skills', 'wiki', 'SKILL.md')),
  });
  return Promise.resolve(0);
};

beforeEach(() => {
  previousExitCode = process.exitCode;
  captured.length = 0;
});

afterEach(() => {
  process.exitCode = previousExitCode;
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const tree = (): { home: string; project: string } => {
  const root = createTemporaryRoot();
  const home = join(root, 'home');
  const project = join(root, 'project');
  write(join(project, '.agents', 'system-prompt.md'), 'BASE PROMPT');
  write(join(project, '.agents', 'agents.md'), 'SHARED');
  write(join(project, '.agents', 'skills', 'wiki', 'SKILL.md'), '---\nname: wiki\n---\n\nWiki skill body.\n');
  write(join(project, '.agents', 'skills', 'wiki', 'scripts', 'go.sh'), 'echo hi'); // nested dir under the skill
  symlinkSync('/etc/hosts', join(project, '.agents', 'skills', 'wiki', 'inner-link')); // inner symlink skipped on materialize
  write(
    join(project, '.agents', 'agents', 'engineer', 'agent.md'),
    '---\nname: engineer\nskills: [wiki]\nmodel: gpt-5.2\nthinking: high\nextensions: [ext-a]\n---\n\n# Engineer\n',
  );
  return { home, project };
};

describe('run agent', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.1, OFTR-006.1).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('resolves, composes, projects, materializes skills, and launches an agent in pi', async () => {
    const { home, project } = tree();
    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'pi',
      passThroughArgs: ['--yolo'],
      launcher,
    });

    expect(result.exitCode).toBe(0);
    expect(result.launchPlan!.command).toBe('pi');
    const launch = captured[0];
    expect(launch.plan.args).toEqual(
      expect.arrayContaining([
        '--system-prompt',
        '--append-system-prompt',
        '--skill',
        'wiki',
        '--model',
        'gpt-5.2',
        '--thinking',
        'high',
        '--yolo',
      ]),
    );
    expect(launch.systemPrompt).toBe('BASE PROMPT'); // composed identity materialized
    expect(launch.skillPresent).toBe(true); // skill content copied, not an empty dir
  });

  it('cleans up the runtime projection directory after the run', async () => {
    const { home, project } = tree();
    await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'pi',
      launcher,
    });
    expect(captured[0].dirExisted).toBe(true); // existed during launch
    expect(existsSync(captured[0].runtimeDir)).toBe(false); // removed afterwards
  });

  it('maps model/thinking to claude flags and reports pi-only elements as unsupported', async () => {
    const { home, project } = tree();
    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      launcher,
    });

    const plan = result.launchPlan!;
    expect(plan.command).toBe('claude');
    expect(plan.env.CLAUDE_CONFIG_DIR).toBeDefined();
    expect(plan.args).toEqual(expect.arrayContaining(['--effort', 'high']));
    expect(plan.args).not.toContain('--skill'); // claude skills are materialized, not flagged
    expect(result.messages.join(' ')).toContain("cannot project loadout element 'extensions'");
  });

  it('fails under --strict on an unsupported element and never launches', async () => {
    const { home, project } = tree();
    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      strict: true,
      launcher,
    });
    expect(result.exitCode).toBe(1);
    expect(captured).toHaveLength(0);
    expect(result.messages.join(' ')).toContain('Strict mode');
  });

  it('fails under --strict on a composition warning (unresolved skill)', async () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\nskills: [ghost]\n---\n\nBody.\n',
    );
    const result = await executeRunAgentCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      agent: 'engineer',
      harness: 'pi',
      strict: true,
      launcher,
    });
    expect(result.exitCode).toBe(1);
    expect(captured).toHaveLength(0);
    expect(result.messages.join(' ')).toContain("unknown skill 'ghost'");
  });

  it('rejects an unknown harness', async () => {
    const { home, project } = tree();
    await expect(
      executeRunAgentCommand({
        homeDirectory: home,
        projectDirectory: project,
        agent: 'engineer',
        harness: 'codex',
        launcher,
      }),
    ).rejects.toThrow(/Unknown harness 'codex'/);
  });

  it('skips a skill whose directory escapes the tree via symlink and reports it unsupported', async () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    const external = join(root, 'external-skill');
    write(join(external, 'SKILL.md'), '---\nname: wiki\n---\n');
    write(
      join(project, '.agents', 'agents', 'engineer', 'agent.md'),
      '---\nname: engineer\nskills: [wiki]\n---\n\nBody.\n',
    );
    mkdirSync(join(project, '.agents', 'skills'), { recursive: true });
    symlinkSync(external, join(project, '.agents', 'skills', 'wiki'));

    const result = await executeRunAgentCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      agent: 'engineer',
      harness: 'pi',
      launcher,
    });
    expect(captured[0].skillPresent).toBe(false);
    expect(result.messages.join(' ')).toContain('escaping symlink');
  });

  it('uses default_agent and default_harness from settings', async () => {
    const { home, project } = tree();
    write(join(project, '.agents', 'settings.yml'), 'default_agent: engineer\ndefault_harness: pi\n');
    const result = await executeRunAgentCommand({ homeDirectory: home, projectDirectory: project, launcher });
    expect(result.launchPlan?.command).toBe('pi');
  });

  it('reports every non-projected loadout element as unsupported', async () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(join(project, '.agents', 'agents', 'reviewer', 'agent.md'), '---\nname: reviewer\n---\n\nReview.\n');
    write(
      join(project, '.agents', 'agents', 'lead', 'agent.md'),
      '---\nname: lead\nsubagents: [reviewer]\nmcp: [gh]\nplugins: [p]\nextensions: [e]\nmodel: m\nthinking: high\ntools:\n  allow: [read]\n---\n\nBody.\n',
    );
    const result = await executeRunAgentCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: project,
      agent: 'lead',
      harness: 'pi',
      launcher,
    });
    const messages = result.messages.join(' ');
    for (const element of ['subagents', 'mcp', 'plugins', 'tools']) {
      expect(messages).toContain(`loadout element '${element}'`);
    }
    // pi extensions are now projected, so a non-git/npm specifier is reported as an unsupported
    // source rather than a categorically unsupported loadout element.
    expect(messages).toContain("extension 'e' uses an unsupported source");
    expect(messages).not.toContain("loadout element 'extensions'");
  });

  it('installs pi extensions into the XDG cache and loads them with --extension', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    const xdg = join(root, 'xdg');
    write(
      join(project, '.agents', 'agents', 'dev', 'agent.md'),
      '---\nname: dev\nextensions: ["npm:pi-nolo", "git:github.com/ai-outfitter/deepwork"]\n---\n\nBody.\n',
    );
    const installed: string[] = [];
    const extensionInstallSpawner = ({ source, cacheAgentDir }: { source: string; cacheAgentDir: string }) => {
      installed.push(source);
      const segments = source.startsWith('npm:')
        ? ['npm', 'node_modules', source.slice('npm:'.length)]
        : ['git', ...source.slice('git:'.length).split('/')];
      write(join(cacheAgentDir, ...segments, 'package.json'), '{"name":"x","version":"1.0.0"}');
      return Promise.resolve(0);
    };

    const previousXdg = process.env.XDG_CACHE_HOME;
    process.env.XDG_CACHE_HOME = xdg;
    try {
      const result = await executeRunAgentCommand({
        homeDirectory: home,
        projectDirectory: project,
        agent: 'dev',
        harness: 'pi',
        launcher,
        extensionInstallSpawner,
      });

      expect(result.exitCode).toBe(0);
      const base = join(xdg, 'outfitter', 'pi-extensions');
      const nolo = join(base, 'npm', 'node_modules', 'pi-nolo');
      const deepwork = join(base, 'git', 'github.com', 'ai-outfitter', 'deepwork');
      const args = captured[0].plan.args;
      expect(args[args.indexOf(nolo) - 1]).toBe('--extension');
      expect(args[args.indexOf(deepwork) - 1]).toBe('--extension');
      expect(installed).toEqual(['npm:pi-nolo', 'git:github.com/ai-outfitter/deepwork']);
      expect(result.messages.join(' ')).not.toContain("loadout element 'extensions'");

      // Second run reuses the cache: no reinstall.
      installed.length = 0;
      captured.length = 0;
      await executeRunAgentCommand({
        homeDirectory: home,
        projectDirectory: project,
        agent: 'dev',
        harness: 'pi',
        launcher,
        extensionInstallSpawner,
      });
      expect(installed).toEqual([]);
      expect(captured[0].plan.args).toContain(nolo);
    } finally {
      if (previousXdg === undefined) delete process.env.XDG_CACHE_HOME;
      else process.env.XDG_CACHE_HOME = previousXdg;
    }
  });

  it('emits warnings before the pi session launches', async () => {
    const { home, project } = tree(); // engineer selects an unsupported extension (ext-a)
    const events: string[] = [];
    await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'pi',
      launcher: (plan) => {
        events.push('launch');
        return launcher(plan);
      },
      writeLine: (message) => events.push(`warn:${message}`),
    });

    const launchIndex = events.indexOf('launch');
    const warnIndex = events.findIndex((event) => event.startsWith('warn:') && event.includes("extension 'ext-a'"));
    expect(warnIndex).toBeGreaterThanOrEqual(0);
    expect(warnIndex).toBeLessThan(launchIndex);
  });

  it('retains the runtime projection directory when asked', async () => {
    const { home, project } = tree();
    await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'pi',
      retainProjection: true,
      launcher,
    });
    expect(existsSync(captured[0].runtimeDir)).toBe(true);
    rmSync(captured[0].runtimeDir, { recursive: true, force: true });
  });

  it('throws on invalid settings', async () => {
    const root = createTemporaryRoot();
    const project = join(root, 'project');
    write(join(project, '.agents', 'settings.yml'), 'default_harness: bun\n');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n\nBody.\n');
    await expect(
      executeRunAgentCommand({
        homeDirectory: join(root, 'home'),
        projectDirectory: project,
        agent: 'engineer',
        harness: 'pi',
        launcher,
      }),
    ).rejects.toThrow(/invalid settings/);
  });

  it('errors when no agent is selected and none is defaulted', async () => {
    const root = createTemporaryRoot();
    await expect(
      executeRunAgentCommand({ homeDirectory: join(root, 'home'), projectDirectory: join(root, 'project'), launcher }),
    ).rejects.toThrow(/No agent selected/);
  });

  it('returns a nonzero exit with errors for an unknown agent', async () => {
    const { home, project } = tree();
    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'ghost',
      launcher,
    });
    expect(result.exitCode).toBe(1);
    expect(result.messages[0]).toContain("Unknown agent 'ghost'");
  });

  it('drives the run command object through Commander parseAsync', async () => {
    const { home, project } = tree();
    const lines: string[] = [];
    const program = new Command();
    createRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      launcher,
      writeLine: (m) => lines.push(m),
    }).register(program);
    await program.parseAsync(['node', 'outfitter', 'run', 'engineer', '--harness', 'pi']);
    expect(captured[0]?.plan.command).toBe('pi');
    expect(captured[0]?.dirExisted).toBe(true);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.1, OFTR-010.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('runs implicit setup when nothing is configured, then launches the created agent', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    mkdirSync(project, { recursive: true });

    // A setup runner that scaffolds a minimal .agents home, exactly as onboarding would.
    const setup = (input: { homeDirectory: string }): Promise<SetupResult> => {
      write(
        join(input.homeDirectory, '.agents', 'agents', 'assistant', 'agent.md'),
        '---\nname: assistant\n---\n\nHi.\n',
      );
      write(join(input.homeDirectory, '.agents', 'settings.yml'), 'default_agent: assistant\ndefault_harness: pi\n');
      return Promise.resolve({
        created: [],
        updated: [],
        settingsPath: join(input.homeDirectory, '.agents', 'settings.yml'),
        defaultAgent: 'assistant',
        defaultHarness: 'pi' as const,
        messages: ['[setup] created a profile.'],
      });
    };

    const result = await executeRunAgentCommand({ homeDirectory: home, projectDirectory: project, launcher, setup });

    expect(result.exitCode).toBe(0);
    expect(result.launchPlan!.command).toBe('pi'); // launched the just-created default agent
    expect(result.messages).toContain('[setup] created a profile.');
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-010.1.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('falls back to the no-agent error when setup declines (non-interactive)', async () => {
    const root = createTemporaryRoot();
    const home = join(root, 'home');
    const project = join(root, 'project');
    mkdirSync(home, { recursive: true });
    mkdirSync(project, { recursive: true });

    await expect(
      executeRunAgentCommand({
        homeDirectory: home,
        projectDirectory: project,
        launcher,
        setup: () => Promise.resolve(undefined),
      }),
    ).rejects.toThrow(/No agent selected/);
  });

  // A missing CLI must be reported for the harness actually launched, not the built-in pi fallback
  // (regression: the default launcher's agentId once ignored the resolved harness).
  it('reports the launched harness and its install hint when the CLI is missing', async () => {
    const enoent = Object.assign(new Error('spawn claude ENOENT'), { code: 'ENOENT' });
    const failingSpawn = { launch: (): Promise<number> => Promise.reject(enoent) };
    const claudePlan: AgentLaunchPlan = { command: 'claude', args: [], env: { CLAUDE_CONFIG_DIR: '/tmp/x' } };

    await expect(launchThroughSpawn(failingSpawn, claudePlan)).rejects.toThrow(
      /Could not launch the 'claude' agent CLI.*claude\.com\/claude-code/s,
    );
  });
});
