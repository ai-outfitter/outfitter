import { describe, expect, it, vi } from 'vitest';
import type { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { Command } from 'commander';
import { createHostedCommand } from '../../src/cli/commands/HostedCommand.js';
import type { HostedSession } from '../../src/hosted/HostedSession.js';
import { HostedClient } from '../../src/hosted/HostedClient.js';
import { openBrowser } from '../../src/hosted/OpenBrowser.js';
import type { HostedOAuth } from '../../src/hosted/HostedClient.js';

const fixture = (method: string | undefined = 'browser') => {
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(
      Response.json({
        device_code: 'private-device-secret',
        user_code: 'ABC123',
        verification_uri: 'https://beta.ai-outfitter.com/internal/authorize',
        expires_in: 600,
        interval: 5,
      }),
    )
    .mockResolvedValueOnce(Response.json({ access_token: 'access', refresh_token: 'refresh', expires_in: 900 }));
  const open = vi.fn<(url: string) => Promise<boolean>>().mockResolvedValue(true);
  const callbacks: Parameters<HostedOAuth['login']>[0] = {
    onAuth: vi.fn(),
    onDeviceCode: vi.fn(),
    onPrompt: vi.fn(),
    onSelect: vi.fn().mockResolvedValue(method),
    onProgress: vi.fn(),
  };
  const client = new HostedClient({ fetch, openBrowser: open, sleep: async () => {}, now: () => 0 });
  return { fetch, open, callbacks, client };
};

describe('Outfitter browser login', () => {
  it('opens a prefilled approved-origin URL and finishes using the shared token exchange', async () => {
    const { client, callbacks, fetch, open } = fixture();
    expect(await client.oauth().login(callbacks)).toMatchObject({ access: 'access', origin: client.origin });
    expect(open).toHaveBeenCalledWith('https://beta.ai-outfitter.com/internal/authorize?user_code=ABC123');
    expect(callbacks.onAuth).toHaveBeenCalledWith(expect.objectContaining({ url: open.mock.calls[0][0] }));
    expect(callbacks.onDeviceCode).not.toHaveBeenCalled();
    expect(open.mock.calls[0][0]).not.toContain('private-device-secret');
    expect((JSON.parse(fetch.mock.calls[1][1]?.body as string) as { device_code: string }).device_code).toBe(
      'private-device-secret',
    );
  });
  it.each(['false', 'throw'])('keeps manual URL approval usable if the browser opener fails (%s)', async (mode) => {
    const { client, callbacks, open } = fixture();
    if (mode === 'false') open.mockResolvedValue(false);
    else open.mockRejectedValue(new Error('No desktop'));
    expect(await client.oauth().login(callbacks)).toMatchObject({ access: 'access' });
    expect(callbacks.onAuth).toHaveBeenCalled();
    expect(callbacks.onProgress).toHaveBeenCalledWith(expect.stringContaining('Could not open a browser'));
  });
  it('retains device-code selection without opening the browser', async () => {
    const { client, callbacks, open } = fixture('device-code');
    await client.oauth().login(callbacks);
    expect(open).not.toHaveBeenCalled();
    expect(callbacks.onAuth).not.toHaveBeenCalled();
    expect(callbacks.onDeviceCode).toHaveBeenCalledWith(expect.objectContaining({ userCode: 'ABC123' }));
  });
  it('cancels selection before creating a device or launching a browser', async () => {
    const { client, callbacks, fetch, open } = fixture('cancel');
    await expect(client.oauth().login(callbacks)).rejects.toThrow('cancelled');
    expect(fetch).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });
  it('rejects credential-bearing verification URLs before launching', async () => {
    const { client, callbacks, fetch, open } = fixture();
    fetch.mockReset().mockResolvedValueOnce(
      Response.json({
        device_code: 's',
        user_code: 'ABC',
        verification_uri: 'https://user:secret@beta.ai-outfitter.com/internal/authorize',
        expires_in: 600,
        interval: 5,
      }),
    );
    await expect(client.oauth().login(callbacks)).rejects.toThrow('Unexpected');
    expect(open).not.toHaveBeenCalled();
  });
});

const launcher = () => {
  const child = Object.assign(new EventEmitter(), { unref: vi.fn() });
  const launch = vi.fn(() => child) as unknown as typeof spawn;
  return { child, launch };
};
it.each([
  ['linux', 'xdg-open', ['https://example.com/?a=1&b=2']],
  ['darwin', 'open', ['https://example.com/?a=1&b=2']],
  ['win32', 'rundll32.exe', ['url.dll,FileProtocolHandler', 'https://example.com/?a=1&b=2']],
] as const)('opens browser without shell interpolation on %s', async (platform, command, args) => {
  const { child, launch } = launcher();
  const result = openBrowser('https://example.com/?a=1&b=2', platform, launch);
  child.emit('exit', 0);
  expect(await result).toBe(true);
  expect(launch).toHaveBeenCalledWith(command, [...args], { detached: true, stdio: 'ignore', windowsHide: true });
  expect(child.unref).toHaveBeenCalled();
});
it.each(['error', 'exit'])('reports an unavailable desktop (%s)', async (event) => {
  const { child, launch } = launcher();
  const result = openBrowser('https://example.com', 'linux', launch);
  child.emit(event, event === 'exit' ? 1 : new Error('ENOENT'));
  expect(await result).toBe(false);
});
it('does not wait for or kill a long-running browser session', async () => {
  vi.useFakeTimers();
  try {
    const { child, launch } = launcher();
    const result = openBrowser('https://example.com', undefined, launch);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await result).toBe(true);
    expect(child.unref).toHaveBeenCalled();
    child.emit('exit', 0);
  } finally {
    vi.useRealTimers();
  }
});

it.each([
  ['browser', []],
  ['device-code', ['--device-code']],
] as const)('CLI selects %s explicitly', async (expected, args) => {
  const selected: (string | undefined)[] = [];
  const session = {
    login: async (callbacks: Parameters<HostedOAuth['login']>[0]) => {
      selected.push(await callbacks.onSelect({ message: 'method', options: [] }));
      return { user: { id: 'github:1', login: 'alice' } };
    },
  } as unknown as HostedSession;
  const program = new Command();
  createHostedCommand({ session: () => session, enabled: () => true, writeLine: vi.fn() }).register(program);
  await program.parseAsync(['login', ...args], { from: 'user' });
  expect(selected).toEqual([expected]);
});
