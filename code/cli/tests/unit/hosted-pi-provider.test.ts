import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthStorage, ModelRegistry } from '@earendil-works/pi-coding-agent';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
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
    await outfitterProvider({ registerProvider } as unknown as ExtensionAPI);
    expect(registerProvider).not.toHaveBeenCalled();
  });
  it('registers native OAuth while signed out and discovers models after Pi login', async () => {
    vi.stubEnv('OUTFITTER_HOSTED_INFERENCE', '1');
    vi.stubEnv('PI_CODING_AGENT_DIR', '/tmp/session');
    vi.spyOn(AuthStorage, 'create').mockReturnValue(AuthStorage.inMemory());
    const login = vi.spyOn(HostedClient.prototype, 'login').mockResolvedValue(credential);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [model] }))));
    const registerProvider = vi.fn<(id: string, config: ProviderConfig) => void>();
    await outfitterProvider({ registerProvider } as unknown as ExtensionAPI);
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
    const pi = { registerProvider: (id: string, config: ProviderConfig) => registry.registerProvider(id, config) };
    await outfitterProvider(pi as unknown as ExtensionAPI);
    expect(registry.find('outfitter', 'public/test')).toMatchObject({
      api: 'openai-completions',
      baseUrl: 'https://ai-outfitter.com/v1',
    });
    expect(registry.getAll().filter((model) => model.provider !== 'outfitter')).toHaveLength(before);
  });
});
