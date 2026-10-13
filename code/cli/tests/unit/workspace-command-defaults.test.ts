import { afterEach, describe, expect, it, vi } from 'vitest';
import { Command } from 'commander';
import { createWorkspaceCommand } from '../../src/cli/commands/WorkspaceCommand.js';
import type { BridgeOptions } from '../../src/hosted/WorkspaceBridge.js';

vi.mock('../../src/hosted/HostedSession.js', () => ({
  createHostedSession: () => ({
    client: { origin: 'https://outfitter.example' },
    access: () => Promise.resolve('scoped-access'),
  }),
}));
vi.mock('node:fs', async (original) => {
  const fs = await original<typeof import('node:fs')>();
  return {
    ...fs,
    readFileSync: (input: Parameters<typeof fs.readFileSync>[0], encoding: BufferEncoding) =>
      input === 0 ? '{"operation":"bind"}' : fs.readFileSync(input, encoding),
  };
});
vi.mock('../../src/hosted/WorkspaceBridge.js', () => ({
  connectWorkspace: (_client: unknown, options: BridgeOptions) => {
    options.ready?.();
    process.stdin.emit('end');
    return Promise.resolve();
  },
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('published workspace command defaults', () => {
  it('uses the native hosted session, parses stdin and prints structured JSON', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const fetcher = vi.fn<typeof fetch>(() => Promise.resolve(Response.json({ bound: true })));
    vi.stubGlobal('fetch', fetcher);
    const program = new Command();
    createWorkspaceCommand().register(program);
    await program.parseAsync(['workspaces', 'session', '11111111-1111-4111-8111-111111111111'], { from: 'user' });
    expect(log).toHaveBeenCalledWith('{"bound":true}');
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      body: '{"operation":"bind"}',
      headers: { Authorization: 'Bearer scoped-access' },
    });
  });
  it('uses the native bridge and emits its readiness as JSON', async () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    vi.spyOn(process.stdin, 'resume').mockReturnValue(process.stdin);
    vi.spyOn(process.stdin, 'pause').mockReturnValue(process.stdin);
    const program = new Command();
    createWorkspaceCommand().register(program);
    await program.parseAsync(
      [
        'workspaces',
        'connect',
        '11111111-1111-4111-8111-111111111111',
        '--installation',
        '22222222-2222-4222-8222-222222222222',
        '--service-url',
        'http://127.0.0.1:8000',
      ],
      { from: 'user' },
    );
    expect(log).toHaveBeenCalledWith('{"connected":true}');
  });
});
