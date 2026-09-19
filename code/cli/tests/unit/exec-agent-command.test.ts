// Tests the exec command: subcommand-first argv, the omitted session-flag contract, env projection,
// composition parity with run, strict/strict-fatal semantics, harness selection, lifecycle, and the
// real-spawn boundary with a fixture binary.
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Command } from 'commander';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { launchThroughSpawn, spawnLauncher } from '../../src/agents/AgentLaunch.js';
import { createExecAgentCommand, executeExecAgentCommand } from '../../src/cli/commands/ExecAgentCommand.js';
import { executeRunAgentCommand } from '../../src/cli/commands/RunAgentCommand.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';

const temporaryRoots: string[] = [];
let previousSystemDir: string | undefined;
let previousSessionDir: string | undefined;
let previousExitCode: string | number | null | undefined;

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-exec-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

interface Capture {
  readonly plan: AgentLaunchPlan;
}

let captured: Capture[] = [];

const launcher = (plan: AgentLaunchPlan): Promise<number> => {
  captured.push({ plan });
  return Promise.resolve(0);
};

// The loadout-rich agent makes the omission contract observable: a run launch projects skills,
// model, thinking, extension, and tool flags, and exec must drop every one of them. The local
// extension keeps the fixture offline-deterministic (no cache install).
const tree = (): { home: string; project: string } => {
  const root = createTemporaryRoot();
  const home = join(root, 'home');
  const project = join(root, 'project');
  write(join(project, '.agents', 'system-prompt.md'), 'BASE PROMPT');
  write(join(project, '.agents', 'skills', 'wiki', 'SKILL.md'), '---\nname: wiki\n---\n\nWiki skill body.\n');
  write(join(project, '.agents', 'exts', 'present', 'index.ts'), 'export default () => {};');
  write(
    join(project, '.agents', 'agents', 'engineer', 'agent.md'),
    '---\nname: engineer\nskills: [wiki]\nmodel: gpt-5.2\nthinking: high\ntools:\n  allow: [read]\nextensions: ["./exts/present"]\n---\n\n# Engineer\n',
  );
  return { home, project };
};

const execWith = async (extra: Record<string, unknown> = {}) => {
  const { home, project } = tree();
  return executeExecAgentCommand({
    homeDirectory: home,
    projectDirectory: project,
    agent: 'engineer',
    subcommand: 'list',
    subcommandArgs: [],
    launcher,
    ...extra,
  });
};

beforeEach(() => {
  captured = [];
  previousSystemDir = process.env.OUTFITTER_SYSTEM_DIR;
  previousSessionDir = process.env.PI_CODING_AGENT_SESSION_DIR;
  previousExitCode = process.exitCode;
  delete process.env.OUTFITTER_SYSTEM_DIR;
  // A resident agent's inherited session store would disable the session-dir projection; the
  // resolution under test assumes an unconfigured environment.
  delete process.env.PI_CODING_AGENT_SESSION_DIR;
});

afterEach(() => {
  process.exitCode = previousExitCode;
  if (previousSystemDir === undefined) delete process.env.OUTFITTER_SYSTEM_DIR;
  else process.env.OUTFITTER_SYSTEM_DIR = previousSystemDir;
  if (previousSessionDir === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
  else process.env.PI_CODING_AGENT_SESSION_DIR = previousSessionDir;
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe('exec agent command', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.8.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('places the subcommand at argv[0] and omits every session-only launch flag', async () => {
    await execWith();

    expect(captured[0].plan.command).toBe('pi');
    expect(captured[0].plan.args).toEqual(['list']);
    expect(captured[0].plan.args.join(' ')).not.toMatch(
      /--system-prompt|--skill|--extension|--model|--thinking|--tools/,
    );
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.8.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('passes subcommand arguments through verbatim and uninterpreted', async () => {
    await execWith({ subcommand: 'install', subcommandArgs: ['-l', 'npm:some-package'] });

    expect(captured[0].plan.args).toEqual(['install', '-l', 'npm:some-package']);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.8.2).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('projects the composed environment for the subcommand', async () => {
    await execWith();

    const env = captured[0].plan.env;
    expect(env.PI_CODING_AGENT_DIR).toMatch(/outfitter-engineer-pi/);
    // The durable session store follows run's semantics: never inside the ephemeral projection.
    expect(env.PI_CODING_AGENT_SESSION_DIR).toBeDefined();
    expect(env.PI_CODING_AGENT_SESSION_DIR).not.toBe(env.PI_CODING_AGENT_DIR);
    expect(env.PI_MCP_CONFIG_MODE).toBe('exclusive');
  });

  it('resolves and composes through the same pipeline run uses', async () => {
    const { home, project } = tree();
    const exec = await executeExecAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      subcommand: 'list',
      subcommandArgs: [],
      launcher,
    });
    const run = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'pi',
      launcher,
    });

    expect(exec.exitCode).toBe(0);
    expect(run.exitCode).toBe(0);
    // One-resolver invariant: the same effective resolution surfaces as the same projected
    // environment contract; only the argv differs (session flags vs the subcommand).
    expect(Object.keys(captured[1].plan.env).sort()).toEqual(Object.keys(captured[0].plan.env).sort());
  });

  it('never runs first-run onboarding, even with nothing configured', async () => {
    const root = createTemporaryRoot();
    const result = await executeExecAgentCommand({
      homeDirectory: join(root, 'home'),
      projectDirectory: join(root, 'project'),
      agent: 'engineer',
      subcommand: 'list',
      subcommandArgs: [],
      launcher,
    });

    expect(result.exitCode).toBe(1);
    expect(result.messages.join('\n')).not.toMatch(/setup|walkthrough|featured profile/i);
    expect(captured).toEqual([]);
  });

  it('makes warnings fatal under --strict before any launch', async () => {
    const result = await execWith({ harness: 'codex', strict: true });

    expect(result.exitCode).toBe(1);
    expect(result.messages.join(' ')).toContain("harness 'codex' cannot project loadout element 'skills'");
    expect(captured).toEqual([]);
  });

  it('selects the harness through --harness with the same subcommand contract', async () => {
    await execWith({ harness: 'codex' });

    expect(captured[0].plan.command).toBe('codex');
    expect(captured[0].plan.args).toEqual(['list']);
  });

  it('keeps the projection and reports its path under --retain-projection', async () => {
    const result = await execWith({ retainProjection: true });

    const rootDirectory = captured[0].plan.env.PI_CODING_AGENT_DIR;
    expect(result.messages.join('\n')).toContain(`Retaining the runtime projection at ${rootDirectory}`);
    expect(existsSync(rootDirectory)).toBe(true);
    rmSync(rootDirectory, { recursive: true, force: true });
  });

  it('deletes the projection after the subcommand exits by default', async () => {
    await execWith();

    expect(existsSync(captured[0].plan.env.PI_CODING_AGENT_DIR)).toBe(false);
  });

  it('passes the child exit code through as the exec exit code', async () => {
    const { home, project } = tree();
    const result = await executeExecAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      subcommand: 'list',
      subcommandArgs: [],
      launcher: () => Promise.resolve(3),
    });

    expect(result.exitCode).toBe(3);
  });

  it('registers the exec command with a subcommand-first description', () => {
    const program = new Command();
    createExecAgentCommand().register(program);
    const command = program.commands.find((candidate) => candidate.name() === 'exec');

    expect(command).toBeDefined();
    expect(command!.description()).toMatch(/subcommand/i);
  });
});

describe('exec through the commander surface', () => {
  const parse = async (argv: readonly string[]): Promise<AgentLaunchPlan | undefined> => {
    const { home, project } = tree();
    let launchPlan: AgentLaunchPlan | undefined;
    const program = new Command();
    createExecAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      launcher: (plan) => {
        launchPlan = plan;
        return Promise.resolve(0);
      },
      writeLine: () => undefined,
    }).register(program);
    await program.parseAsync(['node', 'outfitter', ...argv]);
    return launchPlan;
  };

  it('accepts harness per-subcommand flags as pass-through arguments', async () => {
    const plan = await parse(['exec', 'engineer', 'install', '-l', 'npm:some-package']);

    expect(plan!.args).toEqual(['install', '-l', 'npm:some-package']);
  });

  it('fails with a usage error when the subcommand is missing', async () => {
    const { home, project } = tree();
    const program = new Command();
    program.exitOverride();
    createExecAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      launcher,
      writeLine: () => undefined,
    }).register(program);

    await expect(program.parseAsync(['node', 'outfitter', 'exec', 'engineer'])).rejects.toThrow(
      /missing required argument 'subcommand'/i,
    );
    expect(captured).toEqual([]);
  });

  it('honors --harness on the commander surface', async () => {
    const plan = await parse(['exec', 'engineer', 'list', '--harness', 'codex']);

    expect(plan!.command).toBe('codex');
    expect(plan!.args).toEqual(['list']);
  });
});

describe('exec system extension hook boundary', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.8.3).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('applies hook environment and source stamp but does not deliver hook extension args', async () => {
    const systemDir = join(createTemporaryRoot(), 'system.d');
    const hookExtension = join(createTemporaryRoot(), 'extensions', 'observer.js');
    write(hookExtension, 'export default () => {};');
    write(
      join(systemDir, '10-observer.yml'),
      `name: observer\nharnesses:\n  pi:\n    extensions:\n      - ${hookExtension}\n    env:\n      HOOK_OBSERVE: "1"\n`,
    );
    process.env.OUTFITTER_SYSTEM_DIR = systemDir;

    const result = await execWith();

    expect(captured[0].plan.env.HOOK_OBSERVE).toBe('1');
    expect(captured[0].plan.env.OUTFITTER_SYSTEM_HOOK_SOURCE).toBe(`env-override:${systemDir}`);
    expect(captured[0].plan.args).toEqual(['list']);
    expect(result.messages.join('\n')).toMatch(/'observer'.*not delivered/s);
  });
});

// End-to-end through the real spawn boundary: a fixture script stands in for the user's pi and
// records its argv and the one env variable the exec contract is about. The projection root is
// asserted by shape, never dumped, and the fixture exits non-zero to prove exit-code passthrough.
describe('exec end-to-end through the real spawn boundary', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.8.2, OFTR-005.8.4).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('executes the fixture with the subcommand as its first argument and passes the exit code through', async () => {
    const { home, project } = tree();
    const record = join(createTemporaryRoot(), 'argv.txt');
    const agentDirRecord = join(createTemporaryRoot(), 'agent-dir.txt');
    const fixtureBinary = join(createTemporaryRoot(), 'fake-pi');
    write(
      fixtureBinary,
      `#!/usr/bin/env sh
printf '%s\\n' "$@" > ${record}
printf '%s' "$PI_CODING_AGENT_DIR" > ${agentDirRecord}
exit 3
`,
    );
    chmodSync(fixtureBinary, 0o755);
    write(join(project, '.agents', 'settings.yml'), `pi_binary: path\npi_binary_path: '${fixtureBinary}'\n`);

    const result = await executeExecAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      subcommand: 'list',
      subcommandArgs: [],
      launcher: (plan, piBinary) => launchThroughSpawn(spawnLauncher, plan, piBinary),
    });

    expect(result.exitCode).toBe(3);
    expect(readFileSync(record, 'utf8').split('\n').filter(Boolean)).toEqual(['list']);
    // The fixture saw the composed projection root as its agent directory — shape only, never dumped.
    expect(readFileSync(agentDirRecord, 'utf8')).toMatch(/outfitter-engineer-pi/);
  });
});
