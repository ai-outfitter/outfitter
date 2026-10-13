import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
import type { ExtensionAPI, ExtensionContext, ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
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
  origin: 'https://ai-outfitter.com',
};

describe('bundled native Pi provider', () => {
  it('does not register or contact services until enabled', async () => {
    vi.stubEnv('OUTFITTER_HOSTED_INFERENCE', '0');
    const registerProvider = vi.fn();
    await outfitterProvider({ registerProvider, registerCommand: vi.fn(), on: vi.fn() } as unknown as ExtensionAPI);
    expect(registerProvider).not.toHaveBeenCalled();
  });
  it('registers native OAuth while signed out and discovers models after Pi login', async () => {
    vi.stubEnv('OUTFITTER_HOSTED_INFERENCE', '1');
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
    vi.stubEnv('OUTFITTER_HOSTED_INFERENCE', '1');
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
      baseUrl: 'https://ai-outfitter.com/v1',
    });
    expect(registry.getAll().filter((model) => model.provider !== 'outfitter')).toHaveLength(before);
  });
});

it('refreshes workspace models live and refreshes only Outfitter turns', async () => {
  vi.stubEnv('OUTFITTER_HOSTED_INFERENCE', '1');
  vi.spyOn(AuthStorage, 'create').mockReturnValue(AuthStorage.inMemory({ outfitter: credential }));
  const api = vi
    .spyOn(HostedClient.prototype, 'api')
    .mockImplementation((path) =>
      Promise.resolve(
        path === '/api/cli/workspace' ? { workspace: { id: 'org:2', login: 'team' } } : { data: [model] },
      ),
    );
  let command: Parameters<ExtensionAPI['registerCommand']>[1];
  let before: (event: unknown, context: ExtensionContext) => Promise<void>;
  const registerProvider = vi.fn();
  await outfitterProvider({
    registerProvider,
    registerCommand: (_name: string, value: typeof command) => {
      if (_name === 'outfitter-workspace') command = value;
    },
    on: (_event: string, handler: typeof before) => {
      before = handler;
    },
  } as unknown as ExtensionAPI);
  const abort = vi.fn();
  const notify = vi.fn();
  const ctx = {
    model: { provider: 'outfitter', id: model.id },
    abort,
    ui: { notify },
  } as unknown as ExtensionCommandContext;
  await expect(command!.handler('', ctx)).rejects.toThrow('Usage:');
  await command!.handler('org:2', ctx);
  expect(api).toHaveBeenCalledWith('/api/cli/workspace', 'secret', { workspace_id: 'org:2' }, 'PUT');
  expect(notify).toHaveBeenCalledWith('Outfitter workspace: team (org:2)', 'info');
  const count = api.mock.calls.length;
  await before!({}, { ...ctx, model: undefined });
  await before!({}, { ...ctx, model: { ...ctx.model!, provider: 'anthropic' } });
  expect(api.mock.calls.length).toBe(count);
  await before!({}, ctx);
  expect(abort).not.toHaveBeenCalled();
  api.mockResolvedValue({ data: [] });
  await before!({}, ctx);
  expect(abort).toHaveBeenCalledOnce();
  api.mockRejectedValue(new Error('unauthorized'));
  await before!({}, ctx);
  expect(abort).toHaveBeenCalledTimes(2);
});

it('revokes from Pi and removes discovery without touching BYOK credentials', async () => {
  vi.stubEnv('OUTFITTER_HOSTED_INFERENCE', '1');
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
