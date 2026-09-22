import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthStorage } from '@earendil-works/pi-coding-agent';
import { HostedClient } from '../../src/hosted/HostedClient.js';
import { HostedSession, createHostedSession } from '../../src/hosted/HostedSession.js';
import { createHostedCommand } from '../../src/cli/commands/HostedCommand.js';
import { Command } from 'commander';

const identity = {
  user: { id: 'github:1', email: 'owner@example.test' },
  workspace: { id: 'user:1', login: 'owner', type: 'User' },
  workspaces: [],
};
const response = (data: unknown) => new Response(JSON.stringify(data));
const credentials = {
  type: 'oauth' as const,
  access: 'access',
  refresh: 'refresh',
  expires: Date.now() + 60000,
  origin: 'https://ai-outfitter.com',
};
const directories: string[] = [];
afterEach(() => {
  for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true });
  vi.unstubAllEnvs();
});
const fixture = (responses: Response[] = []) => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => Promise.resolve(responses.shift()!));
  const auth = AuthStorage.inMemory({ outfitter: credentials, anthropic: { type: 'api_key', key: 'byok' } });
  const client = new HostedClient({ fetch });
  return { session: new HostedSession(client, auth), fetch, auth, client };
};

describe('Pi native credential lifecycle and workspace commands', () => {
  it('uses existing credentials, switches only to the requested payer, and refreshes discovery', async () => {
    const { session, fetch } = fixture([
      response(identity),
      response(identity),
      response({ data: [] }),
      response({ paidMicros: 400 }),
    ]);
    expect(await session.identity()).toEqual(identity);
    await session.workspace('org:2');
    expect(fetch.mock.calls[1][1]?.body).toBe(JSON.stringify({ workspace_id: 'org:2' }));
    expect(fetch.mock.calls[2][0]).toBe('https://ai-outfitter.com/v1/models');
    expect(await session.usage()).toEqual({ paidMicros: 400 });
  });
  it('does not switch to a fallback payer when membership is denied', async () => {
    const { session, fetch } = fixture([new Response(null, { status: 403 })]);
    await expect(session.workspace('org:denied')).rejects.toThrow('(403)');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('revokes remotely before deleting only the Outfitter credential', async () => {
    const { session, auth } = fixture([new Response(null, { status: 204 })]);
    await session.logout();
    expect(auth.get('outfitter')).toBeUndefined();
    expect(auth.get('anthropic')).toEqual({ type: 'api_key', key: 'byok' });
    await expect(session.access()).rejects.toThrow('login first');
  });
  it('retains credentials on failed revocation so logout can be retried', async () => {
    const { session, auth } = fixture([new Response(null, { status: 503 })]);
    await expect(session.logout()).rejects.toThrow('(503)');
    expect(auth.get('outfitter')).toBeDefined();
  });
  it('refreshes expired tokens through native Pi and rejects missing access', async () => {
    const { session, auth } = fixture([
      response({ access_token: 'new', refresh_token: 'new-refresh', expires_in: 60 }),
    ]);
    auth.set('outfitter', { ...credentials, expires: 0 });
    expect(await session.access()).toBe('new');
    expect(auth.get('outfitter')).toMatchObject({ access: 'new' });
    vi.spyOn(auth, 'getApiKey').mockResolvedValue(undefined);
    await expect(session.access()).rejects.toThrow('login again');
  });
  it('persists the same Pi auth format across CLI instances without touching BYOK', async () => {
    const home = mkdtempSync(join(tmpdir(), 'outfitter-hosted-'));
    directories.push(home);
    const first = createHostedSession(home, {});
    first.auth.set('outfitter', credentials);
    first.auth.set('openai', { type: 'api_key', key: 'existing' });
    const restarted = createHostedSession(home, {});
    expect(await restarted.access()).toBe('access');
    expect(restarted.auth.get('openai')).toEqual({ type: 'api_key', key: 'existing' });
    await expect(
      createHostedSession(home, { OUTFITTER_API_ORIGIN: 'https://different.example' }).access(),
    ).rejects.toThrow('another origin');
  });
  it('completes CLI browser login using the same OAuth implementation as Pi', async () => {
    const { session, client } = fixture([response(identity)]);
    const login = vi.spyOn(client, 'login').mockResolvedValue(credentials);
    const cb = { onAuth: vi.fn(), onDeviceCode: vi.fn(), onPrompt: vi.fn(), onSelect: vi.fn() };
    expect(await session.login(cb)).toEqual(identity);
    expect(login).toHaveBeenCalledWith(cb);
  });
  it('registers typed login, logout, account, workspace and usage commands', async () => {
    const { session } = fixture();
    const login = vi.spyOn(session, 'login').mockImplementation(async (callbacks) => {
      callbacks.onDeviceCode({ verificationUri: 'https://ai-outfitter.com/device', userCode: 'ABC' });
      callbacks.onAuth({ url: 'https://ai-outfitter.com/device' });
      await expect(callbacks.onPrompt({ message: '?' })).rejects.toThrow('browser');
      expect(await callbacks.onSelect({ message: '?', options: [] })).toBeUndefined();
      return identity as Awaited<ReturnType<HostedSession['identity']>>;
    });
    vi.spyOn(session, 'identity').mockResolvedValue(identity as Awaited<ReturnType<HostedSession['identity']>>);
    const workspace = vi
      .spyOn(session, 'workspace')
      .mockResolvedValue(identity as Awaited<ReturnType<HostedSession['identity']>>);
    vi.spyOn(session, 'usage').mockResolvedValue({ paidMicros: 300 });
    const logout = vi.spyOn(session, 'logout').mockResolvedValue();
    const writeLine = vi.fn();
    const program = new Command();
    createHostedCommand({ session: () => session, writeLine }).register(program);
    for (const args of [['login'], ['account'], ['workspace', 'org:2'], ['usage'], ['logout']])
      await program.parseAsync(args, { from: 'user' });
    expect(login).toHaveBeenCalledOnce();
    expect(workspace).toHaveBeenCalledWith('org:2');
    expect(logout).toHaveBeenCalledOnce();
    expect(writeLine).toHaveBeenCalledWith('Signed out of Outfitter.');
  });
});
