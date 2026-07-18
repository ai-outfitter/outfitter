// Tests the launch boundary: bundled-pi resolution, process launch, and missing-CLI guidance.
import { describe, expect, it } from 'vitest';

import { launchAgentProcess, resolveAgentLaunchExecutable } from '../../src/agents/AgentLaunch.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';

const plan = (command: string): AgentLaunchPlan => ({ command, args: ['--system-prompt', '/x'], env: { A: '1' } });

describe('agent launch', () => {
  it('passes non-pi launch plans through unchanged', () => {
    const claudePlan = plan('claude');
    expect(resolveAgentLaunchExecutable(claudePlan)).toBe(claudePlan);
  });

  it('resolves pi to the bundled binary through the current Node runtime', () => {
    const resolved = resolveAgentLaunchExecutable(plan('pi'));
    expect(resolved.command).toBe(process.execPath);
    expect(resolved.args[0]).toContain('pi'); // bundled pi bin path prefixed before plan args
    expect(resolved.args).toEqual(expect.arrayContaining(['--system-prompt', '/x']));
    expect(resolved.env.PI_SKIP_VERSION_CHECK).toBe('1');
  });

  it('returns the exit code from a successful launcher', async () => {
    const exitCode = await launchAgentProcess({ launch: () => Promise.resolve(3) }, plan('pi'), 'pi');
    expect(exitCode).toBe(3);
  });

  it('translates ENOENT into actionable install guidance', async () => {
    const enoent = Object.assign(new Error('spawn pi ENOENT'), { code: 'ENOENT' });
    const failing = { launch: async () => Promise.reject(enoent) };
    await expect(launchAgentProcess(failing, plan('pi'), 'pi')).rejects.toThrow(/not installed or not on your PATH/);
    await expect(launchAgentProcess(failing, plan('unknown'), 'unknown')).rejects.toThrow(/is not installed/);
  });

  it('rethrows non-ENOENT launcher errors unchanged', async () => {
    const other = new Error('boom');
    await expect(launchAgentProcess({ launch: async () => Promise.reject(other) }, plan('pi'), 'pi')).rejects.toThrow(
      'boom',
    );
  });
});
