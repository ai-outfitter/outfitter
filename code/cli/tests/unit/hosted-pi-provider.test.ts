import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import * as experimental from '../../src/hosted/ExperimentalProvider.js';
import outfitterProvider from '../../src/hosted/PiProvider.js';
import { HostedClient } from '../../src/hosted/HostedClient.js';
import type { ProviderConfig } from '../../src/hosted/HostedClient.js';

const ORIGIN = 'https://ai-outfitter.com';
let home: string;
beforeEach(() => {
  // The provider reads the durable ~/.pi/agent/auth.json; never the real one.
  home = mkdtempSync(join(tmpdir(), 'outfitter-pi-provider-'));
  vi.stubEnv('HOME', home);
  vi.stubEnv('PI_CODING_AGENT_DIR', join(home, 'session'));
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  rmSync(home, { recursive: true, force: true });
});
const settings = (enabled: boolean) =>
  vi.spyOn(experimental, 'hostedSettings').mockReturnValue({ enabled, origin: ORIGIN });
const model = { id: 'GLM-5.3-Flash-EXL3', name: 'GLM', context_length: 900000, max_output_tokens: 32768 };
const credential = {
  type: 'oauth' as const,
  access: 'secret',
  refresh: 'refresh',
  expires: Date.now() + 10000,
  origin: ORIGIN,
};

describe('bundled native Pi provider', () => {
  it('uses isolated settings and durable credentials while leaving the operating-system home alone', async () => {
    const isolated = join(home, 'isolated');
    mkdirSync(join(isolated, '.agents'), { recursive: true });
    writeFileSync(join(isolated, '.agents', 'settings.yml'), 'experimental:\n  outfitter_provider: true\n');
    vi.stubEnv('OUTFITTER_USER_HOME', isolated);
    const ambient = AuthStorage.create(join(home, '.pi', 'agent', 'auth.json'));
    ambient.set('outfitter', { ...credential, access: 'ambient', refresh: 'ambient-r' });
    const durable = AuthStorage.create(join(isolated, '.pi', 'agent', 'auth.json'));
    durable.set('outfitter', { ...credential, access: 'isolated', refresh: 'isolated-r' });
    const copy = AuthStorage.create(join(home, 'session', 'auth.json'));
    copy.set('outfitter', { ...credential, expires: 0 });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ data: [model] }));
    vi.stubGlobal('fetch', fetch);
    let logout: Parameters<ExtensionAPI['registerCommand']>[1] | undefined;
    await outfitterProvider({
      registerProvider: vi.fn(),
      on: vi.fn(),
      registerCommand: (name: string, command: typeof logout) => {
        if (name === 'outfitter-logout') logout = command;
      },
    } as unknown as ExtensionAPI);
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer isolated' });
    fetch.mockResolvedValue(new Response(null, { status: 200 }));
    await logout!.handler('', { ui: { notify: vi.fn() } } as unknown as ExtensionCommandContext);
    expect(AuthStorage.create(join(isolated, '.pi', 'agent', 'auth.json')).get('outfitter')).toBeUndefined();
    expect(AuthStorage.create(join(home, 'session', 'auth.json')).get('outfitter')).toBeUndefined();
    expect(ambient.get('outfitter')).toMatchObject({ access: 'ambient', refresh: 'ambient-r' });
  });
  it('does not register or contact services until enabled', async () => {
    settings(false);
    const registerProvider = vi.fn();
    await outfitterProvider({ registerProvider, registerCommand: vi.fn(), on: vi.fn() } as unknown as ExtensionAPI);
    expect(registerProvider).not.toHaveBeenCalled();
  });
  it('registers native OAuth while signed out and discovers models after Pi login', async () => {
    settings(true);
    vi.spyOn(AuthStorage, 'create').mockReturnValue(AuthStorage.inMemory());
    const login = vi.spyOn(HostedClient.prototype, 'login').mockResolvedValue(credential);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [model] }))));
    const registerProvider = vi.fn<(id: string, config: ProviderConfig) => void>();
    await outfitterProvider({ registerProvider, registerCommand: vi.fn(), on: vi.fn() } as unknown as ExtensionAPI);
    expect(registerProvider.mock.calls[0][0]).toBe('outfitter');
    const config = registerProvider.mock.calls[0][1];
    expect(config.models).toEqual([]);
    await config.oauth!.login({
      onAuth: vi.fn(),
      onDeviceCode: vi.fn(),
      onPrompt: vi.fn(),
      onSelect: vi.fn().mockResolvedValue('device-code'),
    });
    expect(login).toHaveBeenCalledOnce();
    expect(registerProvider.mock.calls[1][1].models?.[0].id).toBe(model.id);
  });
  it('discovers models before startup and preserves unrelated native models', async () => {
    settings(true);
    delete process.env.PI_CODING_AGENT_DIR;
    const auth = AuthStorage.inMemory({ outfitter: credential });
    vi.spyOn(AuthStorage, 'create').mockReturnValue(auth);
    vi.spyOn(HostedClient.prototype, 'api').mockResolvedValue({ data: [model] });
    const registry = ModelRegistry.inMemory(auth);
    const before = registry.getAll().filter((entry) => entry.provider !== 'outfitter').length;
    const pi = {
      registerCommand: vi.fn(),
      on: vi.fn(),
      registerProvider: (id: string, config: ProviderConfig) => registry.registerProvider(id, config),
    };
    await outfitterProvider(pi as unknown as ExtensionAPI);
    expect(registry.find('outfitter', model.id)).toMatchObject({
      api: 'openai-completions',
      baseUrl: `${ORIGIN}/api/inference/v1`,
      contextWindow: 900000,
    });
    expect(registry.getAll().filter((entry) => entry.provider !== 'outfitter')).toHaveLength(before);
  });
  it('starts Pi even when discovery fails at startup', async () => {
    settings(true);
    vi.spyOn(AuthStorage, 'create').mockReturnValue(AuthStorage.inMemory({ outfitter: credential }));
    vi.spyOn(HostedClient.prototype, 'api').mockRejectedValue(new Error('offline'));
    const registerProvider = vi.fn();
    await outfitterProvider({ registerProvider, registerCommand: vi.fn(), on: vi.fn() } as unknown as ExtensionAPI);
    expect(registerProvider).toHaveBeenCalledOnce();
  });
  it('refreshes a per-run copy through the durable auth.json so concurrent runs share one rotation', async () => {
    settings(true);
    const durable = join(home, '.pi', 'agent');
    mkdirSync(durable, { recursive: true });
    const stored = AuthStorage.create(join(durable, 'auth.json'));
    // Another run already rotated the session the copy was seeded from.
    stored.set('outfitter', { ...credential, access: 'rotated', refresh: 'rotated-r' });
    const copy = AuthStorage.create(join(home, 'session', 'auth.json'));
    copy.set('outfitter', { ...credential, expires: 0 });
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(Response.json({ data: [model] }));
    vi.stubGlobal('fetch', fetch);
    await outfitterProvider({
      registerProvider: vi.fn(),
      registerCommand: vi.fn(),
      on: vi.fn(),
    } as unknown as ExtensionAPI);
    // Discovery used the rotated access token without a second refresh.
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0][1]?.headers).toMatchObject({ Authorization: 'Bearer rotated' });
  });
});

it('revokes from Pi and removes discovery without touching BYOK credentials', async () => {
  settings(true);
  const auth = AuthStorage.inMemory({ outfitter: credential, openai: { type: 'api_key', key: 'byok' } });
  vi.spyOn(AuthStorage, 'create').mockReturnValue(auth);
  vi.spyOn(HostedClient.prototype, 'api').mockResolvedValue({ data: [model] });
  const revoke = vi.spyOn(HostedClient.prototype, 'revoke').mockResolvedValue();
  let logout: Parameters<ExtensionAPI['registerCommand']>[1];
  let start: (event: unknown, context: unknown) => void;
  const registerProvider = vi.fn<(id: string, config: ProviderConfig) => void>();
  await outfitterProvider({
    registerProvider,
    registerCommand: (name: string, command: typeof logout) => {
      if (name === 'outfitter-logout') logout = command;
    },
    on: (name: string, handler: typeof start) => {
      if (name === 'session_start') start = handler;
    },
  } as unknown as ExtensionAPI);
  const notify = vi.fn();
  start!({}, { modelRegistry: { authStorage: AuthStorage.inMemory() }, ui: { notify } });
  await logout!.handler('', { ui: { notify } } as unknown as ExtensionCommandContext);
  expect(revoke).toHaveBeenCalledWith(expect.objectContaining({ refresh: 'refresh' }));
  expect(auth.get('outfitter')).toBeUndefined();
  expect(auth.get('openai')).toEqual({ type: 'api_key', key: 'byok' });
  expect(registerProvider.mock.lastCall?.[1].models).toEqual([]);
  expect(notify).toHaveBeenCalledWith('Signed out of Outfitter.', 'info');
});

it('blocks disabled persisted Outfitter turns without networking, but permits explicit revocation', async () => {
  settings(false);
  const auth = AuthStorage.inMemory({ outfitter: credential });
  vi.spyOn(AuthStorage, 'create').mockReturnValue(auth);
  const api = vi.spyOn(HostedClient.prototype, 'api').mockResolvedValue(undefined);
  const revoke = vi.spyOn(HostedClient.prototype, 'revoke').mockResolvedValue();
  let before: (event: unknown, context: ExtensionCommandContext) => Promise<void>;
  let logout: Parameters<ExtensionAPI['registerCommand']>[1];
  const registerProvider = vi.fn();
  await outfitterProvider({
    registerProvider,
    registerCommand: (_name: string, command: typeof logout) => {
      logout = command;
    },
    on: (_name: string, handler: typeof before) => {
      before = handler;
    },
  } as unknown as ExtensionAPI);
  const abort = vi.fn();
  const ctx = {
    model: { provider: 'outfitter', id: model.id },
    abort,
    ui: { notify: vi.fn() },
  } as unknown as ExtensionCommandContext;
  await before!({}, { ...ctx, model: undefined });
  await before!({}, ctx);
  expect(abort).toHaveBeenCalledOnce();
  expect(api).not.toHaveBeenCalled();
  expect(registerProvider).not.toHaveBeenCalled();
  await logout!.handler('', ctx);
  expect(revoke).toHaveBeenCalledOnce();
  expect(auth.get('outfitter')).toBeUndefined();
});

it('refreshes only selected Outfitter turns and aborts revoked models', async () => {
  settings(true);
  vi.spyOn(AuthStorage, 'create').mockReturnValue(AuthStorage.inMemory({ outfitter: credential }));
  const api = vi.spyOn(HostedClient.prototype, 'api').mockResolvedValue({ data: [model] });
  let before: (event: unknown, context: ExtensionCommandContext) => Promise<void>;
  await outfitterProvider({
    registerProvider: vi.fn(),
    registerCommand: vi.fn(),
    on: (_name: string, handler: typeof before) => {
      before = handler;
    },
  } as unknown as ExtensionAPI);
  const abort = vi.fn();
  const ctx = {
    model: { provider: 'outfitter', id: model.id },
    abort,
    ui: { notify: vi.fn() },
  } as unknown as ExtensionCommandContext;
  await before!({}, ctx);
  expect(abort).not.toHaveBeenCalled();
  api.mockResolvedValue({ data: [] });
  await before!({}, ctx);
  expect(abort).toHaveBeenCalledOnce();
});
