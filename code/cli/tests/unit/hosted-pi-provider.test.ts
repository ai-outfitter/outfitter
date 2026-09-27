import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
import type { ExtensionAPI, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import * as experimental from '../../src/hosted/ExperimentalProvider.js';
import outfitterProvider from '../../src/hosted/PiProvider.js';
import { HostedClient } from '../../src/hosted/HostedClient.js';
import type { ProviderConfig } from '../../src/hosted/HostedClient.js';

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
const model = {
  id: 'public/test',
  name: 'Test',
  context_length: 4096,
  max_output_tokens: 512,
  pricing: { prompt: '0', completion: '0' },
};
const credential = {
  type: 'oauth' as const,
  access: 'secret',
  refresh: 'refresh',
  expires: Date.now() + 10000,
  origin: 'https://beta.ai-outfitter.com',
};

describe('bundled native Pi provider', () => {
  it('does not register or contact services until enabled', async () => {
    vi.spyOn(experimental, 'experimentalProviderEnabled').mockReturnValue(false);
    const registerProvider = vi.fn();
    await outfitterProvider({ registerProvider, registerCommand: vi.fn(), on: vi.fn() } as unknown as ExtensionAPI);
    expect(registerProvider).not.toHaveBeenCalled();
  });
  it('registers native OAuth while signed out and discovers models after Pi login', async () => {
    vi.spyOn(experimental, 'experimentalProviderEnabled').mockReturnValue(true);
    vi.stubEnv('PI_CODING_AGENT_DIR', '/tmp/session');
    vi.spyOn(AuthStorage, 'create').mockReturnValue(AuthStorage.inMemory());
    const login = vi.spyOn(HostedClient.prototype, 'login').mockResolvedValue(credential);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [model] }))));
    const registerProvider = vi.fn<(id: string, config: ProviderConfig) => void>();
    await outfitterProvider({ registerProvider, registerCommand: vi.fn(), on: vi.fn() } as unknown as ExtensionAPI);
    expect(registerProvider.mock.calls[0][0]).toBe('outfitter');
    const config = registerProvider.mock.calls[0][1];
    expect(config.models).toEqual([]);
    await config.oauth!.login({ onAuth: vi.fn(), onDeviceCode: vi.fn(), onPrompt: vi.fn(), onSelect: vi.fn() });
    expect(login).toHaveBeenCalledOnce();
    expect(registerProvider.mock.calls[1][1].models?.[0].id).toBe('public/test');
    vi.unstubAllGlobals();
  });
  it('discovers entitled models before startup and preserves unrelated native models', async () => {
    vi.spyOn(experimental, 'experimentalProviderEnabled').mockReturnValue(true);
    delete process.env.PI_CODING_AGENT_DIR;
    const auth = AuthStorage.inMemory({ outfitter: credential });
    vi.spyOn(AuthStorage, 'create').mockReturnValue(auth);
    vi.spyOn(HostedClient.prototype, 'api').mockResolvedValue({ data: [model] });
    const registry = ModelRegistry.inMemory(auth);
    const before = registry.getAll().filter((model) => model.provider !== 'outfitter').length;
    const pi = {
      registerCommand: vi.fn(),
      on: vi.fn(),
      registerProvider: (id: string, config: ProviderConfig) => registry.registerProvider(id, config),
    };
    await outfitterProvider(pi as unknown as ExtensionAPI);
    expect(registry.find('outfitter', 'public/test')).toMatchObject({
      api: 'openai-completions',
      baseUrl: 'https://beta.ai-outfitter.com/v1',
    });
    expect(registry.getAll().filter((model) => model.provider !== 'outfitter')).toHaveLength(before);
  });
});

it('revokes from Pi and removes discovery without touching BYOK credentials', async () => {
  vi.spyOn(experimental, 'experimentalProviderEnabled').mockReturnValue(true);
  const auth = AuthStorage.inMemory({ outfitter: credential, openai: { type: 'api_key', key: 'byok' } });
  vi.spyOn(AuthStorage, 'create').mockReturnValue(auth);
  const api = vi.spyOn(HostedClient.prototype, 'api').mockResolvedValue({ data: [model] });
  let logout: Parameters<ExtensionAPI['registerCommand']>[1];
  const registerProvider = vi.fn<(id: string, config: ProviderConfig) => void>();
  await outfitterProvider({
    registerProvider,
    registerCommand: (name: string, command: typeof logout) => {
      if (name === 'outfitter-logout') logout = command;
    },
    on: vi.fn(),
  } as unknown as ExtensionAPI);
  const notify = vi.fn();
  await logout!.handler('', { ui: { notify } } as unknown as ExtensionCommandContext);
  expect(api).toHaveBeenLastCalledWith('/api/cli/logout', 'secret', {}, 'POST');
  expect(auth.get('outfitter')).toBeUndefined();
  expect(auth.get('openai')).toEqual({ type: 'api_key', key: 'byok' });
  expect(registerProvider.mock.lastCall?.[1].models).toEqual([]);
  expect(notify).toHaveBeenCalledWith('Signed out of Outfitter.', 'info');
});

it('blocks disabled persisted Outfitter turns without networking, but permits explicit revocation', async () => {
  vi.spyOn(experimental, 'experimentalProviderEnabled').mockReturnValue(false);
  const auth = AuthStorage.inMemory({ outfitter: credential });
  vi.spyOn(AuthStorage, 'create').mockReturnValue(auth);
  const api = vi.spyOn(HostedClient.prototype, 'api').mockResolvedValue(undefined);
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
  expect(api).toHaveBeenCalledWith('/api/cli/logout', 'secret', {}, 'POST');
  expect(auth.get('outfitter')).toBeUndefined();
});

it('refreshes only selected Outfitter turns and aborts revoked models', async () => {
  vi.spyOn(experimental, 'experimentalProviderEnabled').mockReturnValue(true);
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
