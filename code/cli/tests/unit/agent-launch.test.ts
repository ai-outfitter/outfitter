// Tests agent launch executable resolution and missing-CLI install guidance.
import { describe, expect, it } from 'vitest';

import type { AgentLaunchPlan } from '../../src/agents/AgentAdapter.js';
import { launchAgentProcess, resolveAgentLaunchExecutable } from '../../src/agents/AgentLaunch.js';

const createPiPlan = (): AgentLaunchPlan => ({
  command: 'pi',
  args: ['--model', 'pi-model', '--debug'],
  env: { PI_CODING_AGENT_DIR: '/tmp/composite' },
});

const createEnoentError = (message: string): Error => Object.assign(new Error(message), { code: 'ENOENT' });

describe('agent launch', () => {
  it('resolves a logical pi launch to the bundled pi binary run through the current node', () => {
    const piPlan = createPiPlan();

    const resolved = resolveAgentLaunchExecutable(piPlan);

    expect(resolved.command).toBe(process.execPath);
    expect(resolved.args[0]).toMatch(/[\\/]@earendil-works[\\/]pi-coding-agent[\\/].*cli\.js$/u);
    expect(resolved.args.slice(1)).toEqual(piPlan.args);
    expect(resolved.env).toEqual(piPlan.env);
  });

  it('leaves non-pi launch plans untouched so they resolve from PATH', () => {
    const claudePlan: AgentLaunchPlan = { command: 'claude', args: ['--foo'], env: {} };

    expect(resolveAgentLaunchExecutable(claudePlan)).toBe(claudePlan);
  });

  it('returns the launcher exit code on a successful launch', async () => {
    const exitCode = await launchAgentProcess({ launch: () => Promise.resolve(3) }, createPiPlan(), 'pi');

    expect(exitCode).toBe(3);
  });

  it('translates a missing pi CLI into actionable install guidance', async () => {
    const enoentError = createEnoentError('spawn pi ENOENT');

    const thrownError = await launchAgentProcess(
      { launch: () => Promise.reject(enoentError) },
      createPiPlan(),
      'pi',
    ).catch((error: unknown) => error);

    expect(thrownError).toBeInstanceOf(Error);
    const message = (thrownError as Error).message;
    expect(message).toContain("Could not launch the 'pi' agent CLI");
    expect(message).toContain('is not installed or not on your PATH');
    expect(message).toContain('npm install -g @earendil-works/pi-coding-agent');
    expect((thrownError as Error).cause).toBe(enoentError);
  });

  it('translates a missing claude CLI into actionable install guidance', async () => {
    const claudePlan: AgentLaunchPlan = { command: 'claude', args: [], env: {} };

    const thrownError = await launchAgentProcess(
      { launch: () => Promise.reject(createEnoentError('spawn claude ENOENT')) },
      claudePlan,
      'claude',
    ).catch((error: unknown) => error);

    expect((thrownError as Error).message).toContain("Could not launch the 'claude' agent CLI");
    expect((thrownError as Error).message).toContain('https://claude.com/claude-code');
  });

  it('falls back to a base message for an agent without a known install hint', async () => {
    const customPlan: AgentLaunchPlan = { command: 'node-agent', args: [], env: {} };

    const thrownError = await launchAgentProcess(
      { launch: () => Promise.reject(createEnoentError('spawn node-agent ENOENT')) },
      customPlan,
      'node-agent',
    ).catch((error: unknown) => error);

    expect((thrownError as Error).message).toBe(
      "Could not launch the 'node-agent' agent CLI: 'node-agent' is not installed or not on your PATH.",
    );
  });

  it('rethrows non-ENOENT launch failures unchanged', async () => {
    const launchFailure = new Error('boom');

    await expect(
      launchAgentProcess({ launch: () => Promise.reject(launchFailure) }, createPiPlan(), 'pi'),
    ).rejects.toBe(launchFailure);
  });
});
