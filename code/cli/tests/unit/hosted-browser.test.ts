import { describe, expect, it, vi } from 'vitest';
import type { execFile } from 'node:child_process';
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

it.each([
  ['linux', 'xdg-open', ['https://example.com/?a=1&b=2']],
  ['darwin', 'open', ['https://example.com/?a=1&b=2']],
  ['win32', 'rundll32.exe', ['url.dll,FileProtocolHandler', 'https://example.com/?a=1&b=2']],
] as const)('opens browser without shell interpolation on %s', async (platform, command, args) => {
  const launch = vi.fn(
    (_command: string, _args: string[], _options: unknown, callback: (error: Error | null) => void) => {
      callback(null);
    },
  ) as unknown as typeof execFile;
  expect(await openBrowser('https://example.com/?a=1&b=2', platform, launch)).toBe(true);
  expect(launch).toHaveBeenCalledWith(command, [...args], { timeout: 5000, windowsHide: true }, expect.any(Function));
});
it('reports an unavailable desktop instead of failing login', async () => {
  const launch = vi.fn(
    (_command: string, _args: string[], _options: unknown, callback: (error: Error | null) => void) => {
      callback(new Error('ENOENT'));
    },
  ) as unknown as typeof execFile;
  expect(await openBrowser('https://example.com', 'linux', launch)).toBe(false);
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
