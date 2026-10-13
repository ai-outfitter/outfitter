import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWorkspaceCommand } from '../../src/cli/commands/WorkspaceCommand.js';
import type { WorkspaceClient } from '../../src/hosted/WorkspaceClient.js';
import type { BridgeOptions } from '../../src/hosted/WorkspaceBridge.js';

const id = '11111111-1111-4111-8111-111111111111';
const installation = '22222222-2222-4222-8222-222222222222';
const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
const argumentsFor = (command: string) => ['workspaces', command, id, '--installation', installation];
function client(states = ['Running']) {
  let current = states[0];
  return {
    workspace: (workspace: string, action = '') => `${workspace}/${action}`,
    request: vi.fn((path: string) => {
      if (path === `${id}/`) current = states.shift() ?? current;
      return Promise.resolve({ state: current });
    }),
  } as unknown as WorkspaceClient;
}

describe('managed terminal commands', () => {
  it('connects with a private task capability and emits machine-readable readiness', async () => {
    const root = mkdtempSync(join(tmpdir(), 'workspace-cli-'));
    roots.push(root);
    const file = join(root, 'capability.json');
    writeFileSync(file, JSON.stringify({ task: 'ptc1.own.self.mac' }));
    const print = vi.fn(),
      output = vi.spyOn(process.stdout, 'write').mockReturnValue(true);
    vi.spyOn(process.stdin, 'resume').mockReturnValue(process.stdin);
    vi.spyOn(process.stdin, 'pause').mockReturnValue(process.stdin);
    const connect = vi.fn((_client: WorkspaceClient, options: BridgeOptions) => {
      expect(options.capability).toBe('ptc1.own.self.mac');
      expect(options.serviceURL).toBe('http://127.0.0.1:8000');
      options.ready?.();
      options.output?.(Buffer.from('terminal'));
      process.stdin.emit('end');
      expect(options.signal.aborted).toBe(true);
      return Promise.resolve();
    });
    const program = new Command();
    createWorkspaceCommand({ client: () => client(), print, connect }).register(program);
    await program.parseAsync(
      [...argumentsFor('connect'), '--service-url', 'http://127.0.0.1:8000', '--task-token-file', file],
      { from: 'user' },
    );
    expect(print).toHaveBeenCalledWith({ connected: true });
    expect(output).toHaveBeenCalledWith(Buffer.from('terminal'));
    expect(process.listenerCount('SIGTERM')).toBe(0);
  });
  it('wakes a sleeping session before attaching and sends resume once', async () => {
    vi.useFakeTimers();
    const service = client(['Sleeping', 'Starting', 'Running']);
    const calls = vi.spyOn(service, 'request');
    const connect = vi.fn(() => Promise.resolve());
    const program = new Command();
    createWorkspaceCommand({ client: () => service, connect }).register(program);
    const task = program.parseAsync(argumentsFor('attach'), { from: 'user' });
    await vi.advanceTimersByTimeAsync(1000);
    await task;
    expect(calls).toHaveBeenCalledWith(`${id}/wake`, 'POST', {});
    expect(calls).toHaveBeenCalledWith(`${id}/session`, 'POST', { operation: 'resume' });
    expect(connect).toHaveBeenCalledOnce();
  });
  it.each(['Interrupted', 'Expired'])('refuses %s work without attaching or replaying it', async (state) => {
    const connect = vi.fn(() => Promise.resolve());
    const program = new Command();
    createWorkspaceCommand({ client: () => client([state]), connect }).register(program);
    await expect(program.parseAsync(argumentsFor('attach'), { from: 'user' })).rejects.toThrow('explicit recovery');
    expect(connect).not.toHaveBeenCalled();
  });
  it('bounds a workspace that never wakes', async () => {
    const service = client(['Starting']);
    vi.spyOn(Date, 'now').mockReturnValueOnce(0).mockReturnValue(120001);
    const program = new Command();
    createWorkspaceCommand({ client: () => service }).register(program);
    await expect(program.parseAsync(argumentsFor('attach'), { from: 'user' })).rejects.toThrow('did not wake');
  });
  it('restores raw terminal state when transport fails', async () => {
    const tty = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
    const mode = Object.getOwnPropertyDescriptor(process.stdin, 'setRawMode');
    const setRawMode = vi.fn();
    Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: true });
    Object.defineProperty(process.stdin, 'setRawMode', { configurable: true, value: setRawMode });
    const program = new Command();
    createWorkspaceCommand({
      client: () => client(),
      connect: () => Promise.reject(new Error('transport failed')),
    }).register(program);
    try {
      await expect(program.parseAsync(argumentsFor('attach'), { from: 'user' })).rejects.toThrow('transport failed');
      expect(setRawMode.mock.calls).toEqual([[true], [false]]);
    } finally {
      if (tty) Object.defineProperty(process.stdin, 'isTTY', tty);
      else Reflect.deleteProperty(process.stdin, 'isTTY');
      if (mode) Object.defineProperty(process.stdin, 'setRawMode', mode);
      else Reflect.deleteProperty(process.stdin, 'setRawMode');
    }
  });
});
