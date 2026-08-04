// Tests the launch boundary: bundled-pi resolution, process launch, missing-CLI guidance, and
// termination forwarding.
import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  attachSignalForwarding,
  launchAgentProcess,
  resolveAgentLaunchExecutable,
} from '../../src/agents/AgentLaunch.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';

const plan = (command: string): AgentLaunchPlan => ({ command, args: ['--system-prompt', '/x'], env: { A: '1' } });

const fakeChild = () => ({
  signals: [] as string[],
  killed: false,
  kill(signal?: NodeJS.Signals) {
    this.signals.push(signal ?? 'SIGTERM');
    return true;
  },
});

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

// A resident agent that cannot be told to stop is SIGKILLed by its orchestrator when the grace
// period expires, losing credential persistence and projection cleanup. Node forwards nothing by
// default, so this is the only thing standing between the harness and that outcome — in containers
// and equally at a terminal or in a cancelled CI job.
describe('termination forwarding', () => {
  it.each(['SIGTERM', 'SIGINT', 'SIGHUP'] as const)('forwards %s to the harness', (signal) => {
    const child = fakeChild();
    const emitter = new EventEmitter();
    const detach = attachSignalForwarding(child, emitter);

    emitter.emit(signal);

    expect(child.signals).toEqual([signal]);
    detach();
  });

  it('escalates to SIGKILL when the harness ignores the signal', () => {
    vi.useFakeTimers();
    try {
      const child = fakeChild();
      const emitter = new EventEmitter();
      const detach = attachSignalForwarding(child, emitter, 50);

      emitter.emit('SIGTERM');
      expect(child.signals).toEqual(['SIGTERM']);

      vi.advanceTimersByTime(50);
      expect(child.signals).toEqual(['SIGTERM', 'SIGKILL']);
      detach();
    } finally {
      vi.useRealTimers();
    }
  });

  it('does not signal a harness that already exited', () => {
    const child = { ...fakeChild(), killed: true };
    const emitter = new EventEmitter();
    const detach = attachSignalForwarding(child, emitter);

    emitter.emit('SIGTERM');

    expect(child.signals).toEqual([]);
    detach();
  });

  // Installing a handler suppresses Node's default termination, so a leaked listener would keep a
  // later run alive and silently accumulate across launches in one process.
  it('removes its listeners on detach', () => {
    const child = fakeChild();
    const emitter = new EventEmitter();

    const detach = attachSignalForwarding(child, emitter);
    expect(emitter.listenerCount('SIGTERM')).toBe(1);

    detach();
    expect(emitter.listenerCount('SIGTERM')).toBe(0);
    expect(emitter.listenerCount('SIGINT')).toBe(0);
    expect(emitter.listenerCount('SIGHUP')).toBe(0);

    emitter.emit('SIGTERM');
    expect(child.signals).toEqual([]);
  });
});
