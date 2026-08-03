// Tests the launch boundary: bundled-pi resolution, process launch, and missing-CLI guidance.
import { EventEmitter } from 'node:events';

import { describe, expect, it, vi } from 'vitest';

import {
  createAgentSpawnOptions,
  launchAgentProcess,
  resolveAgentLaunchExecutable,
  signalExitCode,
  waitForSpawnedAgentProcess,
} from '../../src/agents/AgentLaunch.js';
import type { SpawnedAgentProcess, TerminationSignalSource } from '../../src/agents/AgentLaunch.js';
import type { AgentLaunchPlan } from '../../src/projection/Projection.js';

const plan = (command: string): AgentLaunchPlan => ({ command, args: ['--system-prompt', '/x'], env: { A: '1' } });

describe('agent launch', () => {
  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('inherits standard I/O and launches a dedicated process group where supported', () => {
    const options = createAgentSpawnOptions(plan('pi'));
    expect(options.stdio).toBe('inherit');
    expect(options.env.A).toBe('1');
    expect(options.detached).toBe(process.platform !== 'win32');
  });

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
    const exitCode = await launchAgentProcess(
      { launch: () => Promise.resolve({ status: 'exited', exitCode: 3 }) },
      plan('pi'),
      'pi',
    );
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

  // THIS TEST VALIDATES A HARD REQUIREMENT (OFTR-005.8).
  // YOU MUST NOT MODIFY THIS TEST UNLESS THE REQUIREMENT CHANGES.
  it('forwards the first termination signal once and removes listeners after child exit', async () => {
    const signalSource = new EventEmitter();
    const child = new EventEmitter() as EventEmitter & { pid: number; kill: ReturnType<typeof vi.fn> };
    child.pid = 123;
    child.kill = vi.fn(() => true);
    const forwardSignal = vi.fn();

    const resultPromise = waitForSpawnedAgentProcess(child as unknown as SpawnedAgentProcess, {
      signalSource: signalSource as unknown as TerminationSignalSource,
      forwardSignal,
    });

    expect(signalSource.listenerCount('SIGINT')).toBe(1);
    expect(signalSource.listenerCount('SIGTERM')).toBe(1);
    signalSource.emit('SIGTERM', 'SIGTERM');
    signalSource.emit('SIGTERM', 'SIGTERM');
    signalSource.emit('SIGINT', 'SIGINT');
    expect(forwardSignal).toHaveBeenCalledTimes(1);
    expect(forwardSignal).toHaveBeenCalledWith(child, 'SIGTERM');

    child.emit('close', null, null);
    await expect(resultPromise).resolves.toEqual({ status: 'signaled', signal: 'SIGTERM', exitCode: 143 });
    expect(signalSource.listenerCount('SIGINT')).toBe(0);
    expect(signalSource.listenerCount('SIGTERM')).toBe(0);
  });

  it('distinguishes normal, child-signalled, and spawn-error outcomes across sequential launches', async () => {
    const signalSource = new EventEmitter() as unknown as TerminationSignalSource;
    const first = new EventEmitter() as unknown as SpawnedAgentProcess;
    const firstResult = waitForSpawnedAgentProcess(first, { signalSource, forwardSignal: vi.fn() });
    (first as unknown as EventEmitter).emit('close', 7, null);
    await expect(firstResult).resolves.toEqual({ status: 'exited', exitCode: 7 });

    const second = new EventEmitter() as unknown as SpawnedAgentProcess;
    const secondResult = waitForSpawnedAgentProcess(second, { signalSource, forwardSignal: vi.fn() });
    (second as unknown as EventEmitter).emit('close', null, 'SIGINT');
    await expect(secondResult).resolves.toEqual({ status: 'signaled', signal: 'SIGINT', exitCode: 130 });

    const third = new EventEmitter() as unknown as SpawnedAgentProcess;
    const thirdResult = waitForSpawnedAgentProcess(third, { signalSource, forwardSignal: vi.fn() });
    (third as unknown as EventEmitter).emit('error', new Error('spawn failed'));
    await expect(thirdResult).rejects.toThrow('spawn failed');

    expect(signalExitCode('SIGINT')).toBe(130);
    expect(signalExitCode('SIGTERM')).toBe(143);
    expect((signalSource as unknown as EventEmitter).eventNames()).toEqual([]);
  });

  it('uses process defaults, maps a null close to zero, and ignores late duplicate terminal events', async () => {
    const closed = new EventEmitter() as unknown as SpawnedAgentProcess;
    const closedResult = waitForSpawnedAgentProcess(closed);
    (closed as unknown as EventEmitter).emit('close', null, null);
    (closed as unknown as EventEmitter).emit('error', new Error('late error'));
    await expect(closedResult).resolves.toEqual({ status: 'exited', exitCode: 0 });

    const failed = new EventEmitter() as unknown as SpawnedAgentProcess;
    const failedResult = waitForSpawnedAgentProcess(failed);
    (failed as unknown as EventEmitter).emit('error', new Error('first error'));
    (failed as unknown as EventEmitter).emit('close', 0, null);
    await expect(failedResult).rejects.toThrow('first error');
  });

  it('forwards a parent SIGINT as a conventional signalled outcome', async () => {
    const signalSource = new EventEmitter();
    const child = new EventEmitter() as unknown as SpawnedAgentProcess;
    const forwardSignal = vi.fn();
    const result = waitForSpawnedAgentProcess(child, {
      signalSource: signalSource as unknown as TerminationSignalSource,
      forwardSignal,
    });

    signalSource.emit('SIGINT', 'SIGINT');
    (child as unknown as EventEmitter).emit('close', 0, null);

    await expect(result).resolves.toEqual({ status: 'signaled', signal: 'SIGINT', exitCode: 130 });
    expect(forwardSignal).toHaveBeenCalledWith(child, 'SIGINT');
  });
});
