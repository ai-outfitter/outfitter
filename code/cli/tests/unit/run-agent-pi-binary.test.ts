// Tests the run command's pi binary selection threading: settings resolution, strict-fatal
// warnings, pre-launch failure on missing explicit binaries, and the unchanged cache boundary.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { spawnLauncher } from '../../src/agents/AgentLaunch.js';
import { executeRunAgentCommand, launchThroughSpawn } from '../../src/cli/commands/RunAgentCommand.js';
import type { PiBinarySelection } from '../../src/agents/PiBinarySelection.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';

const temporaryRoots: string[] = [];
let previousEnvValue: string | undefined;

const createTemporaryRoot = (): string => {
  const root = mkdtempSync(join(tmpdir(), 'outfitter-pi-binary-'));
  temporaryRoots.push(root);
  return root;
};

const write = (path: string, content: string): void => {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
};

interface Capture {
  readonly plan: AgentLaunchPlan;
  readonly piBinary?: PiBinarySelection;
}

let captured: Capture[] = [];

const launcher = (plan: AgentLaunchPlan, piBinary?: PiBinarySelection): Promise<number> => {
  captured.push({ plan, piBinary });
  return Promise.resolve(0);
};

const tree = (): { home: string; project: string } => {
  const root = createTemporaryRoot();
  const home = join(root, 'home');
  const project = join(root, 'project');
  write(join(project, '.agents', 'agents', 'engineer', 'agent.md'), '---\nname: engineer\n---\n\n# Engineer\n');
  return { home, project };
};

beforeEach(() => {
  captured = [];
  previousEnvValue = process.env.OUTFITTER_PI_BIN;
  delete process.env.OUTFITTER_PI_BIN;
});

afterEach(() => {
  if (previousEnvValue === undefined) delete process.env.OUTFITTER_PI_BIN;
  else process.env.OUTFITTER_PI_BIN = previousEnvValue;
  for (const root of temporaryRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const runWithSettings = async (settingsYaml: string, extra: Record<string, unknown> = {}) => {
  const { home, project } = tree();
  if (settingsYaml !== '') write(join(project, '.agents', 'settings.yml'), settingsYaml);
  return executeRunAgentCommand({
    homeDirectory: home,
    projectDirectory: project,
    agent: 'engineer',
    harness: 'pi',
    launcher,
    ...extra,
  });
};

describe('run agent pi binary selection', () => {
  it('passes the resolved selection to the launcher and keeps the plan logical', async () => {
    const result = await runWithSettings(`pi_binary: path\npi_binary_path: '${process.execPath}'\n`);

    expect(result.exitCode).toBe(0);
    expect(captured[0].plan.command).toBe('pi'); // the reported launch plan stays logical
    expect(captured[0].piBinary).toEqual({ mode: 'path', binaryPath: process.execPath });
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.30).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('lets OUTFITTER_PI_BIN override the settings selection', async () => {
    process.env.OUTFITTER_PI_BIN = process.execPath;
    await runWithSettings(`pi_binary: path\npi_binary_path: '${process.execPath}'\n`);

    expect(captured[0].piBinary).toEqual({ mode: 'path', binaryPath: process.execPath });
  });

  it('treats pi_binary_path without pi_binary as path mode', async () => {
    await runWithSettings(`pi_binary_path: '${process.execPath}'\n`);

    expect(captured[0].piBinary).toEqual({ mode: 'path', binaryPath: process.execPath });
  });

  it('keeps bundled as the resolved selection with no configuration', async () => {
    await runWithSettings('');

    expect(captured[0].piBinary).toEqual({ mode: 'bundled' });
  });

  it('warns that pi_binary_path is ignored in bundled mode and surfaces it strictly', async () => {
    const lenient = await runWithSettings(`pi_binary: bundled\npi_binary_path: '${process.execPath}'\n`);
    expect(lenient.exitCode).toBe(0);
    expect(lenient.messages.join('\n')).toMatch(/ignored/);

    const strict = await runWithSettings(`pi_binary: bundled\npi_binary_path: '${process.execPath}'\n`, {
      strict: true,
    });
    expect(strict.exitCode).toBe(1);
    expect(strict.messages.join('\n')).toMatch(/ignored/);
  });

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-006.3.31).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('fails before launch when the configured explicit binary does not exist', async () => {
    await expect(runWithSettings('pi_binary: path\npi_binary_path: /no/such/pi\n')).rejects.toThrow(/\/no\/such\/pi/);
    expect(captured).toEqual([]);
  });

  it('reports the auto PATH fallback as a strict-fatal warning', async () => {
    const { home, project } = tree();
    write(join(project, '.agents', 'settings.yml'), 'pi_binary: auto\n');
    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'pi',
      bundledPiResolvable: () => false,
      launcher,
    });

    expect(result.exitCode).toBe(0);
    expect(result.messages.join('\n')).toMatch(/falling back/i);
    expect(captured[0].piBinary).toEqual({ mode: 'path' });

    const strict = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'pi',
      bundledPiResolvable: () => false,
      strict: true,
      launcher,
    });
    expect(strict.exitCode).toBe(1);
  });

  it('never resolves the selection for non-pi harness launches', async () => {
    const { home, project } = tree();
    write(join(project, '.agents', 'settings.yml'), 'pi_binary: path\npi_binary_path: /no/such/pi\n');
    // A missing configured binary must not fail a claude run: the control is pi-scoped.
    const result = await executeRunAgentCommand({
      homeDirectory: home,
      projectDirectory: project,
      agent: 'engineer',
      harness: 'claude',
      launcher,
    });

    expect(result.exitCode).toBe(0);
    expect(captured[0].piBinary).toBeUndefined();
  });

  // End-to-end through the real spawn boundary: a fixture script stands in for the user's pi, so
  // the test proves the launched process IS the selected binary and inspects the one environment
  // variable whose injection policy differs by mode. The variable is pinned to a sentinel value in
  // the test process, so a recorded '0' proves Outfitter injected nothing and let the inherited
  // value pass through.
  describe('end-to-end through the real spawn boundary', () => {
    it('executes the selected binary without the injected version-check suppression', async () => {
      const { home, project } = tree();
      const record = join(createTemporaryRoot(), 'argv.txt');
      const envRecord = join(createTemporaryRoot(), 'version-check.txt');
      const fixtureBinary = join(createTemporaryRoot(), 'fake-pi');
      write(
        fixtureBinary,
        `#!/usr/bin/env sh
printf '%s\n' "$@" > ${record}
printf '%s' "\${PI_SKIP_VERSION_CHECK-UNSET}" > ${envRecord}
exit 0
`,
      );
      chmodSync(fixtureBinary, 0o755);
      write(join(project, '.agents', 'settings.yml'), `pi_binary: path\npi_binary_path: '${fixtureBinary}'\n`);

      const previousVersionCheck = process.env.PI_SKIP_VERSION_CHECK;
      process.env.PI_SKIP_VERSION_CHECK = '0';
      try {
        const result = await executeRunAgentCommand({
          homeDirectory: home,
          projectDirectory: project,
          agent: 'engineer',
          harness: 'pi',
          launcher: (plan, piBinary) => launchThroughSpawn(spawnLauncher, plan, piBinary),
        });

        expect(result.exitCode).toBe(0);
        expect(readFileSync(record, 'utf8')).toContain('--system-prompt');
        expect(readFileSync(envRecord, 'utf8')).toBe('0');
      } finally {
        if (previousVersionCheck === undefined) delete process.env.PI_SKIP_VERSION_CHECK;
        else process.env.PI_SKIP_VERSION_CHECK = previousVersionCheck;
      }
    });
  });
});
