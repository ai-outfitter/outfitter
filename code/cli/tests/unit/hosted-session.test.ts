import { projectComposition } from '../../src/projection/ProjectHarness.js';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthStorage } from '@earendil-works/pi-coding-agent';
import { Command } from 'commander';
import { HostedClient } from '../../src/hosted/HostedClient.js';
import { HostedSession, createHostedSession } from '../../src/hosted/HostedSession.js';
import { createHostedCommand } from '../../src/cli/commands/HostedCommand.js';
import { experimentalProviderEnabled, hostedSettings } from '../../src/hosted/ExperimentalProvider.js';
import { loadSettings } from '../../src/settings/SettingsLoader.js';
import { seedPiCredentials, persistPiAuth, withWritebackBaseline } from '../../src/agents/PiCredentialPersistence.js';
import { durableRefresh } from '../../src/hosted/DurableCredentials.js';

const identity = { sub: 'user-1', name: 'Owner', email: 'owner@example.com' };
const credentials = {
  type: 'oauth' as const,
  access: 'access',
  refresh: 'refresh',
  expires: Date.now() + 60000,
  origin: 'https://ai-outfitter.com',
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
  vi.unstubAllEnvs();
});
const fixture = (responses: Response[] = []) => {
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => Promise.resolve(responses.shift()!));
  const auth = AuthStorage.inMemory({ outfitter: credentials, anthropic: { type: 'api_key', key: 'byok' } });
  const client = new HostedClient({ fetch });
  return { session: new HostedSession(client, auth), fetch, auth, client };
};
const copiedFixture = (responses: Response[], initial: typeof credentials | undefined = credentials) => {
  const path = home();
  const durableDirectory = join(path, 'durable');
  const runDirectory = join(path, 'run');
  mkdirSync(durableDirectory);
  const durablePath = join(durableDirectory, 'auth.json');
  writeFileSync(durablePath, JSON.stringify({ outfitter: initial }));
  const baseline = seedPiCredentials(runDirectory, durableDirectory);
  const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation(() => Promise.resolve(responses.shift()!));
  const client = new HostedClient({ fetch });
  const auth = AuthStorage.create(join(runDirectory, 'auth.json'));
  const session = new HostedSession(client, auth, durablePath);
  return { client, auth, session, fetch, durablePath, durableDirectory, runDirectory, baseline };
};
const deviceCallbacks = () => ({
  onAuth: vi.fn(),
  onDeviceCode: vi.fn(),
  onPrompt: vi.fn(),
  onSelect: vi.fn().mockResolvedValue('device-code'),
});

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
  it('reads a trusted origin from home settings only and keeps it across home files', () => {
    const path = home();
    expect(hostedSettings(path)).toEqual({ enabled: false, origin: 'https://ai-outfitter.com' });
    mkdirSync(join(path, '.agents'));
    const file = join(path, '.agents/settings.yml');
    writeFileSync(file, 'experimental:\n  outfitter_origin: http://localhost:4390\n');
    writeFileSync(join(path, '.agents/settings.local.yml'), 'experimental:\n  outfitter_provider: true\n');
    expect(hostedSettings(path)).toEqual({ enabled: true, origin: 'http://localhost:4390' });
    for (const scope of ['project', 'project-local', 'remote'] as const)
      expect(loadSettings({ locations: [{ scope, path: file }] }).settings.experimental).toBeUndefined();
    expect(createHostedSession(path).client.origin).toBe('http://localhost:4390');
    writeFileSync(file, 'experimental:\n  outfitter_origin: http://example.com\n');
    expect(() => hostedSettings(path)).toThrow('HTTPS');
    writeFileSync(file, 'experimental:\n  outfitter_origin: ftp://example.com\n');
    expect(() => hostedSettings(path)).toThrow();
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
  it('keeps an in-session re-login after refresh and exit while preserving other providers', async () => {
    const path = home();
    const durableDirectory = join(path, 'durable');
    const runDirectory = join(path, 'run');
    mkdirSync(durableDirectory);
    const durablePath = join(durableDirectory, 'auth.json');
    const byok = { type: 'api_key', key: 'existing' };
    writeFileSync(durablePath, JSON.stringify({ outfitter: { ...credentials, expires: 0 }, openai: byok }));
    const baseline = seedPiCredentials(runDirectory, durableDirectory);
    const responses = [
      Response.json({ access_token: 'rotated', refresh_token: 'rotated-r', expires_in: 900 }),
      Response.json(identity),
    ];
    const client = new HostedClient({
      fetch: vi.fn<typeof globalThis.fetch>().mockImplementation(() => Promise.resolve(responses.shift()!)),
    });
    const session = new HostedSession(client, AuthStorage.create(join(runDirectory, 'auth.json')), durablePath);
    expect(await session.access()).toBe('rotated');
    const relogin = { ...credentials, access: 'relogin', refresh: 'relogin-r' };
    vi.spyOn(client, 'login').mockResolvedValue(relogin);
    await session.login({
      onAuth: vi.fn(),
      onDeviceCode: vi.fn(),
      onPrompt: vi.fn(),
      onSelect: vi.fn().mockResolvedValue('device-code'),
    });
    const beforeExit = JSON.parse(readFileSync(durablePath, 'utf8')) as { outfitter: typeof relogin };
    expect(beforeExit.outfitter.refresh).toBe('relogin-r');
    await persistPiAuth(runDirectory, durableDirectory, baseline);
    const persisted = JSON.parse(readFileSync(durablePath, 'utf8')) as {
      outfitter: typeof relogin;
      openai: typeof byok;
    };
    expect(persisted.outfitter.refresh).toBe('relogin-r');
    expect(persisted.openai).toEqual(byok);
  });
  it('never persists write-back metadata, so a later seeded run cannot resurrect a logged-out credential', async () => {
    const first = copiedFixture([Response.json(identity)], undefined);
    AuthStorage.create(first.durablePath).logout('outfitter');
    first.auth.logout('outfitter');
    const firstBaseline = seedPiCredentials(first.runDirectory, first.durableDirectory);
    vi.spyOn(first.client, 'login').mockResolvedValue(credentials);
    await first.session.login(deviceCallbacks());
    await persistPiAuth(first.runDirectory, first.durableDirectory, firstBaseline);
    const durable = JSON.parse(readFileSync(first.durablePath, 'utf8')) as { outfitter: Record<string, unknown> };
    expect(durable.outfitter.refresh).toBe('refresh');
    expect(durable.outfitter).not.toHaveProperty('outfitterWritebackBaseline');
    for (const legacy of [false, true]) {
      // A durable file written before the metadata was stripped must not be trusted either.
      if (legacy)
        writeFileSync(
          first.durablePath,
          JSON.stringify({ outfitter: { ...credentials, outfitterWritebackBaseline: null } }),
        );
      const secondRun = join(first.durableDirectory, '..', legacy ? 'legacy-run' : 'second-run');
      const secondBaseline = seedPiCredentials(secondRun, first.durableDirectory);
      const projected = JSON.parse(readFileSync(join(secondRun, 'auth.json'), 'utf8')) as {
        outfitter: Record<string, unknown>;
      };
      expect(projected.outfitter).toEqual(credentials);
      expect(projected.outfitter).not.toHaveProperty('outfitterWritebackBaseline');
      // Another run signs out, then the seeded run exits without refreshing.
      AuthStorage.create(first.durablePath).logout('outfitter');
      await persistPiAuth(secondRun, first.durableDirectory, secondBaseline);
      expect(AuthStorage.create(first.durablePath).get('outfitter')).toBeUndefined();
      writeFileSync(first.durablePath, JSON.stringify({ outfitter: credentials }));
    }
  });
  it.each([
    ['unexpired', Date.now() + 60000],
    ['expired', 0],
  ])(
    'keeps a re-login to a different account through a later refresh when the old %s entry is unchanged',
    async (_label, oldExpires) => {
      const copied = copiedFixture(
        [
          Response.json({ access_token: 'relogin-rotated', refresh_token: 'relogin-rotated-r', expires_in: 900 }),
          Response.json({ sub: 'user-2', email: 'other@example.com' }),
        ],
        { ...credentials, expires: oldExpires },
      );
      // The new account's access expires at once, so the login's identity check refreshes it.
      vi.spyOn(copied.client, 'login').mockResolvedValue({
        ...credentials,
        access: 'relogin',
        refresh: 'relogin-r',
        expires: 0,
      });
      expect(await copied.session.login(deviceCallbacks())).toEqual({ sub: 'user-2', email: 'other@example.com' });
      const refreshBody = copied.fetch.mock.calls[0][1]?.body;
      expect(typeof refreshBody).toBe('string');
      expect(new URLSearchParams(refreshBody as string).get('refresh_token')).toBe('relogin-r');
      expect(AuthStorage.create(copied.durablePath).get('outfitter')).toMatchObject({ refresh: 'relogin-rotated-r' });
      await persistPiAuth(copied.runDirectory, copied.durableDirectory, copied.baseline);
      const persisted = JSON.parse(readFileSync(copied.durablePath, 'utf8')) as { outfitter: Record<string, unknown> };
      expect(persisted.outfitter).toMatchObject({ access: 'relogin-rotated', refresh: 'relogin-rotated-r' });
      expect(persisted.outfitter).not.toHaveProperty('outfitterWritebackBaseline');
    },
  );
  describe('a durable rotation by another run during the device wait', () => {
    const rotated = { ...credentials, access: 'rotated', refresh: 'rotated-r' };
    const revokedTokens = (fetch: ReturnType<typeof copiedFixture>['fetch']) =>
      fetch.mock.calls.map(([url, init]) => {
        expect(url).toBe('https://ai-outfitter.com/api/oauth/revoke');
        return new URLSearchParams(init?.body as string).get('token');
      });
    const expectRotatedKept = async (copied: ReturnType<typeof copiedFixture>) => {
      const durable = JSON.parse(readFileSync(copied.durablePath, 'utf8')) as { outfitter: Record<string, unknown> };
      expect(durable.outfitter).toEqual(rotated);
      await persistPiAuth(copied.runDirectory, copied.durableDirectory, copied.baseline);
      expect(JSON.parse(readFileSync(copied.durablePath, 'utf8'))).toEqual({ outfitter: rotated });
    };
    it.each([
      ['unexpired', Date.now() + 60000],
      ['expired', 0],
    ])('refuses a login with %s access before Pi stores it and keeps the rotated entry', async (_label, expires) => {
      const copied = copiedFixture([new Response(null, { status: 200 })]);
      vi.spyOn(copied.client, 'login').mockImplementation(() => {
        writeFileSync(copied.durablePath, JSON.stringify({ outfitter: rotated }));
        return Promise.resolve({ ...credentials, access: 'new', refresh: 'new-r', expires });
      });
      await expect(copied.session.login(deviceCallbacks())).rejects.toThrow('another session changed');
      expect(revokedTokens(copied.fetch)).toEqual(['new-r']);
      copied.auth.reload();
      expect(copied.auth.get('outfitter')).toEqual(credentials);
      await expectRotatedKept(copied);
    });
    it.each([
      ['unexpired', Date.now() + 60000, [Response.json(identity)]],
      ['expired', 0, []],
    ])(
      'reports no success and removes a stored login with %s access once the durable entry changes',
      async (_label, expires, responses) => {
        const copied = copiedFixture([...responses, new Response(null, { status: 200 })]);
        vi.spyOn(copied.client, 'login').mockResolvedValue({
          ...credentials,
          access: 'new',
          refresh: 'new-r',
          expires,
        });
        const identityCheck = copied.session.identity.bind(copied.session);
        vi.spyOn(copied.session, 'identity').mockImplementation(() => {
          // The rotation lands after the login was stored, before its identity is reported.
          writeFileSync(copied.durablePath, JSON.stringify({ outfitter: rotated }));
          return identityCheck();
        });
        await expect(copied.session.login(deviceCallbacks())).rejects.toThrow('another session changed');
        const calls = copied.fetch.mock.calls.filter(([url]) => url === 'https://ai-outfitter.com/api/oauth/revoke');
        expect(calls.map(([, init]) => new URLSearchParams(init?.body as string).get('token'))).toEqual(['new-r']);
        expect(copied.fetch.mock.calls.some(([url]) => url === 'https://ai-outfitter.com/api/oauth/token')).toBe(false);
        copied.auth.reload();
        expect(copied.auth.get('outfitter')).toBeUndefined();
        await expectRotatedKept(copied);
      },
    );
    it('fails a durable refresh of the login with a conflict instead of adopting the rotated entry', async () => {
      const copied = copiedFixture([]);
      writeFileSync(copied.durablePath, JSON.stringify({ outfitter: rotated }));
      const login = withWritebackBaseline(
        { ...credentials, access: 'new', refresh: 'new-r', expires: 0 },
        { source: 'login', digest: copied.baseline.hosted },
      );
      await expect(durableRefresh(copied.client, copied.durablePath)(login)).rejects.toThrow('another session changed');
      expect(copied.fetch).not.toHaveBeenCalled();
      expect(JSON.parse(readFileSync(copied.durablePath, 'utf8'))).toEqual({ outfitter: rotated });
      // A refreshed or adopted credential still adopts another run's rotation, as before.
      const refreshed = withWritebackBaseline(credentials, { source: 'refresh', digest: copied.baseline.hosted });
      const adopted = await durableRefresh(copied.client, copied.durablePath)(refreshed);
      expect(adopted).toMatchObject({ refresh: 'rotated-r' });
    });
  });
  it('refreshes expired access using native Pi and reports missing credentials', async () => {
    const { session, auth } = fixture([
      Response.json({ access_token: 'new', refresh_token: 'new-r', expires_in: 900 }),
    ]);
    auth.set('outfitter', { ...credentials, expires: 0 });
    expect(await session.access()).toBe('new');
    vi.spyOn(auth, 'getApiKey').mockResolvedValue(undefined);
    await expect(session.access()).rejects.toThrow('expired or was revoked');
    auth.logout('outfitter');
    await expect(session.access()).rejects.toThrow('login first');
    await expect(session.logout()).rejects.toThrow('login first');
  });
  it('preserves a concurrent deletion after first login and refresh when the initial durable entry was absent', async () => {
    const copied = copiedFixture(
      [
        Response.json(identity),
        Response.json({ access_token: 'rotated', refresh_token: 'rotated-r', expires_in: 900 }),
      ],
      undefined,
    );
    // Explicitly start with an absent entry (the fixture default also supports existing logins).
    AuthStorage.create(copied.durablePath).logout('outfitter');
    copied.auth.logout('outfitter');
    const baseline = seedPiCredentials(copied.runDirectory, copied.durableDirectory);
    vi.spyOn(copied.client, 'login').mockResolvedValue(credentials);
    await copied.session.login(deviceCallbacks());
    const loggedIn = copied.auth.get('outfitter');
    expect(loggedIn?.type).toBe('oauth');
    copied.auth.set('outfitter', { ...credentials, expires: 0 });
    expect(await copied.session.access()).toBe('rotated');
    AuthStorage.create(copied.durablePath).logout('outfitter');
    await persistPiAuth(copied.runDirectory, copied.durableDirectory, baseline);
    expect(AuthStorage.create(copied.durablePath).get('outfitter')).toBeUndefined();
  });
  it('finishes a durable pending logout before a copied session can issue and persist a new login', async () => {
    const copied = copiedFixture([new Response(null, { status: 200 }), Response.json(identity)]);
    AuthStorage.create(copied.durablePath).set('outfitter', { ...credentials, pendingRevocation: true });
    const login = vi.spyOn(copied.client, 'login').mockImplementation(() => {
      expect(AuthStorage.create(copied.durablePath).get('outfitter')).toBeUndefined();
      return Promise.resolve({ ...credentials, access: 'relogin', refresh: 'relogin-r' });
    });
    await copied.session.login(deviceCallbacks());
    expect(login).toHaveBeenCalledOnce();
    expect(copied.fetch.mock.calls[0][0]).toContain('/api/oauth/revoke');
    await persistPiAuth(copied.runDirectory, copied.durableDirectory, copied.baseline);
    expect(AuthStorage.create(copied.durablePath).get('outfitter')).toMatchObject({ access: 'relogin' });
  });
  it('revokes expired access without refresh and preserves other providers', async () => {
    const { session, auth, fetch } = fixture([new Response(null, { status: 200 })]);
    auth.set('outfitter', { ...credentials, expires: 0 });
    await session.logout();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0][0]).toBe('https://ai-outfitter.com/api/oauth/revoke');
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
      await session.login({
        onAuth: vi.fn(),
        onDeviceCode: vi.fn(),
        onPrompt: vi.fn(),
        onSelect: vi.fn().mockResolvedValue('device-code'),
      }),
    ).toEqual(identity);
    const login = vi.spyOn(session, 'login').mockImplementation(async (callbacks) => {
      callbacks.onDeviceCode({ verificationUri: 'https://ai-outfitter.com/device', userCode: 'ABC' });
      callbacks.onAuth({ url: 'https://ai-outfitter.com/device' });
      callbacks.onAuth({ url: 'https://ai-outfitter.com/device?user_code=ABC', instructions: 'Confirm ABC' });
      await expect(callbacks.onPrompt({ message: '?' })).rejects.toThrow('browser');
      expect(await callbacks.onSelect({ message: '?', options: [] })).toBe('browser');
      callbacks.onProgress?.('Waiting for approval');
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
    expect(writeLine).toHaveBeenCalledWith('Open https://ai-outfitter.com/device?user_code=ABC\nConfirm ABC');
    expect(writeLine).toHaveBeenCalledWith('Signed in to Outfitter as owner@example.com.');
    login.mockResolvedValueOnce({ sub: 'user-1', name: 'Owner' });
    await program.parseAsync(['login'], { from: 'user' });
    expect(writeLine).toHaveBeenCalledWith('Signed in to Outfitter as Owner.');
    login.mockResolvedValueOnce({ sub: 'user-1' });
    await program.parseAsync(['login'], { from: 'user' });
    expect(writeLine).toHaveBeenCalledWith('Signed in to Outfitter as user-1.');
  });
});

it('blocks pending revocations and retries before replacing credentials at login', async () => {
  const { session, auth, client } = fixture([new Response(null, { status: 200 }), Response.json(identity)]);
  auth.set('outfitter', { ...credentials, pendingRevocation: true });
  await expect(session.access()).rejects.toThrow('logout is pending');
  vi.spyOn(client, 'login').mockResolvedValue(credentials);
  expect(
    await session.login({
      onAuth: vi.fn(),
      onDeviceCode: vi.fn(),
      onPrompt: vi.fn(),
      onSelect: vi.fn().mockResolvedValue('device-code'),
    }),
  ).toEqual(identity);
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
