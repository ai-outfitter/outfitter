// Verifies pi session transcripts survive Outfitter's ephemeral projection root: pi is pointed at
// its durable per-project session store, so `--continue` finds the previous conversation next run.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  PI_SESSION_DIRECTORY_ENV,
  resolvePiSessionDirectory,
  resolvePiUserSessionDirectory,
} from '../../src/agents/PiSessionDirectory.js';
import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import type { CompositionPlan } from '../../src/composer/Composition.js';
import { projectComposition } from '../../src/projection/ProjectHarness.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';

const roots: string[] = [];
const root = (): string => {
  const dir = mkdtempSync(join(tmpdir(), 'outfitter-session-'));
  roots.push(dir);
  return dir;
};
const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

afterEach(() => {
  vi.unstubAllEnvs();
  for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const plan: CompositionPlan = {
  agent: 'agent',
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
};

describe('pi session directory resolution', () => {
  // pi encodes a project's absolute path into one folder name under its durable sessions root
  // (core/session-manager.js: getDefaultSessionDirPath), which Outfitter reuses so both share it.
  it("mirrors pi's per-project folder under the durable agent directory", () => {
    expect(resolvePiUserSessionDirectory('/home/u', '/home/u/repos/app')).toBe(
      join('/home/u', '.pi', 'agent', 'sessions', '--home-u-repos-app--'),
    );
  });

  it('defaults the session directory when the environment does not set one', () => {
    expect(resolvePiSessionDirectory({}, '/home/u', '/home/u/repos/app')).toBe(
      resolvePiUserSessionDirectory('/home/u', '/home/u/repos/app'),
    );
  });

  it('treats a blank inherited session directory as unset', () => {
    expect(resolvePiSessionDirectory({ [PI_SESSION_DIRECTORY_ENV]: '  ' }, '/home/u', '/home/u/repos/app')).toBe(
      resolvePiUserSessionDirectory('/home/u', '/home/u/repos/app'),
    );
  });

  it('yields no default when the environment already selects a session directory', () => {
    expect(
      resolvePiSessionDirectory(
        { [PI_SESSION_DIRECTORY_ENV]: '/workspace/.pi/agent/sessions' },
        '/home/u',
        '/home/u/repos/app',
      ),
    ).toBeUndefined();
  });
});

describe('projectComposition session directory', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.19).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('projects a resolved session directory for pi only', () => {
    const piDir = root();
    const claudeDir = root();
    const home = root();
    const sessionDirectory = join(home, 'sessions', '--project--');

    const pi = projectComposition(plan, {
      harness: 'pi',
      rootDirectory: piDir,
      homeDirectory: home,
      sessionDirectory,
    });
    const claude = projectComposition(plan, {
      harness: 'claude',
      rootDirectory: claudeDir,
      homeDirectory: home,
      sessionDirectory,
    });

    // The session store sits outside the projection root, which is deleted after the run.
    expect(pi.launch.env[PI_SESSION_DIRECTORY_ENV]).toBe(sessionDirectory);
    expect(pi.launch.env.PI_CODING_AGENT_DIR).toBe(piDir);
    expect(claude.launch.env[PI_SESSION_DIRECTORY_ENV]).toBeUndefined();
  });

  it('leaves the session directory unset when the run resolves none', () => {
    const projection = root();
    const home = root();

    const projected = projectComposition(plan, { harness: 'pi', rootDirectory: projection, homeDirectory: home });

    // Nothing is added to the launch env, so an inherited value reaches pi through the parent.
    expect(projected.launch.env[PI_SESSION_DIRECTORY_ENV]).toBeUndefined();
  });
});

describe('run agent session persistence', () => {
  it('keeps a session written during the run after the projection is removed', async () => {
    const base = root();
    const home = join(base, 'home');
    const project = join(base, 'project');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n\nBody.\n');
    vi.stubEnv(PI_SESSION_DIRECTORY_ENV, '');

    const projectionRoots: string[] = [];
    // A launcher that simulates pi recording a transcript into its session store.
    const launcher = (launch: AgentLaunchPlan): Promise<number> => {
      projectionRoots.push(launch.env.PI_CODING_AGENT_DIR ?? '');
      const sessionDirectory = launch.env[PI_SESSION_DIRECTORY_ENV] ?? '';
      mkdirSync(sessionDirectory, { recursive: true });
      writeFileSync(join(sessionDirectory, `${projectionRoots.length}.jsonl`), '{"role":"user"}\n');
      return Promise.resolve(0);
    };
    const run = async (passThroughArgs?: readonly string[]): Promise<void> => {
      await executeRunAgentCommand({
        homeDirectory: home,
        projectDirectory: project,
        agent: 'engineer',
        harness: 'pi',
        passThroughArgs,
        launcher,
      });
    };

    await run();
    await run(['--continue']);

    // The first run's projection is gone, but both transcripts remain in the durable store.
    expect(existsSync(projectionRoots[0])).toBe(false);
    expect(readdirSync(resolvePiUserSessionDirectory(home, project)).sort()).toEqual(['1.jsonl', '2.jsonl']);
  });

  it('leaves an inherited session directory in place for the pi launch', async () => {
    const base = root();
    const home = join(base, 'home');
    const project = join(base, 'project');
    write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n\nBody.\n');
    vi.stubEnv(PI_SESSION_DIRECTORY_ENV, join(base, 'workspace', 'sessions'));

    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'pi',
      launcher: () => Promise.resolve(0),
    });

    expect(result.launchPlan?.env[PI_SESSION_DIRECTORY_ENV]).toBeUndefined();
  });
});
