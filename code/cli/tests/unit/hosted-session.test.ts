import { projectComposition } from '../../src/projection/ProjectHarness.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthStorage } from '@earendil-works/pi-coding-agent';
import { Command } from 'commander';
import { HostedClient } from '../../src/hosted/HostedClient.js';
import { HostedSession, createHostedSession } from '../../src/hosted/HostedSession.js';
import { createHostedCommand } from '../../src/cli/commands/HostedCommand.js';
import { experimentalProviderEnabled } from '../../src/hosted/ExperimentalProvider.js';
import { loadSettings } from '../../src/settings/SettingsLoader.js';

const identity = { user: { id: 'github:1', login: 'owner' } };
const credentials = {
  type: 'oauth' as const,
  access: 'access',
  refresh: 'refresh',
  expires: Date.now() + 60000,
  origin: 'https://beta.ai-outfitter.com',
};
const dirs: string[] = [];
const home = () => {
  const path = mkdtempSync(join(tmpdir(), 'outfitter-hosted-'));
  dirs.push(path);
  return path;
};
afterEach(() => {
  dirs.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }));
  vi.restoreAllMocks();
});
const fixture = (responses: Response[] = []) => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => Promise.resolve(responses.shift()!));
  const auth = AuthStorage.inMemory({ outfitter: credentials, anthropic: { type: 'api_key', key: 'byok' } });
  const client = new HostedClient({ fetch });
  return { session: new HostedSession(client, auth), fetch, auth, client };
};

describe('internal inference opt-in and durable authorization', () => {
  it('defaults off and only loads schema-valid home settings', () => {
    const path = home();
    expect(experimentalProviderEnabled(path)).toBe(false);
    mkdirSync(join(path, '.agents'));
    const file = join(path, '.agents/settings.yml');
    writeFileSync(file, 'experimental:\n  outfitter_provider: true\n');
    expect(experimentalProviderEnabled(path)).toBe(true);
    for (const scope of ['project', 'project-local', 'remote'] as const)
      expect(loadSettings({ locations: [{ scope, path: file }] }).settings.experimental).toBeUndefined();
    writeFileSync(join(path, '.agents/settings.local.yml'), 'experimental:\n  outfitter_provider: false\n');
    expect(experimentalProviderEnabled(path)).toBe(false);
    writeFileSync(file, 'experimental:\n  outfitter_provider: wrong\n');
    expect(() => experimentalProviderEnabled(path)).toThrow();
  });
  it('reuses durable Pi credentials across launches without touching BYOK', async () => {
    const path = home();
    const first = createHostedSession(path);
    first.auth.set('outfitter', credentials);
    first.auth.set('openai', { type: 'api_key', key: 'existing' });
    const next = createHostedSession(path);
    expect(await next.access()).toBe('access');
    expect(next.auth.get('openai')).toEqual({ type: 'api_key', key: 'existing' });
  });
  it('refreshes expired access using native Pi and reports missing credentials', async () => {
    const { session, auth } = fixture([
      Response.json({ access_token: 'new', refresh_token: 'new-r', expires_in: 900 }),
    ]);
    auth.set('outfitter', { ...credentials, expires: 0 });
    expect(await session.access()).toBe('new');
    vi.spyOn(auth, 'getApiKey').mockResolvedValue(undefined);
    await expect(session.access()).rejects.toThrow('login again');
    auth.logout('outfitter');
    await expect(session.access()).rejects.toThrow('login first');
    await expect(session.logout()).rejects.toThrow('login first');
  });
  it('revokes expired access without refresh and preserves other providers', async () => {
    const { session, auth, fetch } = fixture([new Response(null, { status: 204 })]);
    auth.set('outfitter', { ...credentials, expires: 0 });
    await session.logout();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://beta.ai-outfitter.com/api/cli/logout');
    expect(auth.get('outfitter')).toBeUndefined();
    expect(auth.get('anthropic')).toEqual({ type: 'api_key', key: 'byok' });
  });
  it('retains credentials on failed revocation and rejects other origins', async () => {
    const { session, auth, fetch } = fixture([new Response(null, { status: 503 })]);
    await expect(session.logout()).rejects.toThrow('(503)');
    expect(auth.get('outfitter')).toBeDefined();
    auth.set('outfitter', { ...credentials, origin: 'https://other.example' });
    await expect(session.logout()).rejects.toThrow('another origin');
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it('shares CLI login with Pi OAuth and hides commands when disabled', async () => {
    const { session, client } = fixture([Response.json(identity)]);
    vi.spyOn(client, 'login').mockResolvedValue(credentials);
    expect(
      await session.login({ onAuth: vi.fn(), onDeviceCode: vi.fn(), onPrompt: vi.fn(), onSelect: vi.fn() }),
    ).toEqual(identity);
    const login = vi.spyOn(session, 'login').mockImplementation(async (callbacks) => {
      callbacks.onDeviceCode({ verificationUri: 'https://beta.ai-outfitter.com/device', userCode: 'ABC' });
      callbacks.onAuth({ url: 'https://beta.ai-outfitter.com/device' });
      await expect(callbacks.onPrompt({ message: '?' })).rejects.toThrow('browser');
      expect(await callbacks.onSelect({ message: '?', options: [] })).toBeUndefined();
      return identity;
    });
    const logout = vi.spyOn(session, 'logout').mockResolvedValue();
    let enabled = false;
    const program = new Command();
    const writeLine = vi.fn();
    createHostedCommand({ session: () => session, enabled: () => enabled, writeLine }).register(program);
    expect(program.helpInformation()).not.toContain('login');
    await expect(program.parseAsync(['login'], { from: 'user' })).rejects.toThrow('experimental.outfitter_provider');
    expect(login).not.toHaveBeenCalled();
    await program.parseAsync(['logout'], { from: 'user' });
    expect(logout).toHaveBeenCalledOnce();
    enabled = true;
    await program.parseAsync(['login'], { from: 'user' });
    expect(login).toHaveBeenCalledOnce();
    expect(writeLine).toHaveBeenCalledWith('Signed in to Outfitter internal beta as owner.');
  });
});

it('blocks pending revocations and retries before replacing credentials at login', async () => {
  const { session, auth, client } = fixture([new Response(null, { status: 204 }), Response.json(identity)]);
  auth.set('outfitter', { ...credentials, pendingRevocation: true });
  await expect(session.access()).rejects.toThrow('logout is pending');
  vi.spyOn(client, 'login').mockResolvedValue(credentials);
  expect(await session.login({ onAuth: vi.fn(), onDeviceCode: vi.fn(), onPrompt: vi.fn(), onSelect: vi.fn() })).toEqual(
    identity,
  );
});

it('rejects explicit disabled Outfitter selections instead of falling back', () => {
  const dir = home();
  for (const args of [
    ['--provider', 'outfitter'],
    ['--model', 'outfitter/spark/model'],
    ['--model=outfitter/spark/model'],
    ['--provider=outfitter'],
  ]) {
    expect(() =>
      projectComposition(
        {
          agent: 'agent',
          identity: { agentBody: 'Body.' },
          loadout: {
            skills: [],
            delegateSkills: [],
            subagents: [],
            mcp: [],
            mcpServers: {},
            extensions: [],
            plugins: [],
          },
          warnings: [],
        },
        {
          harness: 'pi',
          rootDirectory: dir,
          homeDirectory: dir,
          passThroughArgs: args,
        },
      ),
    ).toThrow('experimental.outfitter_provider');
  }
  mkdirSync(join(dir, '.agents'));
  writeFileSync(join(dir, '.agents/settings.yml'), 'experimental:\n  outfitter_provider: true\n');
  const projection = projectComposition(
    {
      agent: 'agent',
      identity: { agentBody: 'Body.' },
      loadout: { skills: [], delegateSkills: [], subagents: [], mcp: [], mcpServers: {}, extensions: [], plugins: [] },
      warnings: [],
    },
    {
      harness: 'pi',
      rootDirectory: dir,
      homeDirectory: dir,
      passThroughArgs: ['--model', 'outfitter/spark/model'],
    },
  );
  expect(projection.launch.args).toContain('outfitter/spark/model');
});
